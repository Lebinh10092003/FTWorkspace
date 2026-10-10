import uuid
import math
from datetime import timedelta
from urllib.parse import urlparse

from django.db import transaction
from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.models import SystemConfig, UserProfile
from authentication.notifications import notify_workspace
from authentication.permissions import IsWorkspaceAuthenticated, has_module_access, request_role
from integrations.google_sheets import build_sheets_service, extract_spreadsheet_id
from .candidate_sheet_queue import launch_candidate_sheet_worker
from .models import ExamInvigilationAudit, ExamInvigilationShift, ExamRoom, ExamSession, LogNote, RoundResult
from .partner_contact_sync import _single_worker

ATTENDANCE = ('Chưa điểm danh', 'Có mặt', 'Vắng', 'Đến muộn')


def _plain(text):
    import unicodedata
    text = unicodedata.normalize('NFD', str(text or '').casefold().replace('đ', 'd'))
    return ''.join(c for c in text if not unicodedata.combining(c)).strip()


def is_exam_staff(request):
    """Khảo thí staff and the leadership see every room; any other employee,
    even an administrator, only sees the rooms they invigilate."""
    profile = UserProfile.objects.filter(email=getattr(request.user, 'email', ''), employment_status='ACTIVE').first()
    if not profile:
        return False
    if profile.role == 'MANAGER':
        return True
    # Anyone with Khảo thí among their departments (as shown on the account page).
    names = {_plain(d.name) for d in profile.departments.all()} | ({_plain(profile.department.name)} if profile.department_id else set())
    return 'khao thi' in names


def can_manage(request):
    return request_role(request) in ('ADMIN', 'MANAGER') and has_module_access(request) and is_exam_staff(request)


def visible_shifts(request):
    qs = ExamInvigilationShift.objects.select_related('session').prefetch_related('invigilators')
    if not is_exam_staff(request):
        qs = qs.filter(invigilators__email=request.user.email, invigilators__employment_status='ACTIVE', enabled=True)
    return qs.distinct()


def live_entry(result, audit=None):
    """A room candidate read straight from Khảo thí; the result row is the truth."""
    candidate = result.participation.candidate
    entry = {
        'code': candidate.code, 'sbd': result.sbd, 'name': candidate.name, 'school': candidate.school,
        'grade': candidate.grade, 'className': candidate.class_name, 'birthDate': candidate.birth_date,
        'email': candidate.email, 'phone': candidate.phone, 'parent': candidate.parent, 'attendance': result.attendance or ATTENDANCE[0], 'score': result.score,
        'note': result.note, 'revision': result.updated_at.isoformat(), 'resultId': str(result.pk),
    }
    if audit:
        entry.update(updatedBy=audit.actor.email if audit.actor else '', updatedAt=audit.created_at.isoformat())
    return entry


def room_results(shift):
    return RoundResult.objects.filter(exam_room_id=shift.exam_room_id).select_related(
        'participation__candidate').order_by('sbd', 'participation__candidate__name')


def shift_roster(shift):
    if not shift.exam_room_id:
        return shift.roster
    audits = {audit.candidate_code: audit for audit in shift.audit.select_related('actor').order_by('created_at')}
    return [live_entry(result, audits.get(result.participation.candidate.code)) for result in room_results(shift)]


def serialize_shift(shift, include_roster=False):
    roster = shift_roster(shift) if include_roster or shift.exam_room_id else shift.roster
    value = {
        'id': str(shift.pk), 'sessionId': shift.session_id, 'sessionName': shift.session.name,
        'competitionCode': shift.session.code, 'roundName': shift.round_name,
        'occurrenceId': shift.occurrence_id, 'label': shift.label, 'roomNumber': shift.room_number,
        'roomLink': shift.room_link, 'startsAt': shift.starts_at.isoformat(), 'endsAt': shift.ends_at.isoformat(),
        'remindAt': (shift.starts_at - timedelta(minutes=15)).isoformat(),
        'invigilators': [{'email': u.email, 'name': u.name or u.email} for u in shift.invigilators.all()],
        'invigilatorLabel': shift.invigilator_label, 'sheetUrl': shift.sheet_url,
        'demo': shift.demo, 'enabled': shift.enabled, 'candidateCount': len(roster),
        'examRoomId': str(shift.exam_room_id or ''),
        'pendingSheetCount': len(shift.pending_sheet_rows), 'sheetError': bool(shift.sheet_error),
        'actionUrl': f'/examination/invigilation/{shift.session_id}?shift={shift.pk}',
        'revision': str(shift.revision),
    }
    if include_roster:
        value['roster'] = roster
    return value


