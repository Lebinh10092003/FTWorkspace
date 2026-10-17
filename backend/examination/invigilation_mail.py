"""Duty details for invigilators, and the room output Sheet, from the Coi thi screen.

Each invigilator of a room receives one message: time, room, number of
candidates, a button to the attendance page (their private guest link, or the
Workspace page for staff) and a button to the online room. When outgoing mail
is configured (EMAIL_HOST…) Khảo thí sends them in one click; otherwise the
screen opens a pre-filled Gmail draft per invigilator.
"""
import logging
from datetime import timedelta
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
CONTACT_PHONE = '0969 627 162'
CONTACT_EMAIL = 'khaothi@fermat.vn'
ADDRESS = 'Phòng 1603, Eurowindow Multi Complex, 27 Trần Duy Hưng, phường Yên Hòa, Hà Nội'
ABSENT_AFTER_MINUTES = 15
ARRIVE_BEFORE_MINUTES = 30
WEEKDAYS = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật']


def _school_year(day):
    first = day.year if day.month >= 8 else day.year - 1
    return f'{first}–{first + 1}'


def _competition_title(shift):
    """'Olympic … (FIEO)' from the competition record, or the code alone."""
    from .models import Competition
    code = shift.session.code
    competition = Competition.objects.filter(pk=shift.session.competition_id).only('name').first()
    name = ' '.join(str(competition.name if competition else '').split())
    return f'{name} ({code})' if name and name.upper() != code.upper() else code


def _batch(shift):
    """'Đợt 1' etc. from the session's round configuration, if the round has batches."""
    for round_config in shift.session.rounds or []:
        if not isinstance(round_config, dict):
            continue
        for slot in round_config.get('slots') or []:
            if isinstance(slot, dict) and str(slot.get('id') or '') == shift.occurrence_id:
                return str(slot.get('label') or '').strip()
    return ''


