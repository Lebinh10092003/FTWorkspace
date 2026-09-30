"""Read-only comparison of exam memberships and their configured source tabs."""
import json

from django.core.management.base import BaseCommand
from django.utils import timezone
from authentication.models import SystemConfig
from integrations.google_sheets import build_sheets_service, extract_spreadsheet_id
from examination.form_registration import (
    matching_candidate, selected_codes, source_uid, TAB_CODES,
)
from examination.models import (
    Candidate, CandidateParticipation, ExamSession, ExaminationSheet,
    FormRegistrationLink, PublicExamRegistration,
)
from examination.public_registration_sheet import quoted
from examination.sync import format_person_name, parse_dob, sync_single_sheet, valid_candidate_name


def session_memberships():
    members = {}
    for candidate_id, session_id in CandidateParticipation.objects.values_list('candidate_id', 'session_id'):
        members.setdefault(session_id, set()).add(candidate_id)
    invalid = {}
    for candidate in Candidate.objects.all().iterator():
        for session_id in candidate.session_ids or []:
            members.setdefault(session_id, set()).add(candidate.pk)
        if not valid_candidate_name(candidate.name):
            invalid[candidate.pk] = True
    return members, invalid


def form_summary(sheet, rows, membership_ids):
    """Use form identities and selected contests without creating import links."""
    valid = matched = conflicts = ignored = 0
    matched_ids = set()
    session_code = ExamSession.objects.get(pk=sheet.session_id).code.upper()
    spreadsheet_id = extract_spreadsheet_id(sheet.url)
    for row_number, row in enumerate(rows[1:], start=2):
        if len(row) < 13 or not valid_candidate_name(row[2]):
            ignored += bool(any(str(cell or '').strip() for cell in row))
            continue
        if session_code not in selected_codes(sheet.sheet_tab, row):
            continue
        valid += 1
        try:
            link = FormRegistrationLink.objects.filter(spreadsheet_id=spreadsheet_id,
                sheet_tab=sheet.sheet_tab, source_uid=source_uid(row, row_number), session_id=sheet.session_id).first()
            candidate = link.candidate if link else None
            marker = str(row[17] or '') if len(row) > 17 else ''
            if not candidate and marker.startswith('WORKSPACE:'):
                registration = PublicExamRegistration.objects.filter(pk=marker.split(':', 1)[1]).first()
                candidate = registration.candidate if registration else None
            if not candidate:
                candidate = matching_candidate(format_person_name(row[2]), parse_dob(row[3]),
                    ''.join(str(row[4] or '').split()), str(row[5] or row[1] or '').strip(),
                    ''.join(char for char in str(row[9] or '') if char.isdigit() or char == '+'))
            if candidate and candidate.pk in membership_ids:
                matched += 1
                matched_ids.add(candidate.pk)
        except (ValueError, TypeError):
            conflicts += 1
    return dict(total=valid, matched=matched, unmatched=valid - matched - conflicts,
                conflicts=conflicts, webOnly=len(membership_ids - matched_ids), ignoredRows=ignored)


class Command(BaseCommand):
    help = 'Đối chiếu số thí sinh và các nguồn Sheet của từng kỳ thi; không ghi dữ liệu.'

    def add_arguments(self, parser):
        parser.add_argument('--only', default='', help='Mã cuộc thi hoặc mã kỳ, cách nhau bằng dấu phẩy.')

    def handle(self, *args, **options):
        only = {item.strip().upper() for item in options['only'].split(',') if item.strip()}
        memberships, invalid = session_memberships()
        sessions = [session for session in ExamSession.objects.order_by('code', 'sort_key')
                    if not only or session.code.upper() in only or session.pk.upper() in only]
        sources = list(ExaminationSheet.objects.exclude(url='').order_by('session_id', 'stage', 'name'))
        service = None
        service_error = None
        form_cache = {}
        checked = failed = issues = 0
        self.stdout.write('AUDIT_START · chỉ đọc; không nhập, xuất, gỡ hồ sơ hoặc cập nhật số đếm')
        for session in sessions:
            ids = memberships.get(session.pk, set())
            session_sources = [source for source in sources if source.session_id == session.pk]
            invalid_count = sum(candidate_id in invalid for candidate_id in ids)
            report = dict(sessionId=session.pk, code=session.code, period=session.time,
                storedCount=session.candidates_count, membershipCount=len(ids), invalidNames=invalid_count,
                countMismatch=session.candidates_count != len(ids), sources=[])
            if invalid_count or report['countMismatch']:
                issues += 1
            for sheet in session_sources:
                source_report = dict(name=sheet.name, stage=sheet.stage, tab=sheet.sheet_tab, pendingImport=sheet.pending_manual_import)
                try:
                    if sheet.stage == 'form-webhook':
                        if sheet.sheet_tab not in TAB_CODES:
                            raise ValueError('Tab Form không thuộc cấu hình nhận đăng ký.')
                        if service is None and service_error is None:
                            try:
                                config = SystemConfig.objects.filter(key='main').first()
                                service = build_sheets_service(config.last_google_access_token if config else None,
                                                               (config.data if config else {}) or {})
                            except Exception:
                                service_error = 'Không có kết nối Google hợp lệ để đọc tab Form riêng tư.'
                        if service_error:
                            raise ValueError(service_error)
                        cache_key = (extract_spreadsheet_id(sheet.url), sheet.sheet_tab)
                        if cache_key not in form_cache:
                            form_cache[cache_key] = service.spreadsheets().values().get(
                                spreadsheetId=cache_key[0], range=f'{quoted(sheet.sheet_tab)}!A:R').execute().get('values', [])
                        source_report['summary'] = form_summary(sheet, form_cache[cache_key], ids)
                    else:
                        preview = sync_single_sheet(sheet.url, timezone.now().isoformat(),
                                                    session_id=session.pk, preview=True, sheet_tab=sheet.sheet_tab)
                        if not preview.get('success'):
                            raise ValueError(preview.get('message') or 'Không đọc được tab đã chọn.')
                        source_report['summary'] = preview['summary']
                    source_report['status'] = 'checked'
                    checked += 1
                    summary = source_report['summary']
                    if summary.get('webOnly') or summary.get('conflicts') or summary.get('new') or summary.get('unmatched'):
                        issues += 1
                except Exception as exc:
                    source_report['status'] = 'unreadable'
                    # Do not print Google exception text containing private URLs or tokens.
                    source_report['error'] = str(exc)[:250] if isinstance(exc, ValueError) else 'Google không cho phép đọc tab này bằng kết nối hiện tại.'
                    failed += 1
                report['sources'].append(source_report)
            self.stdout.write('AUDIT_SESSION ' + json.dumps(report, ensure_ascii=False))
        self.stdout.write('AUDIT_END ' + json.dumps(dict(sessions=len(sessions), checkedSources=checked,
            unreadableSources=failed, findings=issues, unlinkedSources=sum(not source.session_id for source in sources))))
