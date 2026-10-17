"""Duty details for invigilators, and the room output Sheet, from the Coi thi screen.

Each invigilator of a room receives one message: time, room, number of
candidates, a button to the attendance page (their private guest link, or the
Workspace page for staff) and a button to the online room. When outgoing mail
is configured (EMAIL_HOST…) Khảo thí sends them in one click; otherwise the
screen opens a pre-filled Gmail draft per invigilator.
"""
import logging
from html import escape
from urllib.parse import quote, urlencode

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.models import SystemConfig
from authentication.permissions import IsWorkspaceAuthenticated
from integrations.google_sheets import _service_account_info
from .invigilation import can_manage, guest_url
from .models import ExaminationSheet, ExamInvigilationShift, ExamSession, RoundResult

logger = logging.getLogger(__name__)
CONTACT = 'khaothi@fermat.vn · 0969 627 162'
ABSENT_AFTER_MINUTES = 15


def mail_configured():
    return bool(settings.EMAIL_HOST and settings.EMAIL_HOST_USER)


def _room(shift):
    number = str(shift.room_number or '').strip()
    return f'Phòng {number}' if number.isdigit() else number


def recipients(shift, origin):
    people = []
    if shift.guest_email and shift.guest_token:
        people.append({'name': shift.guest_name or shift.guest_email, 'email': shift.guest_email, 'kind': 'guest',
                       'url': f'{origin}{guest_url(shift)}'})
    for user in shift.invigilators.all():
        people.append({'name': user.name or user.email, 'email': user.email, 'kind': 'staff',
                       'url': f'{origin}/examination/invigilation/{shift.session_id}?shift={shift.pk}'})
    return people


def compose(shift, person, candidates):
    start, end = timezone.localtime(shift.starts_at), timezone.localtime(shift.ends_at)
    when = f'{start:%H:%M}–{end:%H:%M} ngày {start:%d/%m/%Y}'
    room = _room(shift)
    subject = f'[FermatTech] Lịch coi thi {shift.session.code} · {start:%H:%M %d/%m/%Y} · {room}'
    login_note = ('Trang điểm danh mở bằng chính email này (nhập email khi được hỏi). Link chỉ dành cho bạn, vui lòng không chuyển tiếp.'
                  if person['kind'] == 'guest' else 'Đăng nhập FT Workspace bằng tài khoản công ty để mở trang điểm danh.')
    lines = [
        f'Chào {person["name"]},', '',
        f'Ban tổ chức gửi bạn thông tin ca coi thi {shift.session.code} – {shift.round_name}:',
        f'• Thời gian: {when} (giờ Việt Nam)', f'• Phòng: {room}', f'• Số thí sinh: {candidates}', '',
        f'Trang điểm danh: {person["url"]}',
    ]
    if shift.room_link:
        lines.append(f'Phòng thi trực tuyến: {shift.room_link}')
    lines += ['', 'Lưu ý:', f'• {login_note}', '• Vào phòng thi trước giờ bắt đầu khoảng 15 phút.',
              f'• Sau {ABSENT_AFTER_MINUTES} phút kể từ giờ thi, thí sinh chưa được điểm danh sẽ tự chuyển sang "Vắng"; em vào muộn thì bấm "Muộn" để sửa.',
              '• Ghi chú sự cố (mất kết nối, thoát phòng…) ngay tại dòng của thí sinh.', '',
              f'Cần hỗ trợ: {CONTACT}', '', 'Trân trọng,', 'Ban Khảo thí FermatTech']
    text = '\n'.join(lines)
    button = ('display:inline-block;padding:12px 20px;margin:4px 8px 4px 0;border-radius:10px;'
              'font-weight:700;text-decoration:none;font-family:Arial,sans-serif;font-size:15px;')
    meet = (f'<a href="{escape(shift.room_link)}" style="{button}background:#ffffff;color:#047857;border:2px solid #047857">Vào phòng thi (Google Meet)</a>'
            if shift.room_link else '')
    html = f"""<div style="font-family:Arial,sans-serif;color:#0f172a;max-width:560px;line-height:1.6">
<p>Chào <b>{escape(person['name'])}</b>,</p>
<p>Ban tổ chức gửi bạn thông tin ca coi thi <b>{escape(shift.session.code)} – {escape(shift.round_name)}</b>:</p>
<table style="border-collapse:collapse;margin:8px 0 16px">
<tr><td style="padding:4px 16px 4px 0;color:#64748b">Thời gian</td><td><b>{escape(when)}</b> (giờ Việt Nam)</td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#64748b">Phòng</td><td><b>{escape(room)}</b></td></tr>
<tr><td style="padding:4px 16px 4px 0;color:#64748b">Số thí sinh</td><td><b>{candidates}</b></td></tr>
</table>
<p><a href="{escape(person['url'])}" style="{button}background:#001e40;color:#ffffff;border:2px solid #001e40">Mở trang điểm danh</a>{meet}</p>
<p style="margin-top:20px"><b>Lưu ý</b></p>
<ul style="padding-left:20px;margin:4px 0">
<li>{escape(login_note)}</li>
<li>Vào phòng thi trước giờ bắt đầu khoảng 15 phút.</li>
<li>Sau {ABSENT_AFTER_MINUTES} phút kể từ giờ thi, thí sinh chưa được điểm danh sẽ tự chuyển sang “Vắng”; em vào muộn thì bấm “Muộn” để sửa.</li>
<li>Ghi chú sự cố (mất kết nối, thoát phòng…) ngay tại dòng của thí sinh.</li>
</ul>
<p style="color:#64748b;font-size:13px;margin-top:20px">Cần hỗ trợ: {escape(CONTACT)}<br>Trân trọng,<br>Ban Khảo thí FermatTech</p>
</div>"""
    gmail = 'https://mail.google.com/mail/?' + urlencode({'view': 'cm', 'fs': '1', 'to': person['email'], 'su': subject, 'body': text}, quote_via=quote)
    return {'subject': subject, 'text': text, 'html': html, 'gmailUrl': gmail}