def notify_duty(shift):
    """Tell the assigned staff when a duty is created or its time/room changes.

    Reminders are timed in the browser from the loaded schedule, so a change
    is pushed as a Workspace notification instead of being polled for.
    """
    if not shift.enabled:
        return
    local = timezone.localtime(shift.starts_at)
    for user in shift.invigilators.all():
        notify_workspace(
            event_key=f'examination:duty:{shift.pk}:{user.email}:{int(shift.starts_at.timestamp())}:{shift.room_number}',
            title='Lịch coi thi của bạn',
            message=f'{shift.session.code} · {shift.label} · Phòng {shift.room_number} · {local:%H:%M %d/%m/%Y}',
            category='examination', action_url=f'/examination/invigilation/{shift.session_id}?shift={shift.pk}',
            target_emails=[user.email],
        )


@api_view(['GET'])
@permission_classes([IsWorkspaceAuthenticated])
def my_shifts(request):
    # Administrators receive popups only for their own duties too.
    now = timezone.now()
    shifts = ExamInvigilationShift.objects.filter(
        invigilators__email=request.user.email, invigilators__employment_status='ACTIVE',
        enabled=True, ends_at__gt=now, starts_at__lte=now + timedelta(days=7),
    ).select_related('session').prefetch_related('invigilators').distinct()
    response = Response({'serverNow': now.isoformat(), 'shifts': [serialize_shift(s) for s in shifts]})
    response['Cache-Control'] = 'no-store'
    return response


def valid_link(value):
    return not value or (urlparse(value).scheme in ('http', 'https') and bool(urlparse(value).netloc))


def configure(shift, payload):
    for key, field in [('label', 'label'), ('roomNumber', 'room_number'), ('roundName', 'round_name'),
                       ('occurrenceId', 'occurrence_id'), ('roomLink', 'room_link'), ('sheetUrl', 'sheet_url'),
                       ('sheetTab', 'sheet_tab')]:
        if key in payload:
            value = str(payload[key] or '').strip()
            if len(value) > (2000 if key in ('roomLink', 'sheetUrl') else 100 if key == 'roomNumber' else 255):
                raise ValueError('Thông tin ca thi quá dài.')
            if key in ('roomLink', 'sheetUrl') and not valid_link(value):
                raise ValueError('Link phải bắt đầu bằng https:// hoặc http://.')
            if key == 'sheetUrl' and value and not extract_spreadsheet_id(value):
                raise ValueError('Link Google Sheet không hợp lệ.')
            setattr(shift, field, value)
    for key, field in [('startsAt', 'starts_at'), ('endsAt', 'ends_at')]:
        if key in payload:
            try:
                parsed = parse_datetime(str(payload[key]))
            except ValueError:
                parsed = None
            if parsed is None or timezone.is_naive(parsed):
                raise ValueError('Ngày giờ ca thi phải kèm múi giờ.')
            setattr(shift, field, parsed)
    if 'examRoomId' in payload:
        room_id = str(payload['examRoomId'] or '')
        room = ExamRoom.objects.filter(pk=room_id, session=shift.session).first() if room_id else None
        if room_id and not room:
            raise ValueError('Phòng thi không thuộc kỳ tổ chức này.')
        shift.exam_room = room
        if room:
            # The duty follows the room configured in Khảo thí.
            shift.room_number = room.room_number
            shift.round_name = room.round_name
            shift.occurrence_id = room.occurrence_id or room.round_id
            if not str(payload.get('roomLink') or '').strip():
                shift.room_link = room.exam_link or room.link
    if not shift.starts_at or not shift.ends_at or shift.ends_at <= shift.starts_at:
        raise ValueError('Giờ kết thúc phải sau giờ bắt đầu.')
    if not all((shift.label, shift.room_number, shift.round_name, shift.occurrence_id)):
        raise ValueError('Cần tên vòng, mã ca, tên ca và phòng thi.')
    if 'enabled' in payload:
        if not isinstance(payload['enabled'], bool):
            raise ValueError('Trạng thái ca thi không hợp lệ.')
        shift.enabled = payload['enabled']
    employees = None
    if 'invigilatorEmails' in payload:
        emails = payload['invigilatorEmails']
        if not isinstance(emails, list) or not all(isinstance(e, str) for e in emails):
            raise ValueError('Danh sách giám thị không hợp lệ.')
        employees = list(UserProfile.objects.filter(email__in=set(emails), employment_status='ACTIVE'))
        if len(employees) != len(set(emails)):
            raise ValueError('Giám thị phải là nhân viên đang hoạt động trong Workspace.')
    return employees


