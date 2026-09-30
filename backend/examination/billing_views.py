"""Persistent accounting reconciliation for examination registrations."""

from decimal import Decimal, InvalidOperation
import unicodedata

from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from authentication.notifications import notify_workspace
from authentication.permissions import IsWorkspaceAuthenticated, request_modules, request_role
from .models import CandidateParticipation, ExaminationBillingRecord, UnmatchedTransfer


def allowed(request, module):
    return request_role(request) == 'ADMIN' or module in request_modules(request)


def finance_writer(request):
    if request_role(request) == 'ADMIN':
        return True
    if not allowed(request, 'finance-report'):
        return False
    profile = request.user
    labels = [str(getattr(getattr(profile, 'job_title', None), 'name', '') or '')]
    if getattr(profile, 'department_id', None):
        labels.append(str(profile.department.name))
    if hasattr(profile, 'departments'):
        labels.extend(profile.departments.values_list('name', flat=True))
    normalized = unicodedata.normalize('NFD', ' '.join(labels).casefold())
    normalized = ''.join(ch for ch in normalized if unicodedata.category(ch) != 'Mn').replace('đ', 'd')
    return 'ke toan' in normalized


def actor(request):
    return str(getattr(request.user, 'email', '') or '')[:255]


def parse_amount(value):
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError('Số tiền không hợp lệ.')
    if amount != amount.to_integral_value() or amount <= 0 or amount > 999999999999:
        raise ValueError('Số tiền phải là số nguyên dương, tối đa 999.999.999.999đ.')
    return amount


def session_is_past(session, today=None):
    """Keep sessions with future or undated later rounds in current accounting."""
    from .views import dated_session_rounds, _phase_key
    today = today or timezone.localdate()
    if _phase_key(session.phase) in {'hoan thanh', 'ket thuc', 'da ket thuc'}:
        return True
    dated = dated_session_rounds(session)
    if not dated or dated[-1][0] >= today:
        return False
    last_position = max(item[1] for item in dated)
    if any(position > last_position and isinstance(item, dict) and str(item.get('name') or '').strip()
           for position, item in enumerate(session.rounds or [])):
        return False
    return True


def scoped_billing_rows(request):
    scope = request.query_params.get('scope', 'active')
    if scope not in {'active', 'past', 'all'}:
        raise ValueError('Bộ lọc kỳ thi không hợp lệ.')
    rows = ExaminationBillingRecord.objects.select_related('participation__candidate', 'participation__session').order_by('-participation__created_at')
    past_sessions = {}
    selected = []
    today = timezone.localdate()
    for item in rows:
        session = item.participation.session
        if session.pk not in past_sessions:
            past_sessions[session.pk] = session_is_past(session, today)
        if scope == 'all' or past_sessions[session.pk] == (scope == 'past'):
            selected.append(item)
    return selected


def billing_payload(item):
    participation = item.participation
    candidate = participation.candidate
    session = participation.session
    registration_data = participation.registration_data or {}
    return {
        'id': str(item.pk), 'candidateName': candidate.name,
        'candidateCode': candidate.code, 'competitionCode': session.code,
        'competitionName': session.name, 'sessionCode': session.code,
        'sessionId': session.pk, 'sessionPeriod': session.time,
        'school': candidate.school or '', 'registeredAt': participation.created_at.isoformat(),
        'amount': int(item.amount) if item.amount is not None else None,
        'paymentProof': str(registration_data.get('paymentProof') or ''),
        'paymentProofId': registration_data.get('publicRegistrationId') if str(registration_data.get('paymentProof') or '').startswith('Workspace #') else '',
        'transferStatus': item.transfer_status, 'transferReference': item.transfer_reference,
        'transferConfirmedAt': item.transfer_confirmed_at.isoformat() if item.transfer_confirmed_at else None,
        'transferConfirmedBy': item.transfer_confirmed_by or None,
        'invoiceStatus': item.invoice_status, 'invoiceNumber': item.invoice_number,
        'invoiceCheckedAt': item.invoice_checked_at.isoformat() if item.invoice_checked_at else None,
        'invoiceCheckedBy': item.invoice_checked_by or None,
        'seenByAccountant': item.seen_by_accountant, 'note': item.note,
    }


