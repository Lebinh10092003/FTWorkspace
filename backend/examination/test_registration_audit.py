import json
from io import StringIO
from unittest.mock import MagicMock, patch
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from .models import Candidate, CandidateParticipation, ExamSession, ExaminationSheet, LogNote

COMMAND = 'examination.management.commands.audit_examination_registrations'


class RegistrationAuditTests(TestCase):
    def session(self, code):
        return ExamSession.objects.create(id='audit-' + code, competition_id=code, code=code,
            name=code, parent='Test', organizer='Test', time='2026–2027', sort_key=code, candidates_count=1)

    def source(self, session, stage='registration-source', tab='SIBO'):
        return ExaminationSheet.objects.create(id='source-' + session.pk, session_id=session.pk,
            name=session.code, url='https://docs.google.com/spreadsheets/d/example/edit', sheet_tab=tab,
            stage=stage, created_at=timezone.now(), updated_at=timezone.now(), pending_manual_import=True)

    def run_audit(self):
        output = StringIO()
        only = ','.join(ExamSession.objects.filter(pk__startswith='audit-').values_list('pk', flat=True))
        call_command('audit_examination_registrations', only=only, stdout=output)
        rows = [json.loads(line[len('AUDIT_SESSION '):]) for line in output.getvalue().splitlines() if line.startswith('AUDIT_SESSION ')]
        return output.getvalue(), rows

    @patch(COMMAND + '.sync_single_sheet')
    def test_audit_reports_placeholders_and_never_changes_memberships_or_sheet_state(self, preview):
        session = self.session('SIAIO')
        sheet = self.source(session)
        candidate = Candidate.objects.create(id='placeholder', code='FT-00324', name='`',
            session_ids=[session.pk], sort_key='placeholder')
        CandidateParticipation.objects.create(candidate=candidate, session=session)
        preview.return_value = dict(success=True, summary=dict(total=0, webOnly=1, conflicts=0, new=0))
        output, reports = self.run_audit()
        row = next(row for row in reports if row['sessionId'] == session.pk)
        self.assertEqual(row['invalidNames'], 1)
        self.assertEqual(row['sources'][0]['summary']['webOnly'], 1)
        self.assertTrue(preview.call_args.kwargs['preview'])
        self.assertNotIn('sheet_doc_id', preview.call_args.kwargs)
        candidate.refresh_from_db(); sheet.refresh_from_db(); session.refresh_from_db()
        self.assertEqual(candidate.session_ids, [session.pk])
        self.assertEqual(session.candidates_count, 1)
        self.assertTrue(candidate.participations.exists())
        self.assertTrue(sheet.pending_manual_import)
        self.assertFalse(LogNote.objects.exists())

    @patch(COMMAND + '.build_sheets_service')
    def test_shared_form_tab_counts_only_selected_competition_and_hides_personal_data(self, build):
        bio, chem = self.session('SIBO'), self.session('SICHO')
        tab = 'SIPhO, SIChO, SIBO, SILSO'
        self.source(bio, 'form-webhook', tab); self.source(chem, 'form-webhook', tab)
        candidate = Candidate.objects.create(id='bio-person', code='FT-BIO', name='Nguyễn Minh An', identity='001234567890',
            session_ids=[bio.pk], sort_key='bio')
        CandidateParticipation.objects.create(candidate=candidate, session=bio)
        row = [''] * 18
        row[2], row[4], row[12] = candidate.name, candidate.identity, 'SIBO'
        service = MagicMock()
        service.spreadsheets.return_value.values.return_value.get.return_value.execute.return_value = {'values': [['Tiêu đề'], row]}
        build.return_value = service
        output, reports = self.run_audit()
        by_code = {row['code']: row for row in reports}
        self.assertEqual(by_code['SIBO']['sources'][0]['summary']['total'], 1)
        self.assertEqual(by_code['SICHO']['sources'][0]['summary']['total'], 0)
        self.assertEqual(service.spreadsheets.return_value.values.return_value.get.call_count, 1)
        self.assertNotIn(candidate.name, output)
        self.assertNotIn(candidate.identity, output)

    @patch(COMMAND + '.build_sheets_service', side_effect=ValueError('private-token-must-not-appear'))
    def test_private_tab_without_connection_is_reported_as_unchecked(self, build):
        session = self.session('SIBO')
        self.source(session, 'form-webhook', 'SIPhO, SIChO, SIBO, SILSO')
        output, rows = self.run_audit()
        report = next(row for row in rows if row['sessionId'] == session.pk)
        self.assertEqual(report['sources'][0]['status'], 'unreadable')
        self.assertNotIn('private-token-must-not-appear', output)