@api_view(['GET', 'POST'])
@permission_classes([IsWorkspaceAuthenticated])
def shifts(request):
    if request.method == 'POST':
        if not can_manage(request):
            return Response({'error': 'Chỉ quản lý khảo thí được phân công ca thi.'}, status=403)
        session = get_object_or_404(ExamSession, pk=str(request.data.get('sessionId', '')))
        shift = ExamInvigilationShift(session=session)
        try:
            employees = configure(shift, request.data)
            if ExamInvigilationShift.objects.filter(session=session, occurrence_id=shift.occurrence_id,
                                                    room_number=shift.room_number).exists():
                return Response({'error': 'Phòng này đã có trong ca thi.'}, status=409)
            with transaction.atomic():
                shift.save()
                if employees is not None:
                    shift.invigilators.set(employees)
                notify_duty(shift)
                from .room_sheet import refresh_room_sheet_safely
                transaction.on_commit(lambda session_id=shift.session_id: refresh_room_sheet_safely(session_id))
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        return Response(serialize_shift(shift, True), status=201)
    qs = visible_shifts(request)
    session_id = request.query_params.get('sessionId')
    if session_id:
        qs = qs.filter(session_id=session_id)
    else:
        qs = qs.filter(ends_at__gt=timezone.now() - timedelta(days=1))
    staff, rooms = [], []
    if can_manage(request):
        staff = [{'email': u.email, 'name': u.name or u.email, 'employeeCode': u.employee_code or ''}
                 for u in UserProfile.objects.filter(employment_status='ACTIVE').order_by('name', 'email')]
        if session_id:
            rooms = [{'id': str(room.pk), 'label': room.label, 'roomNumber': room.room_number, 'roundName': room.round_name,
                      'occurrenceId': room.occurrence_id or room.round_id, 'link': room.exam_link or room.link,
                      'candidateCount': room.candidate_count}
                     for room in ExamRoom.objects.filter(session_id=session_id).annotate(candidate_count=Count('assignments'))]
    return Response({'serverNow': timezone.now().isoformat(), 'canManage': can_manage(request),
                     'staff': staff, 'rooms': rooms, 'shifts': [serialize_shift(s, True) for s in qs]})