def unmatched_payload(item):
    participation = item.matched_participation
    return {
        'id': str(item.pk), 'amount': int(item.amount), 'reference': item.reference,
        'note': item.note, 'hasImage': bool(item.image), 'status': item.status,
        'resolutionNote': item.resolution_note, 'candidateCode': participation.candidate.code if participation else '',
        'competitionCode': participation.session.code if participation else '',
        'createdBy': item.created_by, 'resolvedBy': item.resolved_by,
        'createdAt': item.created_at.isoformat(), 'updatedAt': item.updated_at.isoformat(),
    }


def finance_or_exam(request):
    return allowed(request, 'finance-report') or allowed(request, 'examination')


@api_view(['GET'])
@permission_classes([IsWorkspaceAuthenticated])
def records(request):
    if not allowed(request, 'finance-report'):
        return Response({'error': 'Không có quyền xem đối soát.'}, status=403)
    try:
        rows = scoped_billing_rows(request)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=400)
    return Response([billing_payload(item) for item in rows])


@api_view(['GET'])
@permission_classes([IsWorkspaceAuthenticated])
def stats(request):
    if not allowed(request, 'finance-report'):
        return Response({'error': 'Không có quyền xem đối soát.'}, status=403)
    try:
        rows = scoped_billing_rows(request)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=400)
    settled = {'checked', 'not_required'}
    return Response({
        'newCandidates': sum(not x.seen_by_accountant for x in rows),
        'awaitingTransfer': sum(x.transfer_status != 'confirmed' for x in rows),
        'awaitingInvoice': sum(x.transfer_status == 'confirmed' and x.invoice_status not in settled for x in rows),
        'completed': sum(x.transfer_status == 'confirmed' and x.invoice_status in settled for x in rows),
        'totalAmount': sum(int(x.amount or 0) for x in rows),
        'collectedAmount': sum(int(x.amount or 0) for x in rows if x.transfer_status == 'confirmed'),
    })


@api_view(['POST'])
@permission_classes([IsWorkspaceAuthenticated])
def seen(request):
    if not finance_writer(request):
        return Response({'error': 'Không có quyền cập nhật đối soát.'}, status=403)
    ids = request.data.get('ids') or []
    if not isinstance(ids, list) or len(ids) > 1000:
        return Response({'error': 'Danh sách không hợp lệ.'}, status=400)
    count = ExaminationBillingRecord.objects.filter(pk__in=ids, seen_by_accountant=False).update(seen_by_accountant=True)
    return Response({'seen': count})


@api_view(['POST'])
@permission_classes([IsWorkspaceAuthenticated])
def record_action(request, pk, action):
    if not finance_writer(request):
        return Response({'error': 'Chỉ kế toán được cập nhật đối soát.'}, status=403)
    item = ExaminationBillingRecord.objects.select_related('participation__candidate', 'participation__session').filter(pk=pk).first()
    if not item:
        return Response({'error': 'Không tìm thấy hồ sơ đối soát.'}, status=404)
    data = request.data or {}
    now = timezone.now()
    if action == 'amount':
        try:
            item.amount = parse_amount(data.get('amount'))
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
    elif action == 'transfer':
        if item.amount is None:
            return Response({'error': 'Cần nhập số tiền phải thu trước khi xác nhận.'}, status=400)
        item.transfer_status = 'confirmed'
        item.transfer_reference = str(data.get('reference') or '').strip()[:255]
        item.transfer_confirmed_at = now
        item.transfer_confirmed_by = actor(request)
    elif action == 'transfer-mismatch':
        item.transfer_status = 'mismatch'
        item.note = str(data.get('note') or '').strip()[:3000]
        if not item.note:
            return Response({'error': 'Cần mô tả sai lệch.'}, status=400)
    elif action == 'invoice':
        number = str(data.get('invoiceNumber') or '').strip()[:255]
        if not number:
            return Response({'error': 'Cần nhập số hóa đơn.'}, status=400)
        item.invoice_status = 'checked'
        item.invoice_number = number
        item.invoice_checked_at = now
        item.invoice_checked_by = actor(request)
    elif action == 'invoice-issue':
        item.invoice_status = 'issue'
        item.note = str(data.get('note') or '').strip()[:3000]
        if not item.note:
            return Response({'error': 'Cần mô tả vấn đề hóa đơn.'}, status=400)
    elif action == 'invoice-skip':
        item.invoice_status = 'not_required'
    else:
        return Response({'error': 'Thao tác không hợp lệ.'}, status=400)
    item.seen_by_accountant = True
    item.save()
    return Response(billing_payload(item))


