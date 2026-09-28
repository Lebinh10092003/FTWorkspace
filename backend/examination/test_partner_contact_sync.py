from unittest.mock import MagicMock, patch

from django.test import TestCase

from authentication.models import SystemConfig

from .partner_contact_sync import TAB_TITLE, contact_rows, sync_partner_contacts
from .views import persisted_partners


class PartnerContactSyncTests(TestCase):
    def setUp(self):
        self.partner = {
            'id': 'partner-one', 'school': 'Trường A', 'representative': 'Nguyễn An',
            'phone': '0900000000', 'email': 'an@example.com', 'province': 'Hà Nội',
            'ward': 'Yên Hòa', 'level': 'THCS', 'contests': ['AYSBC'],
            'studentCounts': [{'session': 'AYSBC 2026', 'count': 8}],
        }
        SystemConfig.objects.create(key='examination_partners', data={'partners': [self.partner]})

    @patch('examination.partner_contact_sync.build_sheets_service')
    def test_only_visible_contact_tab_is_replaced_and_changed_records_are_exported(self, build):
        service = MagicMock()
        build.return_value = service
        service.spreadsheets().get().execute.return_value = {'sheets': [
            {'properties': {'sheetId': 1, 'title': 'Tổ chức', 'hidden': True}},
            {'properties': {'sheetId': 2, 'title': TAB_TITLE, 'hidden': False}},
        ]}

        first = sync_partner_contacts()
        self.assertEqual(first, {'status': 'synced', 'partners': 1})
        clear_kwargs = service.spreadsheets().values().clear.call_args.kwargs
        self.assertEqual(clear_kwargs['range'], f"'{TAB_TITLE}'!A:K")
        values = service.spreadsheets().values().update.call_args.kwargs['body']['values']
        self.assertEqual(values[1][0], 'partner-one')
        self.assertEqual(values[1][5:8], ['Nguyễn An', '0900000000', 'an@example.com'])
        self.assertEqual(values[1][9:], [8, 'AYSBC 2026: 8'])

        self.assertEqual(sync_partner_contacts()['status'], 'unchanged')
        self.assertEqual(service.spreadsheets().values().clear.call_count, 1)

        config = SystemConfig.objects.get(key='examination_partners')
        config.data['partners'][0]['email'] = 'new@example.com'
        config.save(update_fields=['data'])
        self.assertEqual(sync_partner_contacts()['status'], 'synced')
        values = service.spreadsheets().values().update.call_args.kwargs['body']['values']
        self.assertEqual(values[1][7], 'new@example.com')

    @patch('examination.partner_contact_sync.build_sheets_service')
    def test_last_partner_removal_does_not_restore_old_audit_record(self, build):
        service = MagicMock()
        build.return_value = service
        service.spreadsheets().get().execute.return_value = {'sheets': [
            {'properties': {'sheetId': 2, 'title': TAB_TITLE, 'hidden': False}},
        ]}
        sync_partner_contacts()
        config = SystemConfig.objects.get(key='examination_partners')
        config.data = {'partners': []}
        config.save(update_fields=['data'])
        self.assertEqual(persisted_partners(), [])
        self.assertEqual(sync_partner_contacts(), {'status': 'synced', 'partners': 0})
        values = service.spreadsheets().values().update.call_args.kwargs['body']['values']
        self.assertEqual(len(values), 1)

    @patch('examination.partner_contact_sync.build_sheets_service')
    def test_hidden_target_is_rejected_without_writing(self, build):
        service = MagicMock()
        build.return_value = service
        service.spreadsheets().get().execute.return_value = {'sheets': [
            {'properties': {'sheetId': 2, 'title': TAB_TITLE, 'hidden': True}},
        ]}
        with self.assertRaisesMessage(ValueError, TAB_TITLE):
            sync_partner_contacts()
        service.spreadsheets().values().clear.assert_not_called()

    def test_contact_rows_have_a_stable_identifier(self):
        rows = contact_rows([self.partner])
        self.assertEqual(rows[0][0], 'Mã đối tác')
        self.assertEqual(rows[1][0], 'partner-one')
