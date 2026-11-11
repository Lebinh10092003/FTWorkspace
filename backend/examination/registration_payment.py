"""Private receipt links and local VietQR generation; no payment confirmation."""
import hashlib
from urllib.parse import urlencode
from django.core import signing
from django.db import transaction
from rest_framework.decorators import api_view, authentication_classes, parser_classes, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from .models import PublicExamRegistration, CandidateParticipation, TransferProof

SALT = 'examination:registration-payment:v1'
TOKEN_MAX_AGE = 90 * 24 * 60 * 60
BANK = {'name': 'VPBank', 'bin': '970432', 'account': '0111170303', 'accountName': 'FERMAT TECH JSC'}


def crc16(value):
    crc = 0xFFFF
    for byte in value.encode('ascii'):
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return f'{crc:04X}'


def tlv(key, value):
    value = str(value)
    if len(value.encode('ascii')) > 99:
        raise ValueError('Dữ liệu QR quá dài.')
    return f'{key}{len(value):02d}{value}'


def vietqr(amount, memo):
    if not isinstance(amount, int) or amount <= 0:
        return ''
    beneficiary = tlv('00', BANK['bin']) + tlv('01', BANK['account'])
    account = tlv('00', 'A000000727') + tlv('01', beneficiary) + tlv('02', 'QRIBFTTA')
    payload = tlv('00', '01') + tlv('01', '12') + tlv('38', account) + tlv('53', '704')
    payload += tlv('54', str(amount)) + tlv('58', 'VN') + tlv('62', tlv('08', memo[:25])) + '6304'
    return payload + crc16(payload)


def payment_payload(item):
    participations = list(CandidateParticipation.objects.filter(
        candidate=item.candidate, registration_data__publicRegistrationId=str(item.id),
    ).select_related('session', 'billing'))
    rows = []
    for code in item.contest_codes:
        participation = next((p for p in participations
            if code == (p.registration_data or {}).get('registrationCode', p.session.code.upper())), None)
        # Existing receipts predate registrationCode; match the original fixed session mapping.
        if participation is None:
            from .form_registration import SESSION_IDS
            participation = next((p for p in participations if SESSION_IDS.get(code) == p.session_id), None)
        fee = (participation.registration_data or {}).get('registrationFee') if participation else None
        rows.append({'code': code, 'fee': fee, 'sessionId': participation.session_id if participation else ''})
    known = bool(rows) and all(isinstance(row['fee'], int) for row in rows)
    total = sum(row['fee'] for row in rows) if known else None
    memo = f'DK {item.candidate.code} {str(item.id)[:6].upper()}'[:25]
    bank_available = any(code in ('FIMO', 'FIEO') for code in item.contest_codes)
    verified = bool(participations) and all(p.billing.transfer_status == 'confirmed' for p in participations)
    return {'items': rows, 'total': total, 'memo': memo, 'bank': BANK if bank_available else None,
            'qrPayload': vietqr(total, memo) if known and bank_available else '',
            'proofReceived': bool(item.proof_type), 'paymentStatus': 'confirmed' if verified else 'review' if item.proof_type else 'pending'}


def receipt_payload(item):
    from .registration_page import get_page, page_content
    content = page_content(get_page().published_content)
    token = signing.dumps({'registrationId': str(item.id)}, salt=SALT, compress=True)
    return {'registrationId': str(item.id), 'candidateCode': item.candidate.code,
            'candidateName': item.candidate.name, 'contestCodes': item.contest_codes,
            'createdAt': item.created_at.isoformat(), 'status': 'received', 'paymentToken': token,
            'paymentUrl': '/dang-ky-du-thi?' + urlencode({'ho-so': str(item.id), 'xac-thuc': token}),
            'payment': payment_payload(item), 'presentation': {key: content[key] for key in (
                'paymentEnabled', 'paymentTitle', 'paymentDescription', 'paymentDeclaration', 'successTitle', 'successMessage')}}


@api_view(['GET', 'POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@parser_classes([MultiPartParser, FormParser])
def registration_payment(request, pk):
    try:
        signed = signing.loads(request.headers.get('X-Registration-Token', ''), salt=SALT, max_age=TOKEN_MAX_AGE)
        if signed.get('registrationId') != str(pk):
            raise signing.BadSignature()
    except (signing.BadSignature, TypeError, ValueError, AttributeError):
        return Response({'error': 'Liên kết thanh toán không hợp lệ hoặc đã hết hạn.'}, status=403)
    item = PublicExamRegistration.objects.select_related('candidate').filter(pk=pk).first()
    if not item:
        return Response({'error': 'Không tìm thấy hồ sơ đăng ký.'}, status=404)
    if request.method == 'POST':
        from .public_registration import proof_type
        try:
            mime, content = proof_type(request.FILES.get('proof'))
        except ValueError as error:
            return Response({'error': str(error)}, status=400)
        if not content:
            return Response({'error': 'Vui lòng đính kèm ảnh hoặc PDF xác nhận chuyển khoản.'}, status=400)
        if str(request.data.get('paymentDeclared') or '').lower() != 'true':
            return Response({'error': 'Vui lòng xác nhận đã chuyển khoản trước khi gửi chứng từ.'}, status=400)
        digest = hashlib.sha256(content).hexdigest()[:16]
        with transaction.atomic():
            item = PublicExamRegistration.objects.select_for_update().select_related('candidate').get(pk=pk)
            item.proof, item.proof_type, item.payment_declared = content, mime, True
            item.save(update_fields=['proof', 'proof_type', 'payment_declared', 'updated_at'])
            for participation in CandidateParticipation.objects.filter(candidate=item.candidate,
                registration_data__publicRegistrationId=str(item.id)).select_related('billing', 'session'):
                TransferProof.objects.get_or_create(billing=participation.billing, session=participation.session,
                    filename=f'registration-{item.id}-{digest}', defaults={
                        'image': content, 'image_type': mime, 'created_by': item.candidate.email or '',
                    })
                participation.registration_data = {**participation.registration_data,
                    'paymentDeclared': True, 'paymentProof': f'Workspace #{item.id}'}
                participation.save(update_fields=['registration_data', 'updated_at'])
    response = Response(receipt_payload(item))
    response['Cache-Control'] = 'private, no-store'
    response['Referrer-Policy'] = 'no-referrer'
    response['X-Robots-Tag'] = 'noindex, nofollow'
    return response
