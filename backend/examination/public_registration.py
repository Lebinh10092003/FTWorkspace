"""Public individual registration for the 2026–2027 examination sessions."""

import hashlib
import hmac
import json
import os
import re
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view, authentication_classes, parser_classes, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from authentication.permissions import IsWorkspaceAuthenticated, request_modules, request_role
from .form_registration import SESSION_IDS, TAB_CODES, matching_candidate
from .models import Candidate, CandidateParticipation, Competition, ExamSession, PublicExamRegistration, TransferProof
from .public_registration_sheet import row_for
from .sync import format_person_name, merge_contest_codes, next_code, sync_session_candidate_totals, valid_candidate_name
from .registration_page import get_page, page_content, competitions


MAX_PROOF_BYTES = 5 * 1024 * 1024
PHONE_PATTERN = re.compile(r'^\+?\d{9,12}$')
GRADE_PATTERN = re.compile(r'^(?:[1-9]|1[0-2])$')


def open_sessions():
    sessions = ExamSession.objects.filter(pk__in=SESSION_IDS.values())
    by_id = {item.id: item for item in sessions}
    return [(code, by_id[session_id]) for code, session_id in SESSION_IDS.items() if session_id in by_id]


def clean(data, key, limit):
    return re.sub(r'\s+', ' ', str(data.get(key) or '')).strip()[:limit]


def registration_payload(item):
    return {
        'registrationId': str(item.id),
        'candidateCode': item.candidate.code,
        'contestCodes': item.contest_codes,
        'createdAt': item.created_at.isoformat(),
        'status': 'received',
    }


def proof_type(upload):
    if not upload:
        return '', None
    if upload.size > MAX_PROOF_BYTES:
        raise ValueError('Tệp xác nhận tối đa 5 MB.')
    content = upload.read(MAX_PROOF_BYTES + 1)
    if len(content) > MAX_PROOF_BYTES:
        raise ValueError('Tệp xác nhận tối đa 5 MB.')
    if content.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png', content
    if content.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg', content
    if content.startswith(b'RIFF') and content[8:12] == b'WEBP':
        return 'image/webp', content
    if content.startswith(b'%PDF-'):
        return 'application/pdf', content
    raise ValueError('Chỉ nhận ảnh PNG, JPEG, WebP hoặc PDF.')


def submission_values(content, data):
    from .registration_page import BUILTIN_FIELDS
    try:
        extra = json.loads(str(data.get('customAnswers') or '{}'))
    except (TypeError, ValueError):
        raise ValueError('Thông tin bổ sung không hợp lệ.')
    if not isinstance(extra, dict):
        raise ValueError('Thông tin bổ sung không hợp lệ.')
    values = {key: '' for key in BUILTIN_FIELDS}
    answers = []
    for field in content['fields']:
        if not field['enabled']:
            continue
        key = field['key']
        raw = data.get(key) if key in BUILTIN_FIELDS else extra.get(key)
        if raw is not None and not isinstance(raw, str):
            raise ValueError(f'Thông tin {field["label"]} không hợp lệ.')
        value = str(raw or '').strip()
        if len(value) > (1000 if key == 'address' else 4000 if key not in BUILTIN_FIELDS else 255):
            raise ValueError(f'{field["label"]} quá dài.')
        if field['required'] and not value:
            raise ValueError(f'Vui lòng điền {field["label"]}.')
        if value:
            try:
                if field['type'] == 'email':
                    validate_email(value)
                elif field['type'] == 'date':
                    timezone.datetime.strptime(value, '%Y-%m-%d')
                elif field['type'] == 'select' and value not in field['options']:
                    raise ValueError()
            except (ValueError, ValidationError):
                raise ValueError(f'{field["label"]} không hợp lệ.')
        if key in BUILTIN_FIELDS:
            values[key] = value
        elif value:
            answers.append(dict(key=key, label=field['label'], value=value))
    return values, answers


