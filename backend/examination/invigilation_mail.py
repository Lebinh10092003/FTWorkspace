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
from urllib.parse import quote, urlencode, urlparse

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

    # E-mail-safe markup: tables, inline styles, buttons drawn as table cells so
    # they keep their colour in Outlook and when pasted into a Gmail draft.
    parsed = urlparse(person['url'])
    logo = f'{parsed.scheme}://{parsed.netloc}/logo.png' if parsed.netloc else ''
    navy, green, muted, line = '#001e40', '#047857', '#64748b', '#e2e8f0'
    font = "font-family:'Segoe UI',Arial,Helvetica,sans-serif"

    def cta(href, label, background, color, border):
        return (f'<td style="padding:6px 10px 6px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
                f'<td bgcolor="{background}" style="background:{background};border:2px solid {border};border-radius:10px">'
                f'<a href="{escape(href)}" target="_blank" style="display:inline-block;padding:13px 24px;{font};font-size:15px;'
                f'font-weight:700;color:{color};text-decoration:none;border-radius:10px">{escape(label)}</a></td></tr></table></td>')

    buttons = cta(person['url'], 'Mở trang điểm danh', navy, '#ffffff', navy)
    if online:
        label = 'Vào phòng thi (Google Meet)' if 'meet.google' in shift.room_link.lower() else 'Vào phòng thi'
        buttons += cta(shift.room_link, label, '#ffffff', green, green)
    info = ''.join(
        f'<tr><td style="padding:9px 16px;border-top:1px solid {line};{font};font-size:14px;color:{muted};white-space:nowrap;width:120px">{escape(label)}</td>'
        f'<td style="padding:9px 16px;border-top:1px solid {line};{font};font-size:15px;color:#0f172a;font-weight:700">{escape(value)}</td></tr>'
        for label, value in rows)
    steps = ''.join(
        f'<tr><td valign="top" style="padding:6px 12px 6px 0"><div style="width:26px;height:26px;line-height:26px;border-radius:13px;'
        f'background:#e0ecff;color:{navy};{font};font-size:13px;font-weight:700;text-align:center">{index}</div></td>'
        f'<td style="padding:7px 0;{font};font-size:14px;line-height:1.6;color:#1e293b">{escape(item)}</td></tr>'
        for index, item in enumerate(duties, 1))
    cautions = ''.join(f'<li style="margin:4px 0">{escape(item)}</li>' for item in notes)
    brand = (f'<img src="{escape(logo)}" alt="FermatTech" height="34" style="display:block;height:34px;border:0;background:#ffffff;border-radius:6px;padding:4px">'
             if logo else f'<span style="{font};font-size:20px;font-weight:800;color:#ffffff">FermatTech</span>')
    html = f"""<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef2f7">
<div style="display:none;max-height:0;overflow:hidden">{escape(f'{code} · {start:%H:%M} {day} · {room}')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef2f7" style="background:#eef2f7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid {line}">
<tr><td bgcolor="{navy}" style="background:{navy};background-image:linear-gradient(120deg,#001e40,#0055da);padding:22px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td>{brand}</td>
<td align="right" style="{font};font-size:12px;font-weight:700;letter-spacing:1.5px;color:#bcd3ff;text-transform:uppercase">Thư mời coi thi</td></tr></table>
<p style="margin:18px 0 0;{font};font-size:24px;line-height:1.3;font-weight:800;color:#ffffff">{escape(code)} {escape(year)}</p>
<p style="margin:4px 0 0;{font};font-size:15px;color:#d6e4ff">{escape(stage)}</p></td></tr>
<tr><td style="padding:26px 28px 6px;{font};font-size:15px;line-height:1.65;color:#0f172a">
<p style="margin:0 0 12px">Kính gửi <b>{escape(person['name'])}</b>,</p><p style="margin:0">{escape(intro)}</p></td></tr>
<tr><td style="padding:14px 28px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid {line};border-radius:12px;border-collapse:separate;background:#f8fafc">{info}</table></td></tr>
<tr><td style="padding:16px 28px 8px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>{buttons}</tr></table>
<p style="margin:6px 0 0;{font};font-size:12px;color:{muted}">Nếu nút không bấm được, mở link: <a href="{escape(person['url'])}" style="color:#0055da">{escape(person['url'])}</a></p></td></tr>
<tr><td style="padding:18px 28px 0"><p style="margin:0 0 6px;{font};font-size:16px;font-weight:800;color:{navy}">Nhiệm vụ của giám thị</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0">{steps}</table></td></tr>
<tr><td style="padding:14px 28px 0"><div style="background:#fff8e6;border-left:4px solid #f59e0b;border-radius:8px;padding:12px 16px">
<p style="margin:0 0 4px;{font};font-size:14px;font-weight:800;color:#92400e">Lưu ý</p>
<ul style="margin:0;padding-left:18px;{font};font-size:14px;line-height:1.6;color:#78350f">{cautions}</ul></div></td></tr>
<tr><td style="padding:18px 28px 6px;{font};font-size:14px;line-height:1.65;color:#1e293b">{escape(confirm)}</td></tr>
<tr><td style="padding:16px 28px 26px;{font};font-size:14px;line-height:1.6;color:#0f172a">Trân trọng,<br><b>Ban Khảo thí FermatTech</b></td></tr>
<tr><td bgcolor="#f1f5f9" style="background:#f1f5f9;padding:16px 28px;border-top:1px solid {line};{font};font-size:12px;line-height:1.6;color:{muted}">
{escape(ADDRESS)}<br>Hotline {escape(CONTACT_PHONE)} · <a href="mailto:{CONTACT_EMAIL}" style="color:#0055da">{CONTACT_EMAIL}</a><br>
Thư này gửi riêng cho giám thị được phân công. Vui lòng không chuyển tiếp.</td></tr>
</table></td></tr></table></body></html>"""
    # The Gmail draft gets recipient and subject; the designed body is pasted from the clipboard.
    gmail = 'https://mail.google.com/mail/?' + urlencode({'view': 'cm', 'fs': '1', 'to': person['email'], 'su': subject}, quote_via=quote)
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
            people = []
            for person in recipients(shift, origin):
                message = compose(shift, person, counts.get(shift.exam_room_id, 0))
                people.append({**{k: v for k, v in person.items() if k != 'url'}, 'gmailUrl': message['gmailUrl'],
                               'subject': message['subject'], 'html': message['html'], 'text': message['text']})
            preview = compose(shift, recipients(shift, origin)[0], counts.get(shift.exam_room_id, 0)) if people else None
            items.append({'shiftId': str(shift.pk), 'room': _room(shift), 'startsAt': shift.starts_at.isoformat(),
                          'enabled': shift.enabled, 'recipients': people, 'notifiedAt': shift.notified_at.isoformat() if shift.notified_at else '',
                          'hasGuest': bool(shift.guest_email and shift.guest_token),
                          'guestOpenedAt': shift.guest_opened_at.isoformat() if shift.guest_opened_at else '',
                          'previewHtml': preview['html'] if preview else '', 'previewSubject': preview['subject'] if preview else ''})
        return Response({'mailConfigured': mail_configured(), 'items': items})
    wanted = {str(value) for value in (request.data.get('shiftIds') or [])}
    if request.data.get('markSent') in (True, False):
        # Sent by hand from a Gmail draft: Khảo thí records (or clears) it here.
        stamp = timezone.now() if request.data['markSent'] else None
        ExamInvigilationShift.objects.filter(pk__in=[s.pk for s in shifts if str(s.pk) in wanted]).update(notified_at=stamp)
        return Response({'notifiedAt': stamp.isoformat() if stamp else ''})
    if not mail_configured():
        return Response({'error': 'Hệ thống chưa được cài tài khoản gửi email. Hãy dùng nút "Soạn trong Gmail".'}, status=400)
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