@api_view(['GET', 'POST'])
@parser_classes([JSONParser, FormParser, MultiPartParser])
@permission_classes([IsWorkspaceAuthenticated])
def unmatched_list(request):
    if not finance_or_exam(request):
        return Response({'error': 'Không có quyền xem khoản thu chưa xác định.'}, status=403)
    if request.method == 'GET':
        return Response([unmatched_payload(item) for item in UnmatchedTransfer.objects.select_related('matched_participation__candidate', 'matched_participation__session').order_by('-created_at')])
    if not finance_writer(request):
        return Response({'error': 'Chỉ kế toán được tạo khoản thu.'}, status=403)
    try:
        amount = parse_amount(request.data.get('amount'))
    except ValueError as exc:
        return Response({'error': str(exc)}, status=400)
    image = request.FILES.get('image')
    image_bytes = None
    image_type = ''
    if image:
        if image.size > 5 * 1024 * 1024:
            return Response({'error': 'Ảnh tối đa 5 MB.'}, status=400)
        image_bytes = image.read()
        if image_bytes.startswith(b'\x89PNG\r\n\x1a\n'):
            image_type = 'image/png'
        elif image_bytes.startswith(b'\xff\xd8\xff'):
            image_type = 'image/jpeg'
        elif image_bytes.startswith(b'RIFF') and image_bytes[8:12] == b'WEBP':
            image_type = 'image/webp'
        else:
            return Response({'error': 'Chỉ nhận ảnh PNG, JPEG hoặc WebP.'}, status=400)
    item = UnmatchedTransfer.objects.create(
        amount=amount, reference=str(request.data.get('reference') or '').strip()[:255],
        note=str(request.data.get('note') or '').strip()[:3000],
        image=image_bytes, image_type=image_type, created_by=actor(request),
    )
    notify_workspace(
        event_key=f'examination:unmatched-transfer:{item.pk}',
        title='Khoản chuyển khoản chưa xác định',
        message=f'Kế toán cần khảo thí tìm thí sinh cho khoản {int(amount):,}đ.',
        severity='warning', category='examination', action_url='/examination/unmatched-transfers',
        target_modules=['examination'],
    )
    return Response(unmatched_payload(item), status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsWorkspaceAuthenticated])
def unmatched_image(request, pk):
    if not finance_or_exam(request):
        return Response({'error': 'Không có quyền xem ảnh.'}, status=403)
    item = UnmatchedTransfer.objects.filter(pk=pk).first()
    if not item or not item.image:
        return Response({'error': 'Không tìm thấy ảnh.'}, status=404)
    response = HttpResponse(bytes(item.image), content_type=item.image_type)
    response['Content-Disposition'] = 'inline; filename="transfer-image"'
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response


@api_view(['POST'])
@permission_classes([IsWorkspaceAuthenticated])
def resolve_unmatched(request, pk):
    if not allowed(request, 'examination'):
        return Response({'error': 'Chỉ khảo thí được xác minh thí sinh.'}, status=403)
    item = UnmatchedTransfer.objects.filter(pk=pk).first()
    if not item:
        return Response({'error': 'Không tìm thấy khoản thu.'}, status=404)
    note = str(request.data.get('resolutionNote') or '').strip()[:3000]
    if not note:
        return Response({'error': 'Cần ghi kết quả kiểm tra để báo lại kế toán.'}, status=400)
    code = str(request.data.get('candidateCode') or '').strip()
    competition = str(request.data.get('competitionCode') or '').strip()
    participation = None
    if code:
        matches = CandidateParticipation.objects.select_related('candidate', 'session').filter(candidate__code__iexact=code)
        if competition:
            matches = matches.filter(session__code__iexact=competition)
        if matches.count() != 1:
            return Response({'error': 'Cần chỉ rõ mã thí sinh và cuộc thi để xác định đúng một lượt đăng ký.'}, status=400)
        participation = matches.first()
    with transaction.atomic():
        item.status = 'matched' if participation else 'reviewed'
        item.matched_participation = participation
        item.resolution_note = note
        item.resolved_by = actor(request)
        item.save()
    notify_workspace(
        event_key=f'examination:unmatched-resolved:{item.pk}:{item.updated_at.timestamp()}',
        title='Khảo thí đã phản hồi khoản thu',
        message=f'{int(item.amount):,}đ · {note[:120]}',
        category='examination', action_url='/finance-report/examination-billing',
        target_modules=['finance-report'],
    )
    return Response(unmatched_payload(item))
