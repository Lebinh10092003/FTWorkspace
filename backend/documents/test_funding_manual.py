import uuid
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from authentication.models import UserProfile
from .models import FundingProposalNumberCounter, FundingProposalRecord


class FundingManualNumberTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(username='funding-qa@example.test', email='funding-qa@example.test')
        UserProfile.objects.create(email=user.email, role='EMPLOYEE')
        self.client = APIClient()
        self.client.force_authenticate(user)
        self.payload = {'draftId': str(uuid.uuid4()), 'numberingMode': 'manual',
            'documentNumber': '31/PĐXKP-FT', 'proposer': 'Người kiểm thử', 'project': 'Dự án thử nghiệm'}

    def download(self, payload=None):
        return self.client.post('/api/documents/funding-proposal.docx', payload or self.payload, format='json')

    def test_manual_number_is_stable_and_future_auto_numbers_do_not_collide(self):
        for _ in range(2):
            response = self.download()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response['X-Document-Number'], '31')
        self.assertEqual(FundingProposalRecord.objects.count(), 1)
        automatic = {**self.payload, 'draftId': str(uuid.uuid4()), 'numberingMode': 'automatic', 'documentNumber': ''}
        self.assertEqual(self.download(automatic)['X-Document-Number'], '32')

    def test_duplicate_and_invalid_numbers_are_rejected_without_consuming_numbers(self):
        self.assertEqual(self.download().status_code, 200)
        duplicate = self.download({**self.payload, 'draftId': str(uuid.uuid4())})
        self.assertEqual(duplicate.status_code, 400)
        self.assertIn('đã được sử dụng', duplicate.data['error'])
        for number in ('0', '-1', '1.2', 'abc', '1000000000'):
            with self.subTest(number=number):
                self.assertEqual(self.download({**self.payload, 'documentNumber': number}).status_code, 400)
        self.assertEqual(FundingProposalNumberCounter.objects.get(pk=1).last_number, 31)
        self.assertEqual(self.download({**self.payload, 'documentNumber': '30'}).status_code, 400)

    def test_drive_failure_preserves_issued_number_for_retry(self):
        with patch('documents.views.save_proposal', side_effect=RuntimeError('temporary Drive outage')):
            response = self.client.post('/api/documents/funding-proposal/drive', self.payload, format='json')
        self.assertEqual(response.status_code, 502)
        self.assertEqual(FundingProposalRecord.objects.get().sequence_number, 31)
        with patch('documents.views.save_proposal', return_value=('test-file', 'https://drive.google.com/file/d/test-file/view')):
            response = self.client.post('/api/documents/funding-proposal/drive', self.payload, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['documentNumber'], '31/PĐXKP-FT')