def _mode(shift):
    link = str(shift.room_link or '').lower()
    if 'meet.google' in link:
        return 'Trực tuyến qua Google Meet'
    if 'zoom.' in link:
        return 'Trực tuyến qua Zoom'
    if link:
        return 'Trực tuyến'
    location = shift.exam_room.location if shift.exam_room_id and shift.exam_room else ''
    return f'Trực tiếp tại {location}' if location else 'Trực tiếp'


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
    """The invitation approved by Khảo thí (17/10/2026), filled from the session's own data."""
    start, end = timezone.localtime(shift.starts_at), timezone.localtime(shift.ends_at)
    code, room = shift.session.code, _room(shift)
    year = _school_year(start.date())
    batch = _batch(shift)
    stage = f'{shift.round_name}, {batch.lower()}' if batch else shift.round_name
    day = f'{WEEKDAYS[start.weekday()]}, ngày {start:%d/%m/%Y}'
    arrive = start - timedelta(minutes=ARRIVE_BEFORE_MINUTES)
    absent = start + timedelta(minutes=ABSENT_AFTER_MINUTES)
    confirm_by = (start - timedelta(days=1)).replace(hour=20, minute=0)
    online = bool(shift.room_link)
    guest = person['kind'] == 'guest'
    subject = f'[FermatTech] Thư mời coi thi {code} {year} – {stage} – Ngày {start:%d/%m/%Y}'
    rows = [('Kỳ thi', f'{code} {year} – {stage}'), ('Thời gian thi', f'{start:%H:%M} – {end:%H:%M}, {day} (giờ Việt Nam)'),
            ('Phòng thi', room), ('Số thí sinh', str(candidates)), ('Hình thức', _mode(shift))]
    duties = [
        f'{"Vào phòng thi" if online else "Có mặt tại phòng thi"} trước {arrive:%H:%M} để kiểm tra {"kết nối, âm thanh và hình ảnh" if online else "phòng thi và danh sách thí sinh"}.',
        f'Điểm danh thí sinh trên trang điểm danh ngay khi thí sinh vào phòng. Sau {absent:%H:%M}, thí sinh chưa được điểm danh sẽ tự động chuyển sang "Vắng"; nếu thí sinh vào muộn, Anh/Chị chọn "Muộn" để cập nhật.',
        f'Theo dõi thí sinh trong suốt thời gian làm bài. Ghi chú mọi sự cố ({"mất kết nối, rời phòng, tắt camera…" if online else "đến muộn, rời phòng, vi phạm quy chế…"}) ngay tại dòng của thí sinh đó.',
        'Chỉ rời phòng sau khi thí sinh cuối cùng nộp bài hoặc hết giờ thi.',
    ]
    notes = [
        ('Trang điểm danh là link riêng của Anh/Chị và chỉ mở được bằng địa chỉ email nhận thư này. Vui lòng không chuyển tiếp thư hoặc link cho người khác.'
         if guest else 'Trang điểm danh mở bằng tài khoản FT Workspace của Anh/Chị.'),
        'Thông tin cá nhân của thí sinh chỉ được sử dụng cho ca coi thi này. Vui lòng không sao chép, lưu giữ hay chia sẻ ra bên ngoài.',
    ]
    intro = (f'Ban Tổ chức Kỳ thi {_competition_title(shift)} năm học {year} trân trọng cảm ơn Anh/Chị đã nhận lời tham gia '
             'công tác coi thi. Ban Tổ chức xin gửi Anh/Chị thông tin ca coi thi như sau:')
    confirm = (f'Anh/Chị vui lòng trả lời thư này để xác nhận tham gia trước {confirm_by:%H:%M} ngày {confirm_by:%d/%m/%Y}. '
               f'Trong quá trình coi thi, nếu cần hỗ trợ, Anh/Chị liên hệ Ban Khảo thí qua số {CONTACT_PHONE} hoặc email {CONTACT_EMAIL}.')

    text = '\n'.join([
        f'Kính gửi {person["name"]},', '', intro, '',
        *[f'• {label}: {value}' for label, value in rows], '',
        f'Trang điểm danh: {person["url"]}', *([f'Phòng thi trực tuyến: {shift.room_link}'] if online else []), '',
        'NHIỆM VỤ CỦA GIÁM THỊ', *[f'{index}. {item}' for index, item in enumerate(duties, 1)], '',
        'LƯU Ý', *[f'- {item}' for item in notes], '', confirm, '',
        'Trân trọng,', 'Ban Khảo thí FermatTech', ADDRESS,
    ])

    button = ('display:inline-block;padding:12px 22px;margin:4px 8px 4px 0;border-radius:10px;font-weight:700;'
              'text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;')
    buttons = f'<a href="{escape(person["url"])}" style="{button}background:#001e40;color:#ffffff;border:2px solid #001e40">Mở trang điểm danh</a>'
    if online:
        label = 'Vào phòng thi (Google Meet)' if 'meet.google' in shift.room_link.lower() else 'Vào phòng thi'
        buttons += f'<a href="{escape(shift.room_link)}" style="{button}background:#ffffff;color:#047857;border:2px solid #047857">{label}</a>'
    table = ''.join(f'<tr><td style="padding:6px 18px 6px 0;color:#64748b;vertical-align:top;white-space:nowrap">{escape(label)}</td>'
                    f'<td style="padding:6px 0"><b>{escape(value)}</b></td></tr>' for label, value in rows)
    html = f"""<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:600px;line-height:1.6;font-size:15px">
<p>Kính gửi <b>{escape(person['name'])}</b>,</p>
<p>{escape(intro)}</p>
<table style="border-collapse:collapse;margin:8px 0 18px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0">{table}</table>
<p style="margin:18px 0">{buttons}</p>
<p style="margin:22px 0 6px"><b>Nhiệm vụ của giám thị</b></p>
<ol style="padding-left:22px;margin:0">{''.join(f'<li style="margin:4px 0">{escape(item)}</li>' for item in duties)}</ol>
<p style="margin:18px 0 6px"><b>Lưu ý</b></p>
<ul style="padding-left:22px;margin:0">{''.join(f'<li style="margin:4px 0">{escape(item)}</li>' for item in notes)}</ul>
<p style="margin-top:18px">{escape(confirm)}</p>
<p style="margin-top:22px">Trân trọng,<br><b>Ban Khảo thí FermatTech</b><br><span style="color:#64748b;font-size:13px">{escape(ADDRESS)}</span></p>
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
