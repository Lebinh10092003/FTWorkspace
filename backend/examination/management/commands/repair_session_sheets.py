"""Repair session-derived sheet fields without deleting or reordering registrations."""
import json

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from examination.models import Candidate, CandidateParticipation, ExaminationSheet
from examination.sync import export_session_to_google_sheet, format_identity, format_phone, tab_content_fingerprint


class Command(BaseCommand):
    help = 'Kiểm tra/sửa CCCD, điện thoại và xuất lại dữ liệu đúng theo từng kỳ tổ chức.'

    def add_arguments(self, parser):
        parser.add_argument('--sessions', required=True, help='Các mã kỳ tổ chức, cách nhau bằng dấu phẩy.')
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--restore-automation', action='store_true')

    def handle(self, *args, **options):
        sessions = [item.strip() for item in options['sessions'].split(',') if item.strip()]
        participations = list(CandidateParticipation.objects.filter(session_id__in=sessions).select_related('candidate'))
        if not participations:
            raise CommandError('Không có lượt ghi danh trong các kỳ được chỉ định.')
        candidates = {p.candidate_id: p.candidate for p in participations}
        changes = []
        for candidate in candidates.values():
            for field, formatter in (('identity', format_identity), ('phone', format_phone)):
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
        annual_id = '11h9E1WPewoUzoMK8UToIC2oJqRyFrvrw5oZfl81NZM8'
        for sheet in ExaminationSheet.objects.filter(session_id__in=sessions).exclude(stage='form-webhook'):
            if annual_id not in sheet.url:
                continue
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
                self.stdout.write(json.dumps({'tab': sheet.sheet_tab, **result}, ensure_ascii=False))
            except Exception as exc:
                sheet.last_error = str(exc)[:1000]
                sheet.status = 'failed'
                sheet.save(update_fields=['last_error', 'status', 'updated_at'])
                raise CommandError(f'Không hoàn tất tab {sheet.sheet_tab}: {exc}') from exc
