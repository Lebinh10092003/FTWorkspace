"""Reconcile a school's registration workbook with the web, then import what is missing.

Dry run by default: prints every planned change and rolls back. ``--apply``
commits in one transaction.

1. Repairs profiles created by the retired generic Excel importer, which read
   Excel dates as M/D (day and month swapped) and left the school empty:
   - birth date: replaced only when the web value is the file's date with day
     and month swapped, or a mistyped year (same day/month, implausible year);
   - school and other empty fields (class, phone, email, parent): filled from
     the file, never overwriting a non-empty value.
2. Runs the school importer (same preview/commit as the popup) so missing
   registrations are added and school billing is grouped. Existing individual
   registrations keep their payment data.
"""
import json
import re

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from examination.models import Candidate, CandidateParticipation, ExamSession
from examination.school_import import build_plan, commit_plan, read_workbook, registered_contests
from examination.sheet_publication import session_academic_year
from examination.sync import format_identity, format_person_name, format_phone, normalise_str, parse_dob


def identity_key(value):
    return format_identity(value or '').lstrip('0')


def birth_repair(web_value, file_value):
    """Return the reason to replace a web birth date with the file's, or ''."""
    web, incoming = str(web_value or ''), str(file_value or '')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', incoming) or web == incoming:
        return ''
    if not web:
        return 'bổ sung ngày sinh'
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', web):
        return ''
    wy, wm, wd = web.split('-')
    fy, fm, fd = incoming.split('-')
    if wy == fy and (wm, wd) == (fd, fm):
        return 'đảo ngày/tháng'
    if (wm, wd) == (fm, fd) and int(wy) >= timezone.localdate().year - 3:
        return 'nhập nhầm năm sinh'
    return ''


