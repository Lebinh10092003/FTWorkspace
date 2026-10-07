"""Recover missing session history before linking an existing historical mirror."""
import json
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from authentication.models import SystemConfig
from integrations.google_sheets import build_sheets_service
from examination.models import CandidateParticipation, ExamSession, ExaminationSheet, RoundResult
from examination.eligibility import normalize_eligibility
from examination.sync import (_aligned_export_rows, _sheet_range_title, clean_txt, normalise_str,
    parse_exam_date, PROFILE_EXPORT_HEADERS, EXPORT_HEADERS, REGISTRATION_EXPORT_HEADERS)

WORKBOOK = '1Sww0zGx2SpBgZUZ9wiVKGe9D_rg3vPZ3nsK8ts0qD8c'
TABS = {'SIAIO': 'SCO - IAIO', 'SICO': 'SCO - ICO'}
REGISTRATION_FIELDS = ('subject', 'category', 'registration_method', 'team_name', 'exam_language', 'general_note')
ROUND_FIELDS = ('eligibility', 'sbd', 'exam_date', 'time_slot', 'mode', 'location', 'link', 'account',
    'password', 'attendance', 'score', 'score_rate', 'rank', 'result', 'note')


def missing_history(participation, row):
    """Fill missing facts only; never replace a recorded result or profile."""
    registration = {}
    conflicts = []
    for index, field in enumerate(REGISTRATION_FIELDS, 15):
        value = clean_txt(row[index]) if index < len(row) else ''
        if value and not clean_txt(getattr(participation, field)):
            registration[field] = value
    if len(row) > 68 and row[68] and not participation.certificate_link:
        registration['certificate_link'] = clean_txt(row[68])
    rounds = []
    configs = [item for item in participation.session.rounds or [] if isinstance(item, dict)]
    for number, config in enumerate(configs[:3]):
        values = {field: clean_txt(row[21 + number * 15 + index]) if 21 + number * 15 + index < len(row) else ''
            for index, field in enumerate(ROUND_FIELDS)}
        if not any(values.values()):
            continue
        if values['exam_date']:
            values['exam_date'] = parse_exam_date(values['exam_date'])
        if values['eligibility']:
            values['eligibility'] = normalize_eligibility(values['eligibility'])
        existing = list(participation.round_results.filter(round_id=clean_txt(config.get('id'))))
        if not existing:
            existing = list(participation.round_results.filter(round_name=clean_txt(config.get('name'))))
        if len(existing) > 1:
            conflicts.append({'round': number + 1, 'field': 'multipleOccurrences'})
            continue
        result = existing[0] if existing else None
        updates = {}
        for field, value in values.items():
            current = clean_txt(getattr(result, field)) if result else ''
            if value and not current:
                updates[field] = value
            elif value and current and normalise_str(value) != normalise_str(current):
                conflicts.append({'round': number + 1, 'field': field})
        if updates:
            rounds.append((config, result, updates))
    return registration, rounds, conflicts