@api_view(['GET', 'POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@parser_classes([MultiPartParser, FormParser])
def public_registration(request):
    page = get_page()
    if not page.published:
        return Response({'error': 'Trang đăng ký đang tạm đóng. Vui lòng quay lại sau.'}, status=403)
    content = page_content(page.published_content)
    if request.method == 'GET':
        return Response({
            'content': content, 'competitions': competitions(content),
        })

    data = request.data
    if clean(data, 'website', 200):
        return Response({'error': 'Không thể gửi biểu mẫu.'}, status=400)
    try:
        request_key = uuid.UUID(clean(data, 'requestKey', 40))
    except (ValueError, AttributeError):
        return Response({'error': 'Mã lượt gửi không hợp lệ. Vui lòng tải lại trang.'}, status=400)
    existing = PublicExamRegistration.objects.select_related('candidate').filter(request_key=request_key).first()
    if existing:
        return Response(registration_payload(existing), status=200)

    try:
        codes = json.loads(str(data.get('contestCodes') or '[]'))
    except (TypeError, ValueError):
        codes = None
    available = dict(open_sessions())
    if content['competitionCodes']:
        available = {code: session for code, session in available.items() if code in content['competitionCodes']}
    if not isinstance(codes, list) or not codes or any(not isinstance(code, str) for code in codes) or len(codes) > len(available) or len(set(codes)) != len(codes) or any(code not in available for code in codes):
        return Response({'error': 'Vui lòng chọn ít nhất một cuộc thi đang nhận đăng ký.'}, status=400)

    try:
        values, custom_answers = submission_values(content, data)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=400)
    data = {**data.dict(), **values}
    name = format_person_name(clean(data, 'name', 255))
    dob = clean(data, 'birthDate', 10)
    identity = re.sub(r'\s+', '', clean(data, 'identity', 100))
    email = clean(data, 'email', 255).casefold()
    phone = re.sub(r'[\s().-]', '', clean(data, 'phone', 32))
    school = clean(data, 'school', 255)
    grade = clean(data, 'grade', 2)
    city = clean(data, 'city', 100)
    ward = clean(data, 'ward', 255)
    address = clean(data, 'address', 1000)
    try:
        birthday = timezone.datetime.strptime(dob, '%Y-%m-%d').date() if dob else None
        mime, proof = proof_type(request.FILES.get('proof') if content['paymentEnabled'] else None)
    except (ValueError, ValidationError):
        return Response({'error': 'Ngày sinh, email hoặc tệp xác nhận không hợp lệ.'}, status=400)
    if not valid_candidate_name(name) or (birthday and (birthday >= timezone.localdate() or birthday.year < 1900)):
        return Response({'error': 'Vui lòng kiểm tra họ tên và ngày sinh.'}, status=400)
    if (phone and not PHONE_PATTERN.fullmatch(phone)) or (grade and not GRADE_PATTERN.fullmatch(grade)):
        return Response({'error': 'Số điện thoại hoặc khối lớp không hợp lệ.'}, status=400)
    if identity and (len(identity) < 6 or len(identity) > 100):
        return Response({'error': 'CCCD/Hộ chiếu không hợp lệ.'}, status=400)

    ip = request.META.get('HTTP_X_REAL_IP') or request.META.get('REMOTE_ADDR') or ''
    ip_hash = hashlib.sha256(f'{settings.SECRET_KEY}:{ip}'.encode()).hexdigest()
    if PublicExamRegistration.objects.filter(source_ip_hash=ip_hash, created_at__gte=timezone.now() - timedelta(hours=1)).count() >= 20:
        return Response({'error': 'Có quá nhiều lượt đăng ký. Vui lòng thử lại sau.'}, status=429)

    with transaction.atomic():
        existing = PublicExamRegistration.objects.select_related('candidate').filter(request_key=request_key).first()
        if existing:
            return Response(registration_payload(existing), status=200)
        try:
            candidate = matching_candidate(name, dob, identity, email, phone)
        except ValueError:
            return Response({'error': 'Thông tin thí sinh cần được khảo thí kiểm tra. Vui lòng liên hệ ban tổ chức.'}, status=409)
        if candidate and CandidateParticipation.objects.filter(candidate=candidate, session_id__in=[available[code].id for code in codes]).exists():
            return Response({'error': 'Thí sinh đã có đăng ký ở một trong các cuộc thi đã chọn. Vui lòng liên hệ ban tổ chức để cập nhật.'}, status=409)
        if candidate is None:
            candidate_code = next_code(set(Candidate.objects.values_list('code', flat=True)))
            candidate = Candidate.objects.create(
                id=candidate_code, code=candidate_code, name=name, birth_date=dob,
                identity=identity, email=email, phone=phone, school=school, grade=grade,
                city=city, ward=ward, address=address, contests=merge_contest_codes(', '.join(codes)),
                session_ids=[available[code].id for code in codes],
                sort_key=f'{name.lower()}_{identity or candidate_code}',
                updated=timezone.localtime().strftime('%d/%m/%Y %H:%M'),
            )
        else:
            candidate.contests = merge_contest_codes(candidate.contests, ', '.join(codes))
            candidate.session_ids = list(dict.fromkeys([*(candidate.session_ids or []), *[available[code].id for code in codes]]))
            for key, value in {'identity': identity, 'school': school, 'grade': grade, 'city': city, 'ward': ward, 'address': address}.items():
                if value and not getattr(candidate, key):
                    setattr(candidate, key, value)
            candidate.save()
        registration = PublicExamRegistration.objects.create(
            request_key=request_key, candidate=candidate, contest_codes=codes,
            payment_declared=content['paymentEnabled'] and str(data.get('paymentDeclared') or '').lower() == 'true',
            proof=proof, proof_type=mime, source_ip_hash=ip_hash,
        )
        for code in codes:
            participation = CandidateParticipation.objects.create(
                candidate=candidate, session=available[code],
                source=f'Workspace #{registration.id}',
                registration_data={
                    'publicRegistrationId': str(registration.id),
                    'paymentProof': f'Workspace #{registration.id}' if proof else '',
                    'paymentDeclared': registration.payment_declared,
                    'customAnswers': custom_answers,
                },
            )
            if proof:
                TransferProof.objects.create(billing=participation.billing, session=available[code], image=proof, image_type=mime,
                                            filename=f'registration-{registration.id}', created_by=email)
        sync_session_candidate_totals()
    return Response(registration_payload(registration), status=201)


@api_view(['GET'])
@permission_classes([IsWorkspaceAuthenticated])
def public_registration_proof(request, pk):
    modules = request_modules(request)
    if request_role(request) != 'ADMIN' and not ({'finance-report', 'examination'} & set(modules)):
        return Response({'error': 'Không có quyền xem chứng từ.'}, status=403)
    item = PublicExamRegistration.objects.filter(pk=pk).first()
    if not item or not item.proof:
        return Response({'error': 'Không tìm thấy chứng từ.'}, status=404)
    response = HttpResponse(bytes(item.proof), content_type=item.proof_type)
    response['Content-Disposition'] = 'inline; filename="xac-nhan-thanh-toan"'
    response['Cache-Control'] = 'private, no-store'
    return response


def signed_script_request(request):
    secret = os.environ.get('EXAMINATION_REGISTRATION_WEBHOOK_SECRET', '').strip()
    supplied = request.headers.get('X-Examination-Webhook-Secret', '')
    return bool(secret) and hmac.compare_digest(secret, supplied)


def export_tabs(item):
    return [tab for tab, allowed in TAB_CODES.items() if any(code in allowed for code in item.contest_codes)]


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def workspace_pending(request):
    """The Sheet owner's Apps Script pulls pending web registrations."""
    if not signed_script_request(request):
        return Response({'error': 'Khóa đồng bộ không hợp lệ.'}, status=403)
    rows = []
    for item in PublicExamRegistration.objects.select_related('candidate').defer('proof').exclude(sheet_status='synced').order_by('created_at')[:20]:
        tabs = {tab: row_for(item, tab) for tab in export_tabs(item) if tab not in (item.sheet_rows or {})}
        if tabs:
            rows.append({'registrationId': str(item.id), 'tabs': tabs})
    return Response({'registrations': rows})


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def workspace_ack(request):
    if not signed_script_request(request):
        return Response({'error': 'Khóa đồng bộ không hợp lệ.'}, status=403)
    try:
        pk = uuid.UUID(str(request.data.get('registrationId') or ''))
        row_number = int(request.data.get('rowNumber'))
    except (ValueError, TypeError):
        return Response({'error': 'Mã đăng ký hoặc dòng Sheet không hợp lệ.'}, status=400)
    tab = str(request.data.get('sheetTab') or '')
    with transaction.atomic():
        item = PublicExamRegistration.objects.select_for_update().filter(pk=pk).first()
        if not item or tab not in export_tabs(item) or row_number < 2:
            return Response({'error': 'Dòng đồng bộ không hợp lệ.'}, status=400)
        rows = dict(item.sheet_rows or {})
        rows[tab] = row_number
        item.sheet_rows = rows
        item.sheet_status = 'synced' if all(name in rows for name in export_tabs(item)) else 'pending'
        item.sheet_error = ''
        item.save(update_fields=['sheet_rows', 'sheet_status', 'sheet_error', 'updated_at'])
    return Response({'status': item.sheet_status})