@api_view(['GET', 'PATCH'])
@permission_classes([IsWorkspaceAuthenticated])
def shift_detail(request, pk):
    shift = get_object_or_404(visible_shifts(request), pk=pk)
    if request.method == 'GET':
        return Response(serialize_shift(shift, True))
    if not can_manage(request):
        return Response({'error': 'Chỉ quản lý khảo thí được sửa lịch và phân công.'}, status=403)
    before_revision = shift.revision
    if request.data.get('revision') and request.data['revision'] != str(before_revision):
        return Response({'error': 'Lịch vừa thay đổi. Hãy tải lại trước khi lưu.'}, status=409)
    try:
        employees = configure(shift, request.data)
        if ExamInvigilationShift.objects.filter(session=shift.session, occurrence_id=shift.occurrence_id,
                                                room_number=shift.room_number).exclude(pk=pk).exists():
            return Response({'error': 'Phòng này đã có trong ca thi.'}, status=409)
        with transaction.atomic():
            shift.revision = uuid.uuid4()
            changed = ExamInvigilationShift.objects.filter(pk=pk, revision=before_revision).update(
                **{field: getattr(shift, field) for field in (
                    'label', 'room_number', 'round_name', 'occurrence_id', 'room_link',
                    'sheet_url', 'sheet_tab', 'starts_at', 'ends_at', 'enabled', 'revision', 'exam_room')},
                updated_at=timezone.now())
            if not changed:
                return Response({'error': 'Phòng thi vừa thay đổi. Hãy tải lại trước khi lưu.'}, status=409)
            if employees is not None:
                shift.invigilators.set(employees)
            notify_duty(shift)
            from .room_sheet import refresh_room_sheet_safely
            transaction.on_commit(lambda session_id=shift.session_id: refresh_room_sheet_safely(session_id))
    except ValueError as exc:
        return Response({'error': str(exc)}, status=400)
    return Response(serialize_shift(shift, True))


def sheet_service():
    cfg = SystemConfig.objects.filter(key='main').first()
    return build_sheets_service(cfg.last_google_access_token if cfg else None, cfg.data if cfg else {})


def export_pending(shift):
    """One-way room export: a failed row stays queued while every other row continues."""
    with _single_worker():
        shift.refresh_from_db()
        if not shift.pending_sheet_rows or not shift.sheet_url:
            return True
        pending = dict(shift.pending_sheet_rows)
        errors = []
        service = None
        sid = extract_spreadsheet_id(shift.sheet_url)
        tab = shift.sheet_tab.replace("'", "''")
        rows = {str(entry.get('code', '')): entry for entry in shift.roster}
        for code, expected in list(pending.items()):
            try:
                if service is None:
                    service = sheet_service()
                entry = rows[code]
                row = int(entry['sheetRow'])
                if row < 1:
                    raise ValueError('Số dòng không hợp lệ.')
                # Read just the SBD identity before writing; never import room Sheet values.
                current = service.spreadsheets().values().get(
                    spreadsheetId=sid, range=f"'{tab}'!G{row}").execute().get('values', [])
                if not current or not current[0] or str(current[0][0]).strip() != code:
                    raise ValueError('SBD tại dòng đích không khớp; đã bỏ qua riêng dòng này.')
                score = entry.get('score', '')
                try:
                    numeric_score = float(score)
                    if math.isfinite(numeric_score):
                        score = numeric_score
                except (ValueError, TypeError):
                    pass
                values = [entry.get('attendance', ''), entry.get('note', ''), score]
                service.spreadsheets().values().batchUpdate(spreadsheetId=sid,
                    body={'valueInputOption': 'RAW', 'data': [
                        {'range': f"'{tab}'!L{row}:N{row}", 'values': [values]},
                    ]}).execute()
                if entry.get('revision') == expected:
                    pending.pop(code, None)
            except Exception as exc:
                message = f'{shift.sheet_tab}, dòng {rows.get(code, {}).get("sheetRow", "?")}, SBD {code}: {exc}'
                errors.append(message)
                if message not in shift.sheet_error:
                    LogNote.objects.create(key=f'session-{shift.session_id}:room:{uuid.uuid4().hex}',
                        entity_key=f'session-{shift.session_id}', content=message,
                        updated_by='Hệ thống FT Workspace', system=True)
        # If an edit arrived during the write, retain its durable pending revision.
        changed = ExamInvigilationShift.objects.filter(pk=shift.pk, revision=shift.revision).update(
            pending_sheet_rows=pending, sheet_error='; '.join(errors)[:1000])
        return bool(changed) and not pending