class Command(BaseCommand):
    help = 'Reconcile a school registration workbook with web profiles and import missing registrations.'

    def add_arguments(self, parser):
        parser.add_argument('--file', required=True)
        parser.add_argument('--sheet', default='')
        parser.add_argument('--academic-year', required=True)
        parser.add_argument('--partner-id', default='')
        parser.add_argument('--matches', default='{}', help='JSON {"row": "FT-xxxxx" | "__new__"} for rows needing a decision.')
        parser.add_argument('--update-profiles', action='store_true',
                            help='Also replace non-empty profile values that differ from the file (the school list is authoritative).')
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        content = open(options['file'], 'rb').read()
        records, metadata, sheet, _ = read_workbook(content, options['sheet'])
        year = options['academic_year']
        sessions = [s for s in ExamSession.objects.all() if session_academic_year(s) == year]
        school = metadata.get('school', '')
        self.stdout.write(f'Tab {sheet}: {len(records)} dòng · trường {school or "(không đọc được)"}')
        with transaction.atomic():
            repaired = self.repair_profiles(records, sessions, school, options['update_profiles'])
            plan_options = {'academicYear': year, 'sheet': sheet, 'partnerId': options['partner_id'],
                            'candidateMatches': json.loads(options['matches'])}
            plan = build_plan(content, plan_options)
            self.report_plan(plan)
            if not plan['canCommit']:
                raise CommandError('File có lỗi chung (không phải lỗi từng dòng); không ghi gì.')
            if plan['summary']['newRegistrations'] or plan['summary']['newCandidates'] or repaired:
                commit_plan(plan, None, f'đối soát {options["file"].rsplit("/", 1)[-1]}')
            if not options['apply']:
                transaction.set_rollback(True)
                self.stdout.write(self.style.WARNING('DRY RUN: đã hoàn tác. Thêm --apply để ghi.'))
            else:
                self.stdout.write(self.style.SUCCESS('Đã ghi thay đổi.'))

    def repair_profiles(self, records, sessions, school, update_profiles=False):
        session_ids = [s.pk for s in sessions]
        members = list(Candidate.objects.filter(participations__session_id__in=session_ids).distinct())
        by_identity = {}
        for candidate in members:
            if identity_key(candidate.identity):
                by_identity.setdefault(identity_key(candidate.identity), []).append(candidate)
        repaired = 0
        for raw in records:
            name = format_person_name(raw.get('name', ''))
            if not name:
                continue
            matches = by_identity.get(identity_key(raw.get('cccd', ''))) or [
                candidate for candidate in members if normalise_str(candidate.name) == normalise_str(name)
            ]
            if len(matches) != 1:
                if not matches:
                    contests = ', '.join(registered_contests(raw.get('contests', ''), sessions))
                    self.stdout.write(f'  Dòng {raw["row"]}: {name} ({contests}) chưa có trên web → sẽ thêm qua bước nhập.')
                else:
                    self.stdout.write(f'  Dòng {raw["row"]}: {name} khớp {len(matches)} hồ sơ ({", ".join(c.code for c in matches)}); cần xử lý tay.')
                continue
            candidate = matches[0]
            changes = []
            birth = parse_dob(raw.get('dob', ''))
            reason = birth_repair(candidate.birth_date, birth)
            if not reason and update_profiles and re.fullmatch(r'\d{4}-\d{2}-\d{2}', birth) and birth != candidate.birth_date:
                reason = 'theo danh sách trường'
            if reason:
                changes.append(f'ngày sinh {candidate.birth_date or "trống"} → {birth} ({reason})')
                candidate.birth_date = birth
            fills = {
                'school': school, 'class_name': raw.get('className', ''), 'phone': format_phone(raw.get('phone', '')),
                'email': raw.get('email', ''), 'parent': format_person_name(raw.get('parent', '')),
                'identity': format_identity(raw.get('cccd', '')),
            }
            if update_profiles:
                fills['name'] = name
            for field, value in fills.items():
                current = getattr(candidate, field) or ''
                if not value or normalise_str(current) == normalise_str(value):
                    continue
                if not current or (update_profiles and field != 'school'):
                    changes.append(f'{field} {current or "trống"} → {value}')
                    setattr(candidate, field, value)
            if changes:
                repaired += 1
                candidate.updated = timezone.localtime().strftime('%d/%m/%Y %H:%M')
                candidate.save()
                from examination.views import append_audit
                append_audit(f'candidate-{candidate.code}', 'Đối soát với danh sách trường: ' + '; '.join(changes) + '.', None, system=True)
                self.stdout.write(f'  Dòng {raw["row"]}: {candidate.code} {candidate.name}: ' + '; '.join(changes))
        self.stdout.write(f'Sửa {repaired} hồ sơ.')
        return repaired

    def report_plan(self, plan):
        summary = plan['summary']
        self.stdout.write(f'Nhập theo trường: {summary["candidates"]} học sinh, {summary["registrations"]} lượt '
                          f'({summary["newRegistrations"]} lượt mới, {summary["newCandidates"]} hồ sơ mới, '
                          f'{summary.get("preservedIndividualRegistrations", 0)} lượt cá nhân giữ nguyên).')
        for group in plan['groups']:
            self.stdout.write(f'  {group["label"]}: {group["registrations"]} lượt, {group["newRegistrations"]} mới.')
        errors = {}
        for issue in plan['issues']:
            if issue['level'] == 'error':
                errors.setdefault(issue['message'], []).append(issue.get('row'))
        for message, rows in errors.items():
            label = 'BỎ QUA' if any(rows) else 'LỖI CHUNG'
            self.stdout.write(self.style.ERROR(f'  {label} {message} — dòng {", ".join(str(r) for r in rows if r)}'))
        for row in plan['rows']:
            if row.get('needsDecision'):
                options = '; '.join(f'{m["code"]} {m["name"]} {m["birthDate"]} ({m["reason"]})' for m in row['matches'])
                self.stdout.write(f'  Cần chọn hồ sơ dòng {row["row"]} {row["name"]}: {options}')
