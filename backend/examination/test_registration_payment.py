import json
import uuid
from copy import deepcopy
from unittest.mock import patch

from django.core import signing
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from .registration_test_utils import open_rounds
from .form_registration import SESSION_IDS
from .models import Candidate, CandidateParticipation, ExamRegistrationPage, ExamSession, PublicExamRegistration, TransferProof
from .registration_page import DEFAULT_CONTENT
from .registration_payment import SALT, crc16


class RegistrationPaymentTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        for code in ('FIMO', 'FIEO'):
            ExamSession.objects.get_or_create(id=SESSION_IDS[code], defaults=dict(competition_id=code, code=code,
                name=code, parent='FT', organizer='FT', time='2026–2027', sort_key=code))
        ExamSession.objects.filter(pk__in=list([SESSION_IDS['FIMO'], SESSION_IDS['FIEO']])).update(rounds=open_rounds(), phase='Tuyển sinh')
        self.payload = dict(requestKey=str(uuid.uuid4()), contestCodes=json.dumps(['FIMO', 'FIEO']),
            name='Nguyễn Minh An', birthDate='2018-07-12', identity='001201012345', className='3A1',
            submitterEmail='registrant@example.test', email='parent@example.test', phone='0912345678',
            school='Trường A', grade='3', city='Hà Nội', ward='Phường A', address='Số 12')

    def save_registration(self):
        response = self.client.post('/api/public/examination/registration', self.payload, format='multipart')
        self.assertEqual(response.status_code, 201, response.data)
        self.url = f"/api/public/examination/registrations/{response.data['registrationId']}/payment"
        self.headers = {'HTTP_X_REGISTRATION_TOKEN': response.data['paymentToken']}
        return response

    def proof(self):
        return SimpleUploadedFile('proof.png', b'\x89PNG\r\n\x1a\n' + b'x' * (6 * 1024 * 1024), content_type='image/png')

    def test_saves_both_competitions_before_money_or_image_and_snapshots_total(self):
        response = self.save_registration()
        self.assertEqual(Candidate.objects.count(), 1)
        self.assertEqual(CandidateParticipation.objects.count(), 2)
        self.assertFalse(PublicExamRegistration.objects.get().proof)
        self.assertFalse(TransferProof.objects.exists())
        self.assertEqual(response.data['payment']['total'], 500000)
        self.assertEqual(response.data['payment']['paymentStatus'], 'pending')
        self.assertIn('5406500000', response.data['payment']['qrPayload'])
        qr = response.data['payment']['qrPayload']
        self.assertEqual(qr[-4:], crc16(qr[:-4]))
        self.assertIn('970432', qr)
        self.assertIn('0111170303', qr)
        self.assertEqual(crc16('123456789'), '29B1')
        for item in CandidateParticipation.objects.select_related('billing'):
            self.assertEqual(item.billing.transfer_status, 'pending')
            self.assertFalse(item.candidate.exam_history)
        ExamSession.objects.filter(pk__in=[SESSION_IDS['FIMO'], SESSION_IDS['FIEO']]).update(rounds=open_rounds(fee=999000))
        content = deepcopy(DEFAULT_CONTENT)
        ExamRegistrationPage.objects.filter(pk=1).update(published_content=content, published=False)
        resumed = self.client.get(self.url, **self.headers)
        self.assertEqual(resumed.status_code, 200)
        self.assertEqual(resumed.data['payment']['total'], 500000)
        duplicate = self.client.post('/api/public/examination/registration', self.payload, format='multipart')
        self.assertEqual(duplicate.status_code, 403)  # New registrations closed; receipt still accessible.
        self.assertIn('no-store', response['Cache-Control'])

    def test_payment_link_and_upload_require_the_matching_signed_capability(self):
        self.save_registration()
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.client.get(self.url, HTTP_X_REGISTRATION_TOKEN='forged').status_code, 403)
        wrong = signing.dumps({'registrationId': str(uuid.uuid4())}, salt=SALT)
        self.assertEqual(self.client.get(self.url, HTTP_X_REGISTRATION_TOKEN=wrong).status_code, 403)
        with patch('examination.registration_payment.signing.loads', side_effect=signing.SignatureExpired):
            self.assertEqual(self.client.get(self.url, **self.headers).status_code, 403)
        self.assertEqual(self.client.post(self.url, {'proof': self.proof()}, format='multipart').status_code, 403)
        self.assertFalse(TransferProof.objects.exists())

    def test_upload_later_is_private_idempotent_and_never_confirms_money(self):
        self.save_registration()
        for _ in range(2):
            response = self.client.post(self.url, {'proof': self.proof(), 'paymentDeclared': 'true'}, format='multipart', **self.headers)
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data['payment']['paymentStatus'], 'review')
        self.assertTrue(response.data['payment']['proofReceived'])
        self.assertEqual(TransferProof.objects.count(), 2)
        self.assertEqual(Candidate.objects.count(), 1)
        self.assertEqual(CandidateParticipation.objects.count(), 2)
        self.assertEqual(self.client.get(self.url, **self.headers)['Referrer-Policy'], 'no-referrer')
        for participation in CandidateParticipation.objects.select_related('billing'):
            self.assertEqual(participation.billing.transfer_status, 'pending')
        duplicate = self.client.post('/api/public/examination/registration', self.payload, format='multipart')
        self.assertEqual(duplicate.status_code, 200)
        self.assertEqual(duplicate.data['payment']['paymentStatus'], 'review')

    def test_bad_proof_does_not_remove_the_saved_registration(self):
        self.save_registration()
        for data in ({'paymentDeclared': 'true'}, {'proof': self.proof()},
                     {'proof': SimpleUploadedFile('invalid.png', b'not an image'), 'paymentDeclared': 'true'}):
            response = self.client.post(self.url, data, format='multipart', **self.headers)
            self.assertEqual(response.status_code, 400)
        self.assertEqual(PublicExamRegistration.objects.count(), 1)
        self.assertEqual(CandidateParticipation.objects.count(), 2)
        self.assertFalse(TransferProof.objects.exists())