class Command(BaseCommand):
    help = 'Phục hồi các trường lịch sử còn trống từ mẫu tổng hợp cũ, rồi gắn đúng Sheet vào kỳ đã hoàn thành.'

    def add_arguments(self, parser):
        parser.add_argument('--sessions', required=True)
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        ids = [value.strip() for value in options['sessions'].split(',') if value.strip()]
        sessions = list(ExamSession.objects.filter(pk__in=ids))
        if len(sessions) != len(set(ids)) or any(session.code.upper() not in TABS or normalise_str(session.phase) != 'hoanthanh' for session in sessions):
            raise CommandError('Chỉ chọn đúng kỳ SIAIO/SICO lịch sử đã hoàn thành.')
        config = SystemConfig.objects.filter(key='main').first()
        service = build_sheets_service(config.last_google_access_token if config else None, (config.data if config else {}) or {})
        metadata = service.spreadsheets().get(spreadsheetId=WORKBOOK, fields='sheets(properties(title,gridProperties))').execute(num_retries=6)
        tabs = {item['properties']['title']: item['properties'] for item in metadata['sheets']}
        plans = []
        for session in sessions:
            tab = TABS[session.code.upper()]
            if tab not in tabs or tabs[tab]['gridProperties']['columnCount'] != 70:
                raise CommandError('Không tìm thấy đúng mẫu 70 cột; chưa ghi dữ liệu.')
            rows = service.spreadsheets().values().get(spreadsheetId=WORKBOOK, range=f'{_sheet_range_title(tab)}!A2:BR').execute(num_retries=6).get('values', [])
            def header(value):
                import re
                return normalise_str(re.sub(r'\([^)]*\)', '', str(value)))
            if not rows or [header(value) for value in rows[0]] != [header(value) for value in EXPORT_HEADERS]:
                raise CommandError(f'Tab {tab} không đúng thứ tự cột; chưa ghi dữ liệu.')
            alignment = _aligned_export_rows(rows[1:], session.pk)
            if alignment['unmatchedSheetRows'] or alignment['matchConflicts']:
                raise CommandError(f'Tab {tab} có hồ sơ chưa ghép chắc chắn; chưa ghi dữ liệu.')
            memberships = {item.candidate.code: item for item in CandidateParticipation.objects.filter(session=session).select_related('candidate', 'session')}
            changes, conflicts = [], []
            for index, row in enumerate(rows[1:]):
                code = alignment['values'][index][1]
                participation = memberships[code]
                registration, rounds, issues = missing_history(participation, row)
                conflicts.extend({'row': index + 3, **issue} for issue in issues)
                changes.append((participation, registration, rounds))
            self.stdout.write('HISTORY_PLAN ' + json.dumps({'sessionId': session.pk, 'tab': tab,
                'matchedRows': alignment['matchedRows'], 'appendRows': alignment['appendedRows'],
                'registrationFields': sum(len(item[1]) for item in changes),
                'roundsToRestore': sum(len(item[2]) for item in changes), 'conflicts': conflicts,
                'apply': options['apply']}, ensure_ascii=False))
            if conflicts:
                raise CommandError('Có dữ liệu lịch sử khác với kết quả đã lưu; chưa ghi bất kỳ kỳ nào.')
            plans.append((session, tab, changes))
        if not options['apply']:
            return
        # Seed facts first. Creating the output link queues exports only after
        # this complete transaction commits, so no empty history can erase Sheet.
        with transaction.atomic():
            for session, tab, changes in plans:
                for participation, registration, rounds in changes:
                    if registration:
                        for field, value in registration.items():
                            setattr(participation, field, value)
                        participation.save(update_fields=[*registration, 'updated_at'])
                    for round_config, result, updates in rounds:
                        if result:
                            for field, value in updates.items():
                                setattr(result, field, value)
                            result.save(update_fields=[*updates, 'updated_at'])
                        else:
                            RoundResult.objects.create(participation=participation,
                                round_id=clean_txt(round_config.get('id')), round_name=clean_txt(round_config.get('name')),
                                raw_data={'recoveredFrom': f'{WORKBOOK}/{tab}'}, **updates)
                sheet, _ = ExaminationSheet.objects.get_or_create(session_id=session.pk, sheet_tab=tab,
                    url=f'https://docs.google.com/spreadsheets/d/{WORKBOOK}/edit', defaults={
                        'id': f'history-output-{session.pk}', 'name': tab, 'stage': 'session-output',
                        'automation_enabled': True, 'created_at': timezone.now(), 'updated_at': timezone.now()})
                if sheet.stage != 'session-output':
                    raise CommandError('Liên kết hiện có không phải Sheet tổng hợp; giữ nguyên cấu hình.')
        self.stdout.write('HISTORY_RESTORED · giữ nguyên hồ sơ, thời gian ghi danh và dữ liệu kế toán')
