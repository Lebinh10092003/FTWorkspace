"""Repair session-derived sheet fields without deleting or reordering registrations."""
import json

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from examination.models import CandidateParticipation, ExamSession, ExaminationSheet
from examination.sync import clean_profile_text, export_session_to_google_sheet, format_identity, format_phone, tab_content_fingerprint, output_sheet_export_preview
from integrations.google_sheets import extract_spreadsheet_id


class Command(BaseCommand):
    help = 'Kiểm tra/sửa CCCD, điện thoại và xuất lại dữ liệu đúng theo từng kỳ tổ chức.'

    def add_arguments(self, parser):
        parser.add_argument('--sessions', required=True, help='Các mã kỳ tổ chức, cách nhau bằng dấu phẩy.')
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--restore-automation', action='store_true')

    def handle(self, *args, **options):
        sessions = [item.strip() for item in options['sessions'].split(',') if item.strip()]
        participations = list(CandidateParticipation.objects.filter(session_id__in=sessions).select_related('candidate'))
        if set(sessions) != set(ExamSession.objects.filter(pk__in=sessions).values_list('pk', flat=True)):
            raise CommandError('Có mã kỳ tổ chức không tồn tại.')
        annual_id = '11h9E1WPewoUzoMK8UToIC2oJqRyFrvrw5oZfl81NZM8'
        targets, seen = [], set()
        for sheet in ExaminationSheet.objects.filter(session_id__in=sessions).exclude(stage='form-webhook').order_by('session_id', 'stage'):
            if annual_id not in sheet.url and sheet.stage != 'session-output':
                continue
            key = (extract_spreadsheet_id(sheet.url), sheet.sheet_tab)
            if key in seen:
                continue
            seen.add(key)
            preview = output_sheet_export_preview(sheet, max_changes=2000)
            plan = {key: preview[key] for key in ('sheetTab', 'currentRows', 'proposedRows', 'matchedRows', 'appendedRows',
                'unmatchedSheetRows', 'matchConflicts', 'writeChangedCells', 'changedCells', 'hasFormatChanges')}
            plan.update(sessionId=sheet.session_id, spreadsheetId=key[0])
            self.stdout.write('REPAIR_PLAN ' + json.dumps(plan, ensure_ascii=False))
            # Publish only field names and cell coordinates, never private values.
            self.stdout.write('REPAIR_FIELDS ' + json.dumps([{'cell': change['cell'], 'field': change['field']}
                for change in preview['changes']], ensure_ascii=False))
            if preview['matchConflicts'] or preview['unmatchedSheetRows']:
                raise CommandError(f'Tab {sheet.sheet_tab} có dòng chưa ghép chắc chắn; chưa ghi bất kỳ tab nào.')
            targets.append(sheet)
        if not targets:
            raise CommandError('Không có Sheet tổng hợp trong các kỳ được chỉ định.')
        candidates = {p.candidate_id: p.candidate for p in participations}
        changes = []
        for candidate in candidates.values():
            formatters = [('identity', format_identity), ('phone', format_phone)] + [(field, clean_profile_text)
                for field in ('parent', 'email', 'city', 'ward', 'address', 'nationality', 'class_name', 'school')]
            for field, formatter in formatters:
                current = getattr(candidate, field) or ''
                next_value = formatter(current)
                if current != next_value:
                    changes.append((candidate, field, next_value))
        self.stdout.write(json.dumps({'sessions': sessions, 'registrations': len(participations),
            'normalizedFields': len(changes), 'apply': options['apply']}, ensure_ascii=False))
        if not options['apply']:
            return
        with transaction.atomic():
            for candidate, field, next_value in changes:
                setattr(candidate, field, next_value)
                candidate.save(update_fields=[field, 'updated_at'])
            for participation in participations:
                data = dict(participation.registration_data or {})
                if not data.get('registeredAt'):
                    data['registeredAt'] = participation.created_at.isoformat()
                    participation.registration_data = data
                    participation.save(update_fields=['registration_data', 'updated_at'])
        # The annual tracking workbook is produced by the web. It must never
        # auto-import its own stale mirror into the database.
        for sheet in targets:
            sheet.stage = 'session-output'
            sheet.automation_enabled = False
            sheet.save(update_fields=['stage', 'automation_enabled', 'updated_at'])
            codes = [p.candidate.code for p in participations if p.session_id == sheet.session_id]
            try:
                result = export_session_to_google_sheet(sheet, export_mode='refresh-selected',
                    append_candidate_codes=codes, validate_template=True)
                sheet.last_content_fingerprint = result['fingerprint']
                sheet.last_observed_fingerprint = tab_content_fingerprint(sheet)
                sheet.last_export_at = timezone.now()
                sheet.pending_manual_import = False
                sheet.change_detected_at = None
                sheet.status = 'success'
                sheet.last_error = ''
                sheet.automation_enabled = options['restore_automation']
                sheet.save()
                # The same mirror cannot also auto-import old values back into
                # the web. Keep the source link for history, disable that cycle.
                for duplicate in ExaminationSheet.objects.filter(session_id=sheet.session_id,
                        sheet_tab=sheet.sheet_tab, stage='registration-source').exclude(pk=sheet.pk):
                    if extract_spreadsheet_id(duplicate.url) == extract_spreadsheet_id(sheet.url):
                        duplicate.automation_enabled = False
                        duplicate.save(update_fields=['automation_enabled', 'updated_at'])
                self.stdout.write(json.dumps({'tab': sheet.sheet_tab, **result}, ensure_ascii=False))
            except Exception as exc:
                sheet.last_error = str(exc)[:1000]
                sheet.status = 'failed'
                sheet.save(update_fields=['last_error', 'status', 'updated_at'])
                raise CommandError(f'Không hoàn tất tab {sheet.sheet_tab}: {exc}') from exc