def _shifts(session_id):
    return list(ExamInvigilationShift.objects.filter(session_id=session_id, exam_room__isnull=False)
                .select_related('session').prefetch_related('invigilators').order_by('starts_at', 'room_number'))


def _counts(shifts):
    rows = RoundResult.objects.filter(exam_room_id__in=[s.exam_room_id for s in shifts]).values('exam_room_id').annotate(n=Count('pk'))
    return {row['exam_room_id']: row['n'] for row in rows}


def _origin(request):
    return request.build_absolute_uri('/').rstrip('/')


@api_view(['GET', 'POST'])
@permission_classes([IsWorkspaceAuthenticated])
def notify_invigilators(request):
    if not can_manage(request):
        return Response({'error': 'Chỉ quản lý khảo thí được gửi thông tin cho giám thị.'}, status=403)
    session_id = str(request.query_params.get('sessionId') or request.data.get('sessionId') or '')
    get_object_or_404(ExamSession, pk=session_id)
    shifts, origin = _shifts(session_id), _origin(request)
    counts = _counts(shifts)
    if request.method == 'GET':
        items = []
        for shift in shifts:
            people = [{**{k: v for k, v in person.items() if k != 'url'}, **{k: v for k, v in compose(shift, person, counts.get(shift.exam_room_id, 0)).items() if k in ('gmailUrl',)}}
                      for person in recipients(shift, origin)]
            preview = compose(shift, recipients(shift, origin)[0], counts.get(shift.exam_room_id, 0)) if people else None
            items.append({'shiftId': str(shift.pk), 'room': _room(shift), 'startsAt': shift.starts_at.isoformat(),
                          'enabled': shift.enabled, 'recipients': people, 'notifiedAt': shift.notified_at.isoformat() if shift.notified_at else '',
                          'previewHtml': preview['html'] if preview else '', 'previewSubject': preview['subject'] if preview else ''})
        return Response({'mailConfigured': mail_configured(), 'items': items})
    if not mail_configured():
        return Response({'error': 'Hệ thống chưa được cài tài khoản gửi email. Hãy dùng nút "Soạn trong Gmail".'}, status=400)
    wanted = {str(value) for value in (request.data.get('shiftIds') or [])}
    sent, failed = [], []
    for shift in shifts:
        if str(shift.pk) not in wanted:
            continue
        ok = True
        for person in recipients(shift, origin):
            message = compose(shift, person, counts.get(shift.exam_room_id, 0))
            mail = EmailMultiAlternatives(message['subject'], message['text'], settings.DEFAULT_FROM_EMAIL, [person['email']],
                                          reply_to=['khaothi@fermat.vn'])
            mail.attach_alternative(message['html'], 'text/html')
            try:
                mail.send(fail_silently=False)
                sent.append(f"{_room(shift)} → {person['email']}")
            except Exception as exc:  # one address failing never stops the others
                ok = False
                logger.warning('Gửi email coi thi thất bại (%s): %s', person['email'], exc)
                failed.append(f"{_room(shift)} → {person['email']}: {exc}")
        if ok and recipients(shift, origin):
            ExamInvigilationShift.objects.filter(pk=shift.pk).update(notified_at=timezone.now())
    return Response({'sent': sent, 'failed': failed})


def service_account_email():
    config = SystemConfig.objects.filter(key='main').first()
    try:
        info = _service_account_info(config.data if config and isinstance(config.data, dict) else {})
    except ValueError:
        info = None
    return (info or {}).get('client_email', '')


@api_view(['GET', 'POST'])
@permission_classes([IsWorkspaceAuthenticated])
def room_sheet(request):
    """Where the room output Sheet of a session is, and attach one from Coi thi."""
    if not can_manage(request):
        return Response({'error': 'Chỉ quản lý khảo thí được gắn Sheet phân phòng.'}, status=403)
    session = get_object_or_404(ExamSession, pk=str(request.query_params.get('sessionId') or request.data.get('sessionId') or ''))
    if request.method == 'POST':
        from integrations.google_sheets import extract_spreadsheet_id
        from .views import ensure_room_sheet_source
        url = str(request.data.get('url') or '').strip()
        if url and not extract_spreadsheet_id(url):
            return Response({'error': 'Link Google Sheet không hợp lệ.'}, status=400)
        ensure_room_sheet_source(session, url, created_by=getattr(request.user, 'email', None))
        if url:
            from .room_sheet import mark_room_sheet_dirty
            from .candidate_sheet_queue import launch_candidate_sheet_worker
            mark_room_sheet_dirty(session.pk)
            launch_candidate_sheet_worker()
    sheet = ExaminationSheet.objects.filter(session_id=session.pk, stage='room-output').first()
    return Response({
        'url': sheet.url if sheet else '',
        'lastExportAt': sheet.last_export_at.isoformat() if sheet and sheet.last_export_at else '',
        'lastError': sheet.last_error if sheet else '',
        'pending': bool(sheet and sheet.url and not sheet.last_content_fingerprint),
        'serviceAccount': service_account_email(),
    })
