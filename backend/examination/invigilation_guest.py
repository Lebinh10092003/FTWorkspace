"""Invigilation for proctors without a Workspace account.

Khảo thí shares one secret link per room (/coi-thi/<token>). The invigilator
types their name once; every save is audited under that name. The link only
opens around the duty (from a day before the start until 12 hours after the
end, so scores can still be entered), and it dies when the duty is disabled or
the link is rotated or revoked.
"""
from datetime import timedelta
from urllib.parse import unquote

from django.utils import timezone
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .invigilation import apply_roster_change, auto_mark_absent, serialize_shift
from .models import ExamInvigilationShift

OPENS_BEFORE = timedelta(hours=24)
CLOSES_AFTER = timedelta(hours=12)
MIN_TOKEN_LENGTH = 24


def _guest_shift(token):
    """(shift, error response). Unknown and revoked links look the same."""
    token = str(token or '')
    shift = (ExamInvigilationShift.objects.select_related('session').prefetch_related('invigilators')
             .filter(guest_token=token).first() if len(token) >= MIN_TOKEN_LENGTH else None)
    if not shift or not shift.exam_room_id:
        return None, Response({'error': 'Link coi thi không tồn tại hoặc đã bị thu hồi. Hãy liên hệ Ban tổ chức.'}, status=404)
    if not shift.enabled:
        return None, Response({'error': 'Ca thi này đã tắt. Hãy liên hệ Ban tổ chức.'}, status=403)
    now = timezone.now()
    if now < shift.starts_at - OPENS_BEFORE:
        local = timezone.localtime(shift.starts_at - OPENS_BEFORE)
        return None, Response({'error': f'Link mở từ {local:%H:%M %d/%m/%Y}.'}, status=403)
    if now > shift.ends_at + CLOSES_AFTER:
        return None, Response({'error': 'Ca thi đã kết thúc, link không còn dùng được.'}, status=403)
    return shift, None


def _guest_name(request):
    # Sent as a header (URL-encoded, Vietnamese names are not ASCII) or in the body.
    raw = request.headers.get('X-Guest-Name') or request.data.get('guestName') or ''
    name = ' '.join(unquote(str(raw)).split())
    return name[:100]


def _email_check(request, shift):
    """A link tied to an invigilator's e-mail opens only for that address."""
    if not shift.guest_email:
        return None
    typed = str(request.headers.get('X-Guest-Email') or '').strip().lower()
    if typed == shift.guest_email:
        return None
    message = ('Email chưa đúng với giám thị được phân công phòng này.' if typed
               else 'Nhập email đã đăng ký làm giám thị để mở phòng thi.')
    return Response({'error': message, 'needEmail': True}, status=401)


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def guest_shift(request, token):
    shift, error = _guest_shift(token)
    if error:
        return error
    denied = _email_check(request, shift)
    if denied:
        return denied
    # Khảo thí sees on Coi thi that the invigilator received the link and got in.
    now = timezone.now()
    ExamInvigilationShift.objects.filter(pk=shift.pk).update(guest_seen_at=now)
    ExamInvigilationShift.objects.filter(pk=shift.pk, guest_opened_at__isnull=True).update(guest_opened_at=now)
    auto_mark_absent()
    value = serialize_shift(shift, include_roster=True)
    # Staff e-mail addresses stay inside Workspace; the guest sees names only.
    value['invigilators'] = [{'email': '', 'name': item['name']} for item in value['invigilators']]
    value['sheetUrl'] = ''
    value['actionUrl'] = ''
    value['guestName'] = shift.guest_name
    response = Response({'serverNow': timezone.now().isoformat(), 'shift': value})
    response['Cache-Control'] = 'no-store'
    return response


@api_view(['PATCH'])
@authentication_classes([])
@permission_classes([AllowAny])
def guest_roster_update(request, token, code):
    shift, error = _guest_shift(token)
    if error:
        return error
    denied = _email_check(request, shift)
    if denied:
        return denied
    name = shift.guest_name or _guest_name(request)
    if not name:
        return Response({'error': 'Vui lòng nhập họ tên giám thị trước khi điểm danh.'}, status=400)
    return apply_roster_change(shift, code, request.data, actor=None, actor_label=f'{name} (giám thị ngoài)')