def drain_invigilation_sheet_queue():
    summary = {'synced': 0, 'failed': 0}
    for shift in ExamInvigilationShift.objects.exclude(pending_sheet_rows={}).iterator():
        try:
            ok = export_pending(shift)
        except Exception as exc:
            ExamInvigilationShift.objects.filter(pk=shift.pk).update(sheet_error=str(exc)[:1000])
            ok = False
        summary['synced' if ok else 'failed'] += 1
    return summary


def roster_changes(data):
    allowed = {'attendance', 'score', 'note', 'revision'}
    if set(data) - allowed:
        raise ValueError('Chỉ được sửa điểm danh, điểm và ghi chú.')
    changes = {}
    for key in ('attendance', 'score', 'note'):
        if key in data:
            value = str(data[key] if data[key] is not None else '')
            if len(value) > (2000 if key == 'note' else 255):
                raise ValueError('Nội dung vượt quá độ dài cho phép.')
            if key == 'attendance' and value not in ATTENDANCE:
                raise ValueError('Trạng thái điểm danh không hợp lệ.')
            changes[key] = value
    return changes


@api_view(['PATCH'])
@permission_classes([IsWorkspaceAuthenticated])
def roster_update(request, pk, code):
    """Save one candidate and answer immediately; Sheet writes run in the background.

    Each candidate is versioned on its own, so invigilators of different rooms
    (or two in one room) never wait for or block each other.
    """
    shift = get_object_or_404(visible_shifts(request), pk=pk)
    try:
        changes = roster_changes(request.data)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=400)
    if not request.data.get('revision'):
        return Response({'error': 'Thiếu phiên bản hồ sơ. Hãy tải lại.'}, status=409)
    stale = Response({'error': 'Hồ sơ vừa được người khác cập nhật. Hãy tải lại trước khi lưu.'}, status=409)

    if shift.exam_room_id:
        with transaction.atomic():
            result = room_results(shift).filter(participation__candidate__code=code).first()
            if not result:
                return Response({'error': 'Thí sinh không thuộc phòng thi này.'}, status=404)
            if request.data['revision'] != result.updated_at.isoformat():
                return stale
            before = live_entry(result)
            for key, value in changes.items():
                setattr(result, key, value)
            # save() keeps the existing signal that queues the session Sheet row.
            result.save(update_fields=[*changes, 'updated_at'])
            audit = ExamInvigilationAudit.objects.create(shift=shift, candidate_code=code, actor=request.user,
                                                         before=before, after=live_entry(result))
        return Response({'entry': live_entry(result, audit), 'pendingSheet': False})

    # Demo rooms keep a stored roster. Re-read and merge so edits to other
    # candidates of the same room never turn into a conflict.
    for _ in range(5):
        shift.refresh_from_db()
        entry = next((e for e in shift.roster if e.get('code') == code), None)
        if not entry:
            return Response({'error': 'Thí sinh không thuộc phòng thi này.'}, status=404)
        if request.data['revision'] != entry.get('revision'):
            return stale
        after = {**entry, **changes, 'revision': str(uuid.uuid4()), 'updatedBy': request.user.email,
                 'updatedAt': timezone.now().isoformat()}
        roster = [after if e.get('code') == code else e for e in shift.roster]
        pending = {**shift.pending_sheet_rows, code: after['revision']} if shift.sheet_url else dict(shift.pending_sheet_rows)
        with transaction.atomic():
            changed = ExamInvigilationShift.objects.filter(pk=pk, revision=shift.revision).update(
                roster=roster, pending_sheet_rows=pending, revision=uuid.uuid4(), updated_at=timezone.now())
            if not changed:
                continue
            ExamInvigilationAudit.objects.create(shift=shift, candidate_code=code, actor=request.user,
                                                before=entry, after=after)
            if code in pending:
                transaction.on_commit(launch_candidate_sheet_worker)
        return Response({'entry': after, 'pendingSheet': code in pending})
    return Response({'error': 'Phòng thi đang được cập nhật liên tục. Hãy thử lại.'}, status=409)
