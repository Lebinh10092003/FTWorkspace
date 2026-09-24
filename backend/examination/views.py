from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework import status
import ast
import logging
import uuid
import json
import re
import unicodedata
import urllib.parse
from datetime import datetime, timedelta
from django.db import transaction
from django.db.models import Prefetch, Q
from django.utils import timezone
from .models import Competition, ExamSession, Candidate, CandidateParticipation, RoundResult, ExamRoom, LogNote, ExaminationSheet, ExaminationSheetPublication
from .eligibility import ELIGIBILITY_ELIGIBLE, normalize_eligibility
from authentication.models import SystemConfig, UserProfile
from authentication.notifications import notify_workspace
from authentication.permissions import IsAuthenticated, IsAuthenticatedOrReadOnly, IsManagerOrAdmin, IsAdmin
from .sheet_publication import academic_year_for_date, publication_payload, session_academic_year, session_tab_name, sync_publication
from .sheet_scheduler import output_sheet_has_unreviewed_changes

logger = logging.getLogger(__name__)


def _refresh_examination_work_schedule():
    """Mirror the exam calendar onto the Khảo thí schedule after a change.

    Best effort: a schedule that cannot be written must never stop a kỳ tổ chức
    from being saved, so a failure here is swallowed and the nightly command
    picks the change up instead.
    """
    try:
        from .work_schedule_sync import sync_examination_work_schedule
        sync_examination_work_schedule()
    except Exception:  # noqa: BLE001 - the exam edit itself already succeeded
        logger.exception("Không đồng bộ được lịch thi sang lịch làm việc Khảo thí.")


from .sync import (
    sync_session_candidate_totals,
    sync_examination_from_google_sheet,
    get_contest_codes,
    merge_contest_codes,
    same_candidate,
    candidate_match_assessment,
    should_replace_birth_date,
    next_code,
    parse_dob,
    format_person_name,
    export_session_to_google_sheet,
    remote_sheet_fingerprint,
    output_sheet_export_preview,
    sync_single_sheet,
    format_sheet_percentage,
)


def audit_actor(request):
    """Return the authenticated actor whenever a person initiated the change."""
    return getattr(request.user, 'email', '') or getattr(request, 'user_email', '') or 'Nhân viên FT Workspace'


def normalize_online_room_link(value):
    """Accept familiar Meet/Facebook links pasted without an explicit protocol."""
    link = str(value or '').strip()
    host = link.split('/', 1)[0].casefold()
    is_facebook_host = host == 'facebook.com' or host.endswith('.facebook.com') or host in {'fb.com', 'www.fb.com', 'fb.watch', 'm.me', 'www.m.me'}
    return f'https://{link}' if host == 'meet.google.com' or is_facebook_host else link


def sheet_room_details(location, mode=''):
    """Turn the Sheet's ``Địa điểm/Phòng thi`` cell into one stable room.

    Official source tabs keep the room name and, for online rounds, the meeting
    link in a single cell.  A free-text location is useful in the candidate
    history, but the rooms screen needs an ``ExamRoom`` relation as well.
    """
    raw_location = str(location or '').strip()
    if not raw_location:
        return None
    lines = [line.strip() for line in raw_location.splitlines() if line.strip()]
    label = next((line.rstrip(':').strip() for line in lines if not re.match(r'^https?://', line, re.I)), '')
    if not label:
        return None
    link_match = re.search(r'https?://[^\s<>]+', raw_location, re.I)
    room_link = normalize_online_room_link(link_match.group(0)) if link_match else ''
    normalized_mode = ''.join(
        character for character in unicodedata.normalize('NFD', str(mode or '').casefold())
        if unicodedata.category(character) != 'Mn'
    )
    is_online = bool(room_link) or 'truc tuyen' in normalized_mode or 'online' in normalized_mode
    return {
        'label': label[:500],
        # The label is more legible than a generated ID and remains stable on
        # later imports, so the same Sheet room is reused rather than duplicated.
        'room_number': label[:100],
        'link': room_link,
        'mode': ExamRoom.MODE_ONLINE if is_online else ExamRoom.MODE_IN_PERSON,
        'location': '' if is_online else raw_location[:1000],
    }


def ensure_sheet_room_assignment(result):
    """Create/reuse the room named by the source Sheet and attach this result.

    A manually allocated room always wins.  This makes Sheet imports safe to
    rerun without unexpectedly replacing a coordinator's later room decision.
    """
    if result.exam_room_id or not result.round_id:
        return False
    details = sheet_room_details(result.location, result.mode)
    if not details:
        return False
    session = result.participation.session
    room, created = ExamRoom.objects.get_or_create(
        session=session,
        round_id=result.round_id,
        occurrence_id=result.occurrence_id or '',
        room_number=details['room_number'],
        defaults={
            'round_name': result.round_name,
            'common_name': 'Phòng từ Google Sheet',
            'label': details['label'],
            'mode': details['mode'],
            'location': details['location'],
            'link': details['link'],
            'allocation_strategy': ExamRoom.STRATEGY_BALANCED,
            'position': ExamRoom.objects.filter(
                session=session,
                round_id=result.round_id,
                occurrence_id=result.occurrence_id or '',
            ).count(),
            'created_by': 'Google Sheet import',
        },
    )
    updates = []
    if result.exam_room_id != room.id:
        result.exam_room = room
        updates.append('exam_room')
    if result.room_name != room.label:
        result.room_name = room.label
        updates.append('room_name')
    if updates:
        result.save(update_fields=updates + ['updated_at'])
    return created or bool(updates)


def backfill_sheet_room_assignments(session=None):
    """Repair older imports whose room cell was saved without a room relation."""
    results = RoundResult.objects.filter(exam_room__isnull=True).exclude(location='').select_related('participation__session')
    if session is not None:
        results = results.filter(participation__session=session)
    return sum(1 for result in results.iterator() if ensure_sheet_room_assignment(result))


def describe_rounds(rounds):
    """Describe every configured round and its concrete days/slots for audit logs."""
    if not isinstance(rounds, list):
        return ''
    descriptions = []
    field_labels = {
        'date': 'ngày', 'time': 'giờ/ca', 'mode': 'hình thức',
        'link': 'link', 'location': 'địa điểm', 'note': 'ghi chú',
    }
    for round_config in rounds:
        if not isinstance(round_config, dict):
            continue
        name = str(round_config.get('name') or '').strip()
        if not name:
            continue
        slots = round_config.get('slots') if isinstance(round_config.get('slots'), list) else []
        if not slots:
            slots = [{
                'date': round_config.get('date'), 'time': round_config.get('time'),
                'mode': round_config.get('mode'), 'link': round_config.get('link'),
                'location': round_config.get('location'), 'note': round_config.get('note'),
            }]
        day_details = []
        for position, slot in enumerate(slots, 1):
            if not isinstance(slot, dict):
                continue
            values = [
                f'{field_labels[key]}: {str(slot.get(key) or "").strip()}'
                for key in field_labels if str(slot.get(key) or '').strip()
            ]
            if not values and position == 1 and str(round_config.get('label') or round_config.get('date') or '').strip():
                values = [str(round_config.get('label') or round_config.get('date')).strip()]
            day_details.append(f'Ngày/ca {position} ({"; ".join(values) or "chưa có thông tin"})')
        summary = str(round_config.get('label') or round_config.get('date') or '').strip()
        prefix = f'{name} ({summary}).' if summary else name
        descriptions.append(f'{prefix} Chi tiết: {"; ".join(day_details) or "chưa có thời gian"}')
    return ' | '.join(descriptions)
def describe_registration(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            try:
                value = ast.literal_eval(value)
            except (SyntaxError, ValueError):
                return str(value or '').strip()
    if not isinstance(value, dict):
        return ''
    labels = {
        'subject': 'Môn thi', 'category': 'Bảng thi', 'registrationMethod': 'Hình thức đăng ký',
        'registrationUnit': 'Đơn vị đăng ký', 'teamName': 'Tên đội', 'examLanguage': 'Ngôn ngữ thi',
        'generalNote': 'Ghi chú', 'certificateLink': 'Link chứng nhận',
    }
    details = [f'{labels.get(key, key)}: {str(item).strip()}' for key, item in value.items() if str(item or '').strip()]
    return '; '.join(details)


AUDIT_VALUE_LABELS = {
    'id': 'Mã', 'name': 'Tên', 'title': 'Tiêu đề', 'code': 'Mã',
    'date': 'Ngày', 'start': 'Ngày bắt đầu', 'end': 'Ngày kết thúc',
    'start_time': 'Giờ bắt đầu', 'end_time': 'Giờ kết thúc',
    'startTime': 'Giờ bắt đầu', 'endTime': 'Giờ kết thúc',
    'time': 'Thời gian', 'day': 'Ngày trong tuần', 'month': 'Tháng', 'year': 'Năm',
    'status': 'Trạng thái', 'phase': 'Giai đoạn', 'mode': 'Hình thức',
    'note': 'Ghi chú', 'description': 'Mô tả', 'content': 'Nội dung',
    'session': 'Kỳ tổ chức', 'sessionId': 'Kỳ tổ chức', 'sessionIds': 'Các kỳ tổ chức',
    'count': 'Số lượng', 'studentCounts': 'Số học sinh cộng tác theo kỳ',
    'candidateCodes': 'Danh sách học viên', 'attendance': 'Điểm danh',
    'teacher': 'Giáo viên', 'teacherEmail': 'Email giáo viên',
    'school': 'Trường', 'province': 'Tỉnh/Thành phố', 'ward': 'Phường/Xã',
    'representative': 'Đầu mối liên hệ', 'phone': 'Số điện thoại', 'email': 'Email',
    'subject': 'Môn/Nội dung', 'category': 'Bảng thi', 'level': 'Cấp học',
    'contests': 'Các cuộc thi', 'location': 'Địa điểm', 'link': 'Đường dẫn',
    'planned': 'Dự kiến', 'unknown': 'Chưa xác định',
}


def parse_structured_audit_value(value):
    if not isinstance(value, str):
        return value
    text = value.strip()
    if len(text) < 2 or (text[0], text[-1]) not in {('{', '}'), ('[', ']'), ('(', ')')}:
        return value
    try:
        parsed = json.loads(text)
    except (TypeError, ValueError, json.JSONDecodeError):
        try:
            parsed = ast.literal_eval(text)
        except (SyntaxError, ValueError):
            return value
    return parsed if isinstance(parsed, (dict, list, tuple)) else value


def audit_display_value(field, value):
    if field == 'rounds':
        return describe_rounds(value) or 'chưa có vòng thi'
    if field == 'registration':
        return describe_registration(value) or 'chưa có thông tin'
    value = parse_structured_audit_value(value)
    if value is None or value == '':
        return 'chưa có thông tin'
    if isinstance(value, bool):
        return 'Có' if value else 'Không'
    if isinstance(value, dict):
        details = []
        for key, item in value.items():
            rendered = audit_display_value(str(key), item)
            if rendered == 'chưa có thông tin':
                continue
            details.append(f'{AUDIT_VALUE_LABELS.get(str(key), str(key))}: {rendered}')
        return '; '.join(details) or 'chưa có thông tin'
    if isinstance(value, (list, tuple, set)):
        items = [audit_display_value(field, item) for item in value]
        items = [item for item in items if item != 'chưa có thông tin']
        return '; '.join(items) or 'chưa có thông tin'
    text = str(value).strip()
    if field == 'scoreRate':
        # Decimal separators differ between Sheet locales. This only replaces
        # the separator; all decimal digits remain untouched.
        return format_sheet_percentage(text) or 'chưa có thông tin'
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', text):
        return datetime.strptime(text, '%Y-%m-%d').strftime('%d/%m/%Y')
    return text or 'chưa có thông tin'


def audit_values(before, after, labels):
    """Build concise, natural-language audit sentences for changed fields."""
    changes = []
    for field, label in labels.items():
        old_value = audit_display_value(field, before.get(field))
        new_value = audit_display_value(field, after.get(field))
        if old_value == new_value:
            continue
        if old_value == 'chưa có thông tin' or old_value == 'chưa có vòng thi':
            changes.append(f'Đã bổ sung {label}: {new_value}.')
        elif new_value == 'chưa có thông tin' or new_value == 'chưa có vòng thi':
            changes.append(f'Đã xóa {label} (trước đó: {old_value}).')
        else:
            changes.append(f'Đã đổi {label} từ "{old_value}" thành "{new_value}".')
    return '\n'.join(changes)


def _humanize_legacy_before_after(content):
    before_markers = ('. Thông tin trước: ', '. Dữ liệu trước: ')
    after_markers = ('. Thông tin sau: ', '. Dữ liệu sau: ')
    for before_marker in before_markers:
        if before_marker not in content:
            continue
        title, remainder = content.split(before_marker, 1)
        for after_marker in after_markers:
            if after_marker not in remainder:
                continue
            before_text, after_text = remainder.split(after_marker, 1)
            before_value = parse_structured_audit_value(before_text.strip().rstrip('.'))
            after_value = parse_structured_audit_value(after_text.strip().rstrip('.'))
            if not isinstance(before_value, dict) or not isinstance(after_value, dict):
                continue
            keys = list(dict.fromkeys([*before_value.keys(), *after_value.keys()]))
            labels = {str(key): AUDIT_VALUE_LABELS.get(str(key), str(key)) for key in keys}
            changes = audit_values(before_value, after_value, labels)
            heading = title.rstrip(' .:')
            return f'{heading}.\n{changes}' if changes else f'{heading}. Không có thay đổi dữ liệu.'
    return ''


def _replace_structured_literals(content):
    result, index = [], 0
    pairs = {'{': '}', '[': ']'}
    while index < len(content):
        opener = content[index]
        if opener not in pairs:
            result.append(opener)
            index += 1
            continue
        stack, quote, escaped, cursor = [pairs[opener]], '', False, index + 1
        while cursor < len(content) and stack:
            char = content[cursor]
            if quote:
                if escaped:
                    escaped = False
                elif char == '\\':
                    escaped = True
                elif char == quote:
                    quote = ''
            elif char in {'\'', chr(34)}:
                quote = char
            elif char in pairs:
                stack.append(pairs[char])
            elif char == stack[-1]:
                stack.pop()
            cursor += 1
        if stack:
            result.append(opener)
            index += 1
            continue
        candidate = content[index:cursor]
        parsed = parse_structured_audit_value(candidate)
        if isinstance(parsed, (dict, list, tuple)):
            result.append(audit_display_value('', parsed))
            index = cursor
        else:
            result.append(opener)
            index += 1
    return ''.join(result)


def humanize_lognote_content(content):
    text = str(content or '').strip()
    if not text:
        return ''
    legacy_change = _humanize_legacy_before_after(text)
    if legacy_change:
        return legacy_change
    parsed = parse_structured_audit_value(text)
    if isinstance(parsed, (dict, list, tuple)):
        return audit_display_value('', parsed)
    return _replace_structured_literals(text)


def append_audit(entity_key, content, request=None, system=False, actor=''):
    """Persist an immutable audit note under the detail page which owns the data."""
    if not content:
        return
    actor_email = '' if system or not request else (getattr(request.user, 'email', '') or getattr(request, 'user_email', ''))
    profile = UserProfile.objects.filter(email=actor_email).first() if actor_email else None
    LogNote.objects.create(
        key=f'{entity_key}:{uuid.uuid4().hex}',
        entity_key=entity_key,
        content=content,
        updated_by=actor or (audit_actor(request) if request and not system else 'Hệ thống FT Workspace'),
        actor_email=actor_email or None,
        actor_photo_url=(profile.photo_url or '') if profile else '',
        system=system,
    )



def append_competition_scope_audit(session_or_id, content, request=None, system=False, actor=''):
    """Mirror a session-affecting event into its parent competition timeline."""
    if not content:
        return
    session = session_or_id if isinstance(session_or_id, ExamSession) else ExamSession.objects.filter(id=str(session_or_id)).first()
    if not session or not session.competition_id:
        return
    competition = Competition.objects.filter(id=session.competition_id).first()
    if not competition:
        return
    append_audit(
        f'competition-{competition.id}',
        f'Kỳ tổ chức {session.code or session.id} · {session.name}: {content}',
        request,
        system=system,
        actor=actor,
    )
EXAMINATION_SEED = {
    'competitions': [
        { 'id': 'aysbc', 'code': 'AYSBC', 'name': 'Huy hiệu các Nhà khoa học trẻ Châu Á', 'parent': 'AYSBC', 'organizer': 'SCS và META Knowledge' },
        { 'id': 'imo', 'code': 'IMO', 'name': 'International Maths Olympiad', 'parent': 'SCO - IMO', 'organizer': 'SCO' },
        { 'id': 'ieo', 'code': 'IEO', 'name': 'International English Olympiad', 'parent': 'SCO - IEO', 'organizer': 'SCO' },
        { 'id': 'iso', 'code': 'ISO', 'name': 'International Science Olympiad', 'parent': 'SCO - ISO', 'organizer': 'SCO' },
        { 'id': 'fimo', 'code': 'FIMO', 'name': 'FermatTech International Mathematics Olympiad', 'parent': 'FIMO', 'organizer': 'FermatTech' },
        { 'id': 'fieo', 'code': 'FIEO', 'name': 'FermatTech International English Olympiad', 'parent': 'FIEO - Tiếng Anh', 'organizer': 'FermatTech' },
    ],
    'sessions': [
        { 'id': 'aysbc', 'code': 'AYSBC', 'name': 'Huy hiệu các Nhà khoa học trẻ Châu Á', 'parent': 'AYSBC', 'organizer': 'SCS và META Knowledge', 'time': '', 'candidates_count': 0, 'national': '', 'international': '', 'phase': 'Chưa cập nhật', 'note': '' },
        { 'id': 'imo', 'code': 'IMO', 'name': 'International Maths Olympiad', 'parent': 'SCO - IMO', 'organizer': 'SCO', 'time': '', 'candidates_count': 0, 'national': '', 'international': '', 'phase': 'Chưa cập nhật', 'note': '' },
        { 'id': 'ieo', 'code': 'IEO', 'name': 'International English Olympiad', 'parent': 'SCO - IEO', 'organizer': 'SCO', 'time': '', 'candidates_count': 0, 'national': '', 'international': '', 'phase': 'Chưa cập nhật', 'note': '' },
        { 'id': 'iso', 'code': 'ISO', 'name': 'International Science Olympiad', 'parent': 'SCO - ISO', 'organizer': 'SCO', 'time': '', 'candidates_count': 0, 'national': '', 'international': '', 'phase': 'Chưa cập nhật', 'note': '' },
        { 'id': 'fimo', 'code': 'FIMO', 'name': 'FermatTech International Mathematics Olympiad', 'parent': 'FIMO', 'organizer': 'FermatTech', 'time': '', 'candidates_count': 0, 'national': '', 'international': '', 'phase': 'Chưa cập nhật', 'note': '' },
        { 'id': 'fieo', 'code': 'FIEO', 'name': 'FermatTech International English Olympiad', 'parent': 'FIEO - Tiếng Anh', 'organizer': 'FermatTech', 'time': '', 'candidates_count': 0, 'national': '', 'international': '', 'phase': 'Chưa cập nhật', 'note': '' },
    ],
    'candidates': [],
}

LEGACY_SEED_TEXT_CORRECTIONS = {
    'Huy hi\u003fu c\u003fc Nh\u003f khoa h\u003fc tr\u003f Ch\u003fu \u003f': 'Huy hiệu các Nhà khoa học trẻ Châu Á',
    'SCS v\u003f META Knowledge': 'SCS và META Knowledge',
    'FIEO - Ti\u003fng Anh': 'FIEO - Tiếng Anh',
    'Ch\u003fa c\u003fp nh\u003ft': 'Chưa cập nhật',
}

def repair_legacy_seed_text():
    for model, fields in (
        (Competition, ('name', 'parent', 'organizer')),
        (ExamSession, ('name', 'parent', 'organizer', 'phase')),
    ):
        for field in fields:
            for old, new in LEGACY_SEED_TEXT_CORRECTIONS.items():
                model.objects.filter(**{field: old}).update(**{field: new})

def default_session_rounds(session):
    """Provide the common editable round structure for legacy blank sessions."""
    return [
        {'id': 'round-national', 'name': 'Vòng loại Quốc gia', 'label': '', 'date': '', 'slots': []},
        {
            'id': 'round-final',
            'name': 'Vòng Chung kết Quốc gia',
            'label': str(session.national or '').strip(),
            'date': str(session.national_date or '').strip(),
            'slots': [],
        },
        {
            'id': 'round-international',
            'name': 'Vòng Quốc tế',
            'label': str(session.international or '').strip(),
            'date': str(session.international_date or '').strip(),
            'slots': [],
        },
    ]


def ensure_existing_session_rounds():
    """Backfill only legacy sessions that have no usable round configuration."""
    for session in ExamSession.objects.all().only('id', 'rounds', 'national', 'national_date', 'international', 'international_date'):
        configured = [
            round_config for round_config in (session.rounds or [])
            if isinstance(round_config, dict) and str(round_config.get('name') or '').strip()
        ]
        if configured:
            continue
        session.rounds = default_session_rounds(session)
        session.save(update_fields=['rounds', 'updated_at'])


def session_competition(session):
    """Resolve a session to its canonical competition and repair legacy links."""
    competition = Competition.objects.filter(id=session.competition_id).first()
    if not competition:
        candidates = list(Competition.objects.filter(code__iexact=str(session.code or '').strip()))
        if len(candidates) == 1:
            competition = candidates[0]
        elif len(candidates) > 1:
            # A legacy session may share a short code with a newer plan. Prefer
            # the uniquely matching human-readable parent/name before giving up.
            context = str(session.parent or '').strip().casefold()
            matches = [item for item in candidates if context and context in {
                str(item.name or '').strip().casefold(),
                str(item.parent or '').strip().casefold(),
            }]
            if len(matches) == 1:
                competition = matches[0]
    if not competition:
        return None

    updates = []
    if session.competition_id != competition.id:
        session.competition_id = competition.id
        updates.append('competition_id')
    if session.code != competition.code:
        session.code = competition.code
        updates.append('code')
    # `parent` was used inconsistently by legacy session records. For a session,
    # it is the human-readable competition name shown across list, edit and import.
    if session.parent != competition.name:
        session.parent = competition.name
        updates.append('parent')
    if session.organizer != competition.organizer:
        session.organizer = competition.organizer
        updates.append('organizer')
    expected_sort_key = f"{competition.code.lower()}_{session.id}"
    if session.sort_key != expected_sort_key:
        session.sort_key = expected_sort_key
        updates.append('sort_key')
    if updates:
        session.save(update_fields=updates + ['updated_at'])
    return competition


def normalize_session_competition_links():
    """Repair historic sessions so every screen reads competition data consistently."""
    for session in ExamSession.objects.all():
        session_competition(session)


def ensure_examination_seed():
    repair_legacy_seed_text()
    # Competitions must exist even when an older database already has sessions.
    for comp_data in EXAMINATION_SEED['competitions']:
        # A user-created competition with the same code is already canonical;
        # do not add a duplicate seed record with a second identity.
        if Competition.objects.filter(code__iexact=comp_data['code']).exists():
            continue
        Competition.objects.get_or_create(
            id=comp_data['id'],
            defaults={
                'code': comp_data['code'],
                'name': comp_data['name'],
                'parent': comp_data['parent'],
                'organizer': comp_data['organizer'],
                'sort_key': f"{comp_data['code'].lower()}_{comp_data['id']}"
            }
        )

    if ExamSession.objects.exists():
        normalize_session_competition_links()
        ensure_existing_session_rounds()
        return

    for sess_data in EXAMINATION_SEED['sessions']:
        comp = Competition.objects.filter(id=sess_data['id']).first() or Competition.objects.get(code__iexact=sess_data['code'])
        ExamSession.objects.get_or_create(
            id=sess_data['id'],
            defaults={
                'competition_id': comp.id,
                'code': comp.code,
                'name': sess_data['name'],
                'parent': comp.name,
                'organizer': comp.organizer,
                'time': sess_data['time'],
                'candidates_count': 0,
                'national': sess_data.get('national'),
                'national_date': sess_data.get('national_date'),
                'international': sess_data.get('international'),
                'international_date': sess_data.get('international_date'),
                'phase': sess_data['phase'],
                'note': sess_data['note'],
                'sort_key': f"{comp.code.lower()}_{sess_data['id']}"
            }
        )

    normalize_session_competition_links()
    ensure_existing_session_rounds()

    for cand_data in EXAMINATION_SEED['candidates']:
        Candidate.objects.get_or_create(
            id=cand_data['id'],
            defaults={
                'code': cand_data['code'],
                'name': cand_data['name'],
                'school': cand_data['school'],
                'class_name': cand_data['class_name'],
                'city': cand_data['city'],
                'contests': cand_data['contests'],
                'achievement': cand_data['achievement'],
                'updated': cand_data['updated'],
                'email': cand_data['email'],
                'parent': cand_data['parent'],
                'phone': cand_data['phone'],
                'identity': cand_data['identity'],
                'address': cand_data['address'],
                'sort_key': f"{cand_data['name'].lower()}_{cand_data['identity'] or cand_data['id']}"
            }
        )
def merge_exam_history(existing, incoming, session_id='', source='', update_mode='replace-nonempty', import_empty_values=True):
    rows = [item for item in (existing or []) if isinstance(item, dict)]
    index = {}
    for position, item in enumerate(rows):
        key = (str(item.get('sessionId') or ''), str(item.get('round') or ''), str(item.get('sbd') or ''))
        index[key] = position
    for item in incoming or []:
        if not isinstance(item, dict):
            continue
        clean = {str(key): str(value).strip() for key, value in item.items() if value not in (None, '')}
        if not clean:
            continue
        clean['sessionId'] = session_id or clean.get('sessionId', '')
        if source:
            clean['source'] = source
        key = (clean.get('sessionId', ''), clean.get('round', ''), clean.get('sbd', ''))
        if key in index:
            if update_mode == 'fill-empty':
                for field, value in clean.items():
                    if not str(rows[index[key]].get(field) or '').strip():
                        rows[index[key]][field] = value
            elif not import_empty_values:
                for field, value in clean.items():
                    if str(rows[index[key]].get(field) or '').strip():
                        rows[index[key]][field] = value
            else:
                rows[index[key]].update(clean)
        else:
            index[key] = len(rows)
            rows.append(clean)
    return rows

ROUND_FIELD_MAP = {
    'occurrenceId': 'occurrence_id',
    'eligibility': 'eligibility',
    'sbd': 'sbd',
    'date': 'exam_date',
    'time': 'time_slot',
    'mode': 'mode',
    'location': 'location',
    'link': 'link',
    'account': 'account',
    'password': 'password',
    'attendance': 'attendance',
    'score': 'score',
    'scoreRate': 'score_rate',
    'rank': 'rank',
    'result': 'result',
    'note': 'note',
}


def occurrence_id_from_round(round_config, occurrence_id='', exam_date=''):
    """Resolve a candidate to one declared organisation batch of a round.

    The ID is explicit in new payloads.  Imports that only contain ``Ngày thi``
    are mapped to a matching configured batch so the old Sheet template remains
    valid without adding a mandatory column.
    """
    explicit = str(occurrence_id or '').strip()
    if explicit:
        return explicit
    date_value = str(exam_date or '').strip()
    slots = (round_config or {}).get('slots') or []
    for slot in slots:
        if isinstance(slot, dict) and date_value and str(slot.get('date') or '').strip() == date_value:
            return str(slot.get('id') or '').strip()
    if len(slots) == 1 and isinstance(slots[0], dict):
        return str(slots[0].get('id') or '').strip()
    return ''


def upsert_participation_history(candidate, session_id, history, source='', registration=None, update_mode='replace-nonempty', import_empty_values=True):
    """Store a source tab as one session and each populated round independently."""
    if not session_id:
        return None
    session = ExamSession.objects.filter(id=session_id).first()
    if not session:
        return None
    participation, participation_created = CandidateParticipation.objects.get_or_create(
        candidate=candidate,
        session=session,
        defaults={'source': source or ''},
    )
    updates = []
    if source and participation.source != source:
        participation.source = source
        updates.append('source')
    registration = registration or {}
    registration_fields = {
        'subject': 'subject', 'category': 'category', 'registrationMethod': 'registration_method',
        'registrationUnit': 'registration_unit', 'teamName': 'team_name', 'examLanguage': 'exam_language',
        'generalNote': 'general_note', 'certificateLink': 'certificate_link',
    }
    for payload_field, model_field in registration_fields.items():
        value = str(registration.get(payload_field) or '').strip()
        current_value = str(getattr(participation, model_field) or '').strip()
        can_write = value and (
            not current_value if update_mode == 'fill-empty'
            else (import_empty_values or participation_created or bool(current_value))
        )
        if can_write:
            setattr(participation, model_field, value)
            updates.append(model_field)
    if registration:
        incoming_registration = {str(key): value for key, value in registration.items() if value not in (None, '')}
        if update_mode == 'fill-empty':
            merged_registration = dict(participation.registration_data or {})
            for key, value in incoming_registration.items():
                if not str(merged_registration.get(key) or '').strip():
                    merged_registration[key] = value
            participation.registration_data = merged_registration
        elif not import_empty_values and not participation_created:
            merged_registration = dict(participation.registration_data or {})
            for key, value in incoming_registration.items():
                if str(merged_registration.get(key) or '').strip():
                    merged_registration[key] = value
            participation.registration_data = merged_registration
        else:
            participation.registration_data = incoming_registration
        updates.append('registration_data')
    if updates:
        participation.save(update_fields=list(set(updates)) + ['updated_at'])

    configured_rounds = [item for item in (session.rounds or []) if isinstance(item, dict)]
    for history_index, item in enumerate(history or []):
        if not isinstance(item, dict):
            continue
        round_name = str(item.get('round') or '').strip()
        if not round_name:
            continue
        values = {
            model_field: str(item.get(payload_field) or '').strip()
            for payload_field, model_field in ROUND_FIELD_MAP.items()
        }
        template_slot = int(item.get('templateSlot') or 0) if str(item.get('templateSlot') or '').isdigit() else 0
        matching_round = (
            configured_rounds[template_slot - 1] if 1 <= template_slot <= len(configured_rounds)
            else next(
                (config for config in configured_rounds if str(config.get('name') or '').strip().casefold() == round_name.casefold()),
                configured_rounds[history_index] if history_index < len(configured_rounds) else None,
            )
        )
        values['round_id'] = str(item.get('roundId') or (matching_round or {}).get('id') or '').strip()
        if values.get('eligibility'):
            values['eligibility'] = normalize_eligibility(values['eligibility'])
        if values.get('exam_date'):
            values['exam_date'] = parse_dob(values['exam_date']) or values['exam_date']
        values['occurrence_id'] = occurrence_id_from_round(matching_round, values.get('occurrence_id'), values.get('exam_date'))
        values['raw_data'] = {str(key): value for key, value in item.items() if value not in (None, '')}
        existing_result = RoundResult.objects.filter(
            participation=participation,
            round_id=values['round_id'],
            occurrence_id=values['occurrence_id'],
        ).first() if values['round_id'] and values['occurrence_id'] else None
        if not existing_result:
            existing_result = RoundResult.objects.filter(participation=participation, round_name=round_name, occurrence_id=values['occurrence_id']).first()
        if not existing_result and values.get('round_id'):
            existing_result = RoundResult.objects.filter(
                participation=participation,
                round_id=values['round_id'],
            ).first()
        if existing_result:
            if not values.get('round_id'):
                values['round_id'] = existing_result.round_id
            for model_field in ROUND_FIELD_MAP.values():
                current_value = str(getattr(existing_result, model_field) or '').strip()
                if (
                    not values.get(model_field)
                    or (update_mode == 'fill-empty' and current_value)
                    or (update_mode != 'fill-empty' and not import_empty_values and not current_value)
                ):
                    values[model_field] = getattr(existing_result, model_field)
            for field_name, value in values.items():
                setattr(existing_result, field_name, value)
            existing_result.save()
            ensure_sheet_room_assignment(existing_result)
        elif import_empty_values or participation_created:
            saved_result = RoundResult.objects.create(
                participation=participation,
                round_name=round_name,
                **values,
            )
            ensure_sheet_room_assignment(saved_result)
    # A new registration always enters the first configured round so it is visible and manageable in the round roster.
    if not participation.round_results.exists():
        first_round = next((str(item.get('name') or '').strip() for item in (session.rounds or []) if isinstance(item, dict) and item.get('name')), 'Vòng 1')
        first_round_config = next((item for item in configured_rounds if item.get('name')), {})
        RoundResult.objects.get_or_create(
            participation=participation,
            round_name=first_round,
            defaults={'round_id': str(first_round_config.get('id') or '')},
        )
    return participation


def normalized_exam_history(candidate):
    rows = []
    participations = candidate.participations.all() if 'participations' in getattr(candidate, '_prefetched_objects_cache', {}) else CandidateParticipation.objects.filter(candidate=candidate).select_related('session').prefetch_related('round_results')
    for participation in participations:
        for result in participation.round_results.all():
            rows.append({
            'sessionId': participation.session_id,
                'sessionCode': participation.session.code,
                'roundId': result.round_id,
                'round': result.round_name,
                'eligibility': result.eligibility,
                'sbd': result.sbd,
                'roomId': str(result.exam_room_id or ''),
                'roomName': result.room_name,
                'date': result.exam_date,
                'time': result.time_slot,
                'mode': result.mode,
                'location': result.location,
                'link': result.link,
                'account': result.account,
                'password': result.password,
                'attendance': result.attendance,
                'score': result.score,
                'scoreRate': result.score_rate,
                'rank': result.rank,
                'result': result.result,
                'note': result.note,
            })
    return rows


def ensure_output_sheet_source(session, url, sheet_tab='', created_by=None):
    """Keep one dedicated output Sheet per examination session."""
    url = str(url or '').strip()
    existing = ExaminationSheet.objects.filter(session_id=session.id, stage='session-output').first()
    if not url:
        if existing:
            existing.delete()
        return None
    name = f'Du lieu xuat - {session.code} - {session.name}'
    if existing:
        existing.name = name
        existing.url = url
        existing.sheet_tab = str(sheet_tab or '').strip()
        existing.updated_at = timezone.now()
        existing.save(update_fields=['name', 'url', 'sheet_tab', 'updated_at'])
        return existing
    return ExaminationSheet.objects.create(
        id=f"sheet-{uuid.uuid4().hex[:10]}", name=name, url=url, status='idle',
        session_id=session.id, sheet_tab=str(sheet_tab or '').strip(),
        stage='session-output', created_at=timezone.now(), updated_at=timezone.now(),
        created_by=created_by or None,
    )

def ensure_registration_sheet_source(session, created_by=None):
    """Keep the registration Sheet link available as an importable source for a session."""
    url = str(session.registration_sheet_url or '').strip()
    existing = ExaminationSheet.objects.filter(session_id=session.id, stage='registration-source').first()
    if not url:
        if existing:
            existing.delete()
        return None
    name = f'Danh sach dang ky - {session.code} - {session.name}'
    if existing:
        existing.name = name
        existing.url = url
        existing.sheet_tab = str(session.registration_sheet_tab or '').strip()
        existing.updated_at = timezone.now()
        existing.save(update_fields=['name', 'url', 'sheet_tab', 'updated_at'])
        return existing
    return ExaminationSheet.objects.create(
        id=f"sheet-{uuid.uuid4().hex[:10]}", name=name, url=url, status='idle',
        session_id=session.id, sheet_tab=str(session.registration_sheet_tab or '').strip(),
        stage='registration-source', created_at=timezone.now(), updated_at=timezone.now(),
        created_by=created_by or None,
    )


def serialize_examination_sheet(sheet):
    return {
        'id': sheet.id,
        'name': sheet.name,
        'url': sheet.url,
        'status': sheet.status,
        'sessionId': sheet.session_id,
        'sheetTab': sheet.sheet_tab,
        'stage': sheet.stage,
        'automationEnabled': sheet.automation_enabled,
        'automationStartDate': sheet.automation_start_date.isoformat() if sheet.automation_start_date else '',
        'automationEndDate': sheet.automation_end_date.isoformat() if sheet.automation_end_date else '',
        'lastImportAt': sheet.last_import_at.isoformat() if sheet.last_import_at else None,
        'lastExportAt': sheet.last_export_at.isoformat() if sheet.last_export_at else None,
        'pendingManualImport': sheet.pending_manual_import,
        'changeDetectedAt': sheet.change_detected_at.isoformat() if sheet.change_detected_at else None,
        'lastError': sheet.last_error,
        'createdAt': sheet.created_at.isoformat(),
        'updatedAt': sheet.updated_at.isoformat(),
        'createdBy': sheet.created_by,
    }


def parse_optional_date(value, label):
    value = str(value or '').strip()
    if not value:
        return None
    try:
        return datetime.strptime(value, '%Y-%m-%d').date()
    except ValueError as exc:
        raise ValueError(f'{label} không hợp lệ.') from exc

def serialize_competition(comp):
    return {
        'id': comp.id,
        'code': comp.code,
        'name': comp.name,
        'parent': comp.parent,
        'organizer': comp.organizer,
        'sortKey': comp.sort_key,
        'createdBy': comp.created_by,
        'updatedAt': comp.updated_at.isoformat()
    }

def request_can_view_sensitive_data(request):
    return bool(getattr(getattr(request, 'user', None), 'email', ''))


def serialize_session(sess, include_private=True):
    competition = sess._bootstrap_competition if hasattr(sess, '_bootstrap_competition') else session_competition(sess)
    output_sheet = sess._bootstrap_output_sheet if hasattr(sess, '_bootstrap_output_sheet') else ExaminationSheet.objects.filter(session_id=sess.id, stage='session-output').first()
    return {
        'id': sess.id,
        'competitionId': sess.competition_id,
        'competitionName': competition.name if competition else sess.parent,
        'code': sess.code,
        'name': sess.name,
        'parent': sess.parent,
        'organizer': sess.organizer,
        'time': sess.time,
        'candidates': sess.candidates_count,
        'national': sess.national,
        'nationalDate': sess.national_date,
        'international': sess.international,
        'internationalDate': sess.international_date,
        'phase': sess.phase,
        'note': sess.note,
        'registrationSheetUrl': sess.registration_sheet_url if include_private else '',
        'registrationSheetTab': sess.registration_sheet_tab if include_private else '',
        'outputSheetUrl': (output_sheet.url if output_sheet else '') if include_private else '',
        'outputSheetTab': (output_sheet.sheet_tab if output_sheet else '') if include_private else '',
        'rounds': sess.rounds or [],
        'sortKey': sess.sort_key,
        'createdBy': sess.created_by,
        'updatedAt': sess.updated_at.isoformat()
    }

def serialize_candidate_participations(cand, include_private=True):
    participations = cand.participations.all() if 'participations' in getattr(cand, '_prefetched_objects_cache', {}) else CandidateParticipation.objects.filter(candidate=cand).select_related('session').prefetch_related('round_results')
    rows = []
    for participation in participations:
        rows.append({
            'sessionId': participation.session_id,
            'sessionCode': participation.session.code,
            'sessionName': participation.session.name,
            'sessionTime': participation.session.time,
            'registration': {
                'subject': participation.subject, 'category': participation.category,
                'registrationMethod': participation.registration_method, 'registrationUnit': participation.registration_unit,
                'teamName': participation.team_name, 'examLanguage': participation.exam_language,
                'generalNote': participation.general_note, 'certificateLink': participation.certificate_link,
            },
            'rounds': [{
                'id': str(result.id),
                'roundId': result.round_id, 'round': result.round_name, 'eligibility': result.eligibility, 'sbd': result.sbd,
                'occurrenceId': result.occurrence_id,
                'roomId': str(result.exam_room_id or ''), 'roomName': result.room_name,
                'date': result.exam_date, 'time': result.time_slot, 'mode': result.mode,
                'location': result.location, 'link': result.link, 'account': result.account if include_private else '', 'password': result.password if include_private else '',
                'attendance': result.attendance, 'score': result.score, 'scoreRate': result.score_rate,
                'rank': result.rank, 'result': result.result, 'note': result.note,
            } for result in participation.round_results.all()],
        })
    return rows

def serialize_candidate(cand, include_private=True):
    return {
        'id': cand.id,
        'code': cand.code,
        'name': cand.name,
        'school': cand.school or '',
        'className': cand.class_name or '',
        'city': cand.city or '',
        'ward': cand.ward or '',
        'nationality': cand.nationality or '',
        'grade': cand.grade or '',
        'contests': cand.contests or '',
        'achievement': cand.achievement or '',
        'highestRound': cand.highest_round or '',
        'email': cand.email or '',
        'parent': cand.parent or '',
        'phone': cand.phone or '',
        'identity': cand.identity or '',
        'address': cand.address or '',
        'birthDate': cand.birth_date or '',
        'sessionIds': cand.session_ids or [],
        'participations': serialize_candidate_participations(cand, include_private=include_private),
        'examHistory': normalized_exam_history(cand) or cand.exam_history or [],
        'sortKey': cand.sort_key,
        'updated': cand.updated or ''
    }


def serialize_lognote(note):
    return {
        'id': note.key,
        'time': timezone.localtime(note.created_at).strftime('%d/%m/%Y %H:%M'),
        'createdAt': note.created_at.isoformat(),
        'actor': note.updated_by or 'Nhân viên FT Workspace',
        'actorEmail': note.actor_email or '',
        'actorPhotoURL': note.actor_photo_url or '',
        'content': humanize_lognote_content(note.content),
        'system': note.system,
    }

PARTNER_CONFIG_KEY = 'examination_partners'


def normalize_partners(rows):
    normalized, seen = [], set()
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        partner_id = str(row.get('id') or '').strip()
        school = str(row.get('school') or '').strip()
        if not partner_id or not school or partner_id in seen:
            continue
        seen.add(partner_id)
        counts = []
        for item in row.get('studentCounts') or []:
            if not isinstance(item, dict) or not str(item.get('session') or '').strip():
                continue
            try:
                count = max(0, int(item.get('count') or 0))
            except (TypeError, ValueError):
                count = 0
            counts.append({'session': str(item.get('session')).strip(), 'count': count})
        normalized.append({
            'id': partner_id, 'province': str(row.get('province') or '').strip(), 'ward': str(row.get('ward') or '').strip(),
            'school': school, 'level': str(row.get('level') or '').strip(), 'representative': str(row.get('representative') or '').strip(),
            'phone': str(row.get('phone') or '').strip(), 'email': str(row.get('email') or '').strip().lower(),
            'contests': list(dict.fromkeys(str(item).strip() for item in row.get('contests') or [] if str(item).strip())),
            'studentCounts': counts,
        })
    return normalized


def recover_partners_from_lognotes():
    recovered = {}
    markers = ('. Thông tin sau: ', '. Dữ liệu sau: ')
    for note in LogNote.objects.filter(entity_key__startswith='partner-').order_by('created_at'):
        content = str(note.content or '')
        marker = next((item for item in markers if item in content), None)
        if not marker:
            continue
        try:
            after = content.split(marker, 1)[1].strip()
            raw_partner = parse_structured_audit_value(after[:-1] if after.endswith('.') else after)
            partner = normalize_partners([raw_partner] if isinstance(raw_partner, dict) else [])
        except (TypeError, ValueError):
            partner = []
        if partner:
            recovered[partner[0]['id']] = partner[0]
    return list(recovered.values())


def persisted_partners():
    config, _ = SystemConfig.objects.get_or_create(key=PARTNER_CONFIG_KEY)
    partners = normalize_partners((config.data or {}).get('partners'))
    if partners:
        return partners
    recovered = recover_partners_from_lognotes()
    if recovered:
        config.data = {'partners': recovered}
        config.save(update_fields=['data'])
    return recovered


@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticatedOrReadOnly])
def partners_detail(request):
    if request.method == 'GET':
        return Response({'partners': persisted_partners()})
    if getattr(request, 'user_role', getattr(request.user, 'role', '')) not in {'ADMIN', 'MANAGER'}:
        return Response({'error': 'Bạn không có quyền cập nhật đối tác.'}, status=status.HTTP_403_FORBIDDEN)
    before_partners = {item['id']: item for item in persisted_partners()}
    partners = normalize_partners((request.data or {}).get('partners'))
    after_partners = {item['id']: item for item in partners}
    config, _ = SystemConfig.objects.get_or_create(key=PARTNER_CONFIG_KEY)
    config.data = {'partners': partners}
    config.save(update_fields=['data'])
    labels = {
        'school': 'Tên đối tác', 'province': 'Tỉnh/Thành phố', 'ward': 'Phường/Xã',
        'level': 'Loại/Cấp học', 'representative': 'Đầu mối liên hệ',
        'phone': 'Số điện thoại', 'email': 'Email', 'contests': 'Các cuộc thi',
        'studentCounts': 'Số học sinh cộng tác theo kỳ',
    }
    for partner_id in sorted(set(before_partners) | set(after_partners)):
        before, after = before_partners.get(partner_id), after_partners.get(partner_id)
        entity_key = f'partner-{partner_id}'
        if before is None:
            append_audit(entity_key, 'Tạo đối tác: ' + audit_values({}, after, labels), request)
        elif after is None:
            append_audit(entity_key, 'Xóa đối tác. Thông tin trước khi xóa: ' + audit_values({}, before, labels), request)
        else:
            changes = audit_values(before, after, labels)
            if changes:
                append_audit(entity_key, 'Cập nhật đối tác: ' + changes, request)
    return Response({'partners': partners})
@api_view(['GET'])
@permission_classes([IsAuthenticatedOrReadOnly])
def examination_bootstrap(request):
    try:
        ensure_examination_seed()
        sync_session_candidate_totals()
        for session in ExamSession.objects.all():
            refresh_automatic_session_phase(session)
        
        include_private = request_can_view_sensitive_data(request)
        competition_rows = list(Competition.objects.all().order_by('sort_key')[:1000])
        competition_by_id = {item.id: item for item in competition_rows}
        output_sheets = {}
        for item in ExaminationSheet.objects.filter(stage='session-output').order_by('session_id', '-updated_at'):
            output_sheets.setdefault(item.session_id, item)
        session_rows = list(ExamSession.objects.all().order_by('sort_key')[:1000])
        for session in session_rows:
            if session.competition_id in competition_by_id:
                session._bootstrap_competition = competition_by_id[session.competition_id]
            session._bootstrap_output_sheet = output_sheets.get(session.id)
        participation_rows = CandidateParticipation.objects.select_related('session').prefetch_related('round_results')
        candidate_rows = Candidate.objects.prefetch_related(Prefetch('participations', queryset=participation_rows)).order_by('sort_key')[:1000]
        competitions = [serialize_competition(item) for item in competition_rows]
        sessions = [serialize_session(item, include_private=include_private) for item in session_rows]
        candidates = [serialize_candidate(item, include_private=include_private) for item in candidate_rows]
        
        return Response({
            'competitions': competitions,
            'sessions': sessions,
            'candidates': candidates,
            'partners': persisted_partners()
        })
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['GET'])
@permission_classes([IsAuthenticatedOrReadOnly])
def get_resource_list(request, resource):
    try:
        ensure_examination_seed()
        limit = int(request.query_params.get('limit', 50))
        cursor = request.query_params.get('cursor')
        
        include_private = request_can_view_sensitive_data(request)
        if resource == 'competitions':
            queryset = Competition.objects.all().order_by('sort_key')
            if cursor:
                queryset = queryset.filter(sort_key__gt=cursor)
            items = list(queryset[:limit + 1])
            has_next = len(items) > limit
            items_to_return = items[:limit]
            
            return Response({
                'items': [serialize_competition(c) for c in items_to_return],
                'nextCursor': items_to_return[-1].sort_key if has_next and items_to_return else None
            })
            
        elif resource == 'sessions':
            for session in ExamSession.objects.all():
                refresh_automatic_session_phase(session)
            queryset = ExamSession.objects.all().order_by('sort_key')
            if cursor:
                queryset = queryset.filter(sort_key__gt=cursor)
            items = list(queryset[:limit + 1])
            has_next = len(items) > limit
            items_to_return = items[:limit]
            
            return Response({
                'items': [serialize_session(s, include_private=include_private) for s in items_to_return],
                'nextCursor': items_to_return[-1].sort_key if has_next and items_to_return else None
            })
            
        elif resource == 'candidates':
            queryset = Candidate.objects.all().order_by('sort_key')
            if cursor:
                queryset = queryset.filter(sort_key__gt=cursor)
            items = list(queryset[:limit + 1])
            has_next = len(items) > limit
            items_to_return = items[:limit]
            
            return Response({
                'items': [serialize_candidate(c, include_private=include_private) for c in items_to_return],
                'nextCursor': items_to_return[-1].sort_key if has_next and items_to_return else None
            })
            
        else:
            return Response({'error': 'Nguồn dữ liệu không hợp lệ.'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def competition_create(request):
    data = request.data or {}
    code = data.get('code', '').strip().upper()
    name = data.get('name', '').strip()
    organizer = data.get('organizer', '').strip()
    parent = data.get('parent', '').strip()
    
    if not code or not name or not organizer:
        return Response({'error': 'Tên, mã cuộc thi và BTC quốc tế là bắt buộc.'}, status=status.HTTP_400_BAD_REQUEST)
        
    comp_id = f"comp-{uuid.uuid4().hex[:10]}"
    comp = Competition.objects.create(
        id=comp_id,
        code=code,
        name=name,
        organizer=organizer,
        parent=parent or code,
        sort_key=f"{code.lower()}_{comp_id}",
        created_by=request.user.email if hasattr(request.user, 'email') else None
    )
    append_audit(f'competition-{comp.id}', 'Tạo cuộc thi: ' + audit_values({}, {'code': comp.code, 'name': comp.name, 'parent': comp.parent, 'organizer': comp.organizer}, {'code':'Mã cuộc thi', 'name':'Tên cuộc thi', 'parent':'Cuộc thi mẹ', 'organizer':'Ban tổ chức quốc tế'}), request)
    notify_examination_staff(
        event_key=f'examination-competition-created:{comp.id}',
        title=f'Cuộc thi mới: {comp.code}',
        message=f'{audit_actor(request)} đã tạo cuộc thi {comp.name}, Ban tổ chức quốc tế {comp.organizer}.',
        action_url=f'/examination/competitions/{comp.id}',
    )
    return Response(serialize_competition(comp), status=status.HTTP_201_CREATED)

@api_view(['PUT', 'DELETE'])
@permission_classes([IsManagerOrAdmin])
def competition_detail(request, pk):
    try:
        comp = Competition.objects.get(id=pk)
    except Competition.DoesNotExist:
        return Response({'error': 'Không tìm thấy cuộc thi.'}, status=status.HTTP_404_NOT_FOUND)
        
    if request.method == 'PUT':
        before = {'code': comp.code, 'name': comp.name, 'parent': comp.parent, 'organizer': comp.organizer}
        data = request.data or {}
        if 'code' in data and data['code'].strip():
            comp.code = data['code'].strip().upper()
        if 'name' in data and data['name'].strip():
            comp.name = data['name'].strip()
        if 'organizer' in data and data['organizer'].strip():
            comp.organizer = data['organizer'].strip()
        if 'parent' in data and data['parent'].strip():
            comp.parent = data['parent'].strip()
            
        comp.sort_key = f"{comp.code.lower()}_{comp.id}"
        comp.save()
        
        # Propagate changes to sessions with this competitionId
        sessions = ExamSession.objects.filter(competition_id=comp.id)
        for s in sessions:
            s.code = comp.code
            s.parent = comp.name
            s.organizer = comp.organizer
            s.save()
            append_audit(f'session-{s.id}', f'Hệ thống đồng bộ thông tin cuộc thi {comp.code}: ' + audit_values({}, {'code': s.code, 'parent': s.parent, 'organizer': s.organizer}, {'code':'Mã cuộc thi', 'parent':'Cuộc thi mẹ', 'organizer':'Ban tổ chức quốc tế'}), request, system=True)
            
        change_text = audit_values(before, {'code': comp.code, 'name': comp.name, 'parent': comp.parent, 'organizer': comp.organizer}, {'code':'Mã cuộc thi', 'name':'Tên cuộc thi', 'parent':'Cuộc thi mẹ', 'organizer':'Ban tổ chức quốc tế'})
        append_audit(f'competition-{comp.id}', 'Cập nhật cuộc thi: ' + (change_text or 'Không có thay đổi dữ liệu.'), request)
        if change_text:
            notify_examination_staff(
                event_key=f'examination-competition-updated:{comp.id}:{uuid.uuid4().hex}',
                title=f'Đã cập nhật cuộc thi {comp.code}',
                message=f'{audit_actor(request)} đã cập nhật: {change_text}',
                action_url=f'/examination/competitions/{comp.id}',
            )
        return Response(serialize_competition(comp))
        
    elif request.method == 'DELETE':
        if getattr(request, 'user_role', 'EMPLOYEE') != 'ADMIN':
            return Response({'error': 'Quyền admin là bắt buộc để xóa.'}, status=status.HTTP_403_FORBIDDEN)
        # Check if there are sessions for this competition
        sessions_exist = ExamSession.objects.filter(competition_id=comp.id).exists()
        if sessions_exist:
            return Response({'error': 'Hãy xóa các kỳ tổ chức thuộc cuộc thi trước.'}, status=status.HTTP_400_BAD_REQUEST)
            
        append_audit(f'competition-{comp.id}', f'Xóa cuộc thi {comp.code} · {comp.name}.', request)
        comp.delete()
        return Response({'success': True})

def sync_legacy_round_milestones(session, rounds):
    """Keep legacy summary fields aligned with the named rounds when available."""
    def find_round(*markers):
        matches = [
            round_config for round_config in rounds
            if any(marker in str(round_config.get('name') or '').lower() for marker in markers)
        ]
        return next(
            (round_config for round_config in matches if round_config.get('label') or round_config.get('date')),
            matches[0] if matches else None,
        )

    # The legacy national field historically represents the national final.
    # Prefer it over a qualifying round whenever both are configured.
    national = (
        find_round('chung k\u1ebft qu\u1ed1c gia', 'national final')
        or find_round('qu\u1ed1c gia', 'national')
    )
    international = find_round('qu\u1ed1c t\u1ebf', 'international')
    session.national = str(national.get('label') or '').strip() if national else ''
    session.national_date = str(national.get('date') or '').strip() if national else ''
    session.international = str(international.get('label') or '').strip() if international else ''
    session.international_date = str(international.get('date') or '').strip() if international else ''


def _phase_key(value):
    """Normalize Vietnamese phase/round labels for phase automation."""
    return ''.join(
        char for char in unicodedata.normalize('NFD', str(value or '').casefold())
        if unicodedata.category(char) != 'Mn'
    ).replace('đ', 'd')


def notify_examination_staff(*, event_key, title, message, action_url, severity='info'):
    """Notify Khảo thí staff, falling back to module access for legacy profiles."""
    department_members = list(
        UserProfile.objects.filter(
            Q(department__name__iexact='Khảo thí') |
            Q(departments__name__iexact='Khảo thí')
        ).values_list('email', flat=True).distinct()
    )
    return notify_workspace(
        event_key=event_key,
        title=title,
        message=message,
        severity=severity,
        category='examination',
        action_url=action_url,
        target_emails=department_members,
        target_modules=[] if department_members else ['examination'],
    )


def _parse_round_date(value):
    """Accept ISO dates and the date labels used by legacy examination sessions."""
    raw = str(value or '').strip()
    if not raw:
        return None
    for pattern in ('%Y-%m-%d', '%d/%m/%Y', '%d/%m/%y', '%m/%d/%Y', '%m/%d/%y'):
        try:
            return datetime.strptime(raw[:10], pattern).date()
        except ValueError:
            continue
    return None


def dated_session_rounds(session):
    """Return every concrete day of each configured round in examination order."""
    configured = session.rounds or []
    if not configured:
        configured = [
            {'name': 'Vòng Chung kết Quốc gia', 'date': session.national_date},
            {'name': 'Vòng Quốc tế', 'date': session.international_date},
        ]
    rows = []
    for position, round_config in enumerate(configured):
        if not isinstance(round_config, dict):
            continue
        name = str(round_config.get('name') or '').strip()
        if not name:
            continue
        values = [round_config.get('date')]
        values.extend(slot.get('date') for slot in (round_config.get('slots') or []) if isinstance(slot, dict))
        dates = sorted({_parse_round_date(value) for value in values if _parse_round_date(value)})
        for round_date in dates:
            rows.append((round_date, position, name))
    return sorted(rows, key=lambda item: (item[0], item[1]))
def automatic_session_phase(session, current_date=None):
    """Derive the operational phase from dated rounds without changing the round plan."""
    today = current_date or timezone.localdate()
    rounds = dated_session_rounds(session)
    if not rounds:
        return str(session.phase or '').strip() or 'Chuẩn bị/Truyền thông'

    final_date, final_position, final_name = rounds[-1]
    configured_rounds = [item for item in (session.rounds or []) if isinstance(item, dict)]
    has_later_planned_round = any(
        position > final_position and str(item.get('name') or '').strip() and not _parse_round_date(item.get('date'))
        for position, item in enumerate(configured_rounds)
    )
    if has_later_planned_round and today > final_date:
        if 'quoc gia' in _phase_key(final_name):
            return 'Ôn tập Vòng quốc tế'
        return str(session.phase or '').strip() or 'Chuẩn bị/Truyền thông'

    phase = str(session.phase or '').strip()
    phase_key = _phase_key(phase)
    automatic_phase_keys = {
        'tuyen sinh', 'chuan bi', 'chuan bi/truyen thong',
        'on tap vong quoc gia', 'on tap vong quoc te',
        'vong quoc gia', 'vong chung ket quoc gia', 'vong quoc te',
        'tong hop ket qua', 'cong bo ket qua', 'cong bo ket qua, phuc khao',
        'vinh danh', 'hoan thanh',
    }
    # Operational teams can keep a special post-final phase open beyond the
    # default timetable. Only recognised automatic phases are advanced here.
    if today > final_date and phase and phase_key not in automatic_phase_keys:
        return phase

    if today >= final_date + timedelta(days=35):
        return 'Hoàn thành'
    if today >= final_date + timedelta(days=28):
        return 'Vinh danh'
    if today >= final_date + timedelta(days=21):
        return 'Công bố kết quả, phúc khảo'
    if today >= final_date + timedelta(days=14):
        return 'Tổng hợp kết quả'
    if today >= final_date:
        return final_name

    upcoming = next((round_item for round_item in rounds if round_item[0] >= today), None)
    if upcoming:
        upcoming_date, _, upcoming_name = upcoming
        if today >= upcoming_date - timedelta(days=7):
            return upcoming_name

        completed = [round_item for round_item in rounds if round_item[0] < today]
        if completed:
            _, _, last_completed_name = completed[-1]
            if 'quoc gia' in _phase_key(last_completed_name) and 'quoc te' in _phase_key(upcoming_name):
                return 'Ôn tập Vòng quốc tế'

    return phase or 'Chuẩn bị/Truyền thông'

def refresh_automatic_session_phase(session, current_date=None):
    """Persist the calculated phase so lists, details and integrations agree."""
    phase = automatic_session_phase(session, current_date=current_date)
    if phase != session.phase:
        previous = session.phase
        session.phase = phase
        session.save(update_fields=['phase', 'updated_at'])
        append_audit(
            f'session-{session.id}',
            f'Hệ thống tự chuyển giai đoạn từ "{previous or "Chưa cập nhật"}" thành "{phase}" theo lịch các vòng thi.',
            system=True,
        )
        append_competition_scope_audit(
            session,
            f'Hệ thống tự chuyển giai đoạn từ "{previous or "Chưa cập nhật"}" thành "{phase}" theo lịch các vòng thi.',
            system=True,
        )
        effective_date = current_date or timezone.localdate()
        notify_examination_staff(
            event_key=f'examination-session-phase:{session.id}:{phase}:{effective_date.isoformat()}',
            title=f'{session.code}: chuyển sang {phase}',
            message=f'Kỳ tổ chức {session.name} đã tự chuyển từ “{previous or "Chưa cập nhật"}” sang “{phase}” theo lịch các vòng thi.',
            action_url=f'/examination/sessions/{session.id}',
            severity='success' if _phase_key(phase) == 'hoan thanh' else 'info',
        )
    return phase

@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def session_create(request):
    data = request.data or {}
    competition_id = data.get('competitionId')
    name = data.get('name', '').strip()
    national = data.get('national', {})
    international = data.get('international', {})
    note = data.get('note', '').strip()
    rounds = data.get('rounds', [])
    
    if not competition_id or not name or not national or not international:
        return Response({'error': 'Tên kỳ, cuộc thi và thời gian hai vòng là bắt buộc.'}, status=status.HTTP_400_BAD_REQUEST)
        
    try:
        comp = Competition.objects.get(id=competition_id)
    except Competition.DoesNotExist:
        return Response({'error': 'Không tìm thấy cuộc thi.'}, status=status.HTTP_404_NOT_FOUND)
        
    sess_id = f"session-{uuid.uuid4().hex[:10]}"
    
    # Process rounds
    processed_rounds = []
    if isinstance(rounds, list):
        for r in rounds:
            if isinstance(r, dict) and r.get('name'):
                timing = r.get('time') if isinstance(r.get('time'), dict) else {}
                processed_rounds.append({
                    'id': r.get('id') or f"round-{uuid.uuid4().hex[:10]}",
                    'name': str(r['name']).strip(),
                    'label': str(r.get('label') or timing.get('label') or '').strip(),
                    'date': r.get('date') or timing.get('date'),
                    'slots': [{key: str(slot.get(key) or '').strip() for key in ('id', 'date', 'time', 'mode', 'link', 'location', 'note')} for slot in r.get('slots', []) if isinstance(slot, dict)]
                })
                
    round_national = next((item for item in processed_rounds if 'qu\u1ed1c gia' in str(item.get('name') or '').lower() or 'national' in str(item.get('name') or '').lower()), None)
    round_international = next((item for item in processed_rounds if 'qu\u1ed1c t\u1ebf' in str(item.get('name') or '').lower() or 'international' in str(item.get('name') or '').lower()), None)
    if round_national:
        national = round_national
    if round_international:
        international = round_international
    time_str = f"{national.get('label', '')} · {international.get('label', '')}".strip()
    sess = ExamSession.objects.create(
        id=sess_id,
        competition_id=comp.id,
        code=comp.code,
        name=name,
        parent=comp.name,
        organizer=comp.organizer,
        time=time_str,
        candidates_count=0,
        national=national.get('label'),
        national_date=national.get('date'),
        international=international.get('label'),
        international_date=international.get('date'),
        phase='Chuẩn bị',
        note=note or 'Kỳ tổ chức mới tạo.',
        rounds=processed_rounds,
        sort_key=f"{comp.code.lower()}_{sess_id}",
        created_by=request.user.email if hasattr(request.user, 'email') else None,
        registration_sheet_url=str(data.get('registrationSheetUrl') or '').strip(),
        registration_sheet_tab=str(data.get('registrationSheetTab') or '').strip()
    )
    ensure_registration_sheet_source(sess, getattr(request.user, 'email', ''))
    ensure_output_sheet_source(sess, data.get('outputSheetUrl'), data.get('outputSheetTab'), getattr(request.user, 'email', ''))
    append_audit(f'session-{sess.id}', 'Tạo kỳ tổ chức: ' + audit_values({}, {'name': sess.name, 'competition': comp.code, 'phase': sess.phase, 'rounds': processed_rounds}, {'name':'Tên kỳ tổ chức', 'competition':'Cuộc thi', 'phase':'Giai đoạn', 'rounds':'Các vòng thi'}), request)
    append_audit(f'competition-{comp.id}', 'Tạo kỳ tổ chức: ' + audit_values({}, {'name': sess.name, 'competition': comp.code, 'phase': sess.phase, 'rounds': processed_rounds}, {'name':'Tên kỳ tổ chức', 'competition':'Cuộc thi', 'phase':'Giai đoạn', 'rounds':'Các vòng thi'}), request)
    notify_examination_staff(
        event_key=f'examination-session-created:{sess.id}',
        title=f'Kỳ tổ chức mới: {sess.code}',
        message=f'{audit_actor(request)} đã tạo kỳ tổ chức {sess.name}.',
        action_url=f'/examination/sessions/{sess.id}',
    )
    _refresh_examination_work_schedule()
    return Response(serialize_session(sess), status=status.HTTP_201_CREATED)

@api_view(['PUT', 'DELETE'])
@permission_classes([IsManagerOrAdmin])
def session_detail(request, pk):
    try:
        sess = ExamSession.objects.get(id=pk)
    except ExamSession.DoesNotExist:
        return Response({'error': 'Không tìm thấy kỳ tổ chức.'}, status=status.HTTP_404_NOT_FOUND)
        
    if request.method == 'PUT':
        before = {'name': sess.name, 'phase': sess.phase, 'note': sess.note, 'registrationSheetUrl': sess.registration_sheet_url, 'registrationSheetTab': sess.registration_sheet_tab, 'outputSheetUrl': (ExaminationSheet.objects.filter(session_id=sess.id, stage='session-output').first().url if ExaminationSheet.objects.filter(session_id=sess.id, stage='session-output').first() else ''), 'outputSheetTab': (ExaminationSheet.objects.filter(session_id=sess.id, stage='session-output').first().sheet_tab if ExaminationSheet.objects.filter(session_id=sess.id, stage='session-output').first() else ''), 'national': sess.national, 'nationalDate': sess.national_date, 'international': sess.international, 'internationalDate': sess.international_date, 'competitionId': sess.competition_id, 'rounds': sess.rounds or []}
        data = request.data or {}
        
        allowed_fields = ['name', 'phase', 'note', 'national', 'nationalDate', 'international', 'internationalDate', 'registrationSheetUrl', 'registrationSheetTab', 'outputSheetUrl', 'outputSheetTab']
        for field in allowed_fields:
            if field in data:
                val = str(data[field]).strip()
                if field == 'name': sess.name = val
                elif field == 'phase': sess.phase = val
                elif field == 'note': sess.note = val
                elif field == 'registrationSheetUrl': sess.registration_sheet_url = val
                elif field == 'registrationSheetTab': sess.registration_sheet_tab = val
                elif field == 'national': sess.national = val
                elif field == 'nationalDate': sess.national_date = val
                elif field == 'international': sess.international = val
                elif field == 'internationalDate': sess.international_date = val
                
        if 'rounds' in data and isinstance(data['rounds'], list):
            processed_rounds = []
            for r in data['rounds']:
                if isinstance(r, dict) and r.get('name'):
                    timing = r.get('time') if isinstance(r.get('time'), dict) else {}
                    processed_rounds.append({
                        'id': r.get('id') or f"round-{uuid.uuid4().hex[:10]}",
                        'name': str(r['name']).strip(),
                        'label': str(r.get('label') or timing.get('label') or '').strip(),
                    'date': r.get('date') or timing.get('date'),
                    'slots': [{key: str(slot.get(key) or '').strip() for key in ('id', 'date', 'time', 'mode', 'link', 'location', 'note')} for slot in r.get('slots', []) if isinstance(slot, dict)]
                    })
            sess.rounds = processed_rounds
            sync_legacy_round_milestones(sess, processed_rounds)
            
        if 'competitionId' in data and data['competitionId'] and data['competitionId'] != sess.competition_id:
            try:
                comp = Competition.objects.get(id=data['competitionId'])
                sess.competition_id = comp.id
                sess.code = comp.code
                sess.parent = comp.name
                sess.organizer = comp.organizer
                sess.sort_key = f"{comp.code.lower()}_{sess.id}"
            except Competition.DoesNotExist:
                return Response({'error': 'Không tìm thấy cuộc thi được chọn.'}, status=status.HTTP_404_NOT_FOUND)
                
        sess.time = f"{sess.national or ''} · {sess.international or ''}".strip()
        sess.save()
        
        sync_session_candidate_totals()
        ensure_registration_sheet_source(sess, getattr(request.user, 'email', ''))
        ensure_output_sheet_source(sess, data.get('outputSheetUrl'), data.get('outputSheetTab'), getattr(request.user, 'email', ''))
        sess.refresh_from_db()
        after = {'name': sess.name, 'phase': sess.phase, 'note': sess.note, 'registrationSheetUrl': sess.registration_sheet_url, 'registrationSheetTab': sess.registration_sheet_tab, 'outputSheetUrl': (ExaminationSheet.objects.filter(session_id=sess.id, stage='session-output').first().url if ExaminationSheet.objects.filter(session_id=sess.id, stage='session-output').first() else ''), 'outputSheetTab': (ExaminationSheet.objects.filter(session_id=sess.id, stage='session-output').first().sheet_tab if ExaminationSheet.objects.filter(session_id=sess.id, stage='session-output').first() else ''), 'national': sess.national, 'nationalDate': sess.national_date, 'international': sess.international, 'internationalDate': sess.international_date, 'competitionId': sess.competition_id, 'rounds': sess.rounds or []}
        change_text = audit_values(before, after, {'name':'Tên kỳ tổ chức', 'phase':'Giai đoạn hiện tại', 'note':'Ghi chú', 'registrationSheetUrl':'Danh sách đăng ký', 'registrationSheetTab':'Tab danh sách đăng ký', 'outputSheetUrl':'Google Sheet output', 'outputSheetTab':'Tab Google Sheet output', 'national':'Mốc vòng quốc gia', 'nationalDate':'Ngày vòng quốc gia', 'international':'Mốc vòng quốc tế', 'internationalDate':'Ngày vòng quốc tế', 'competitionId':'Cuộc thi', 'rounds':'Thông tin các vòng thi'})
        append_audit(f'session-{sess.id}', 'Cập nhật kỳ tổ chức: ' + (change_text or 'Không có thay đổi dữ liệu.'), request)
        append_competition_scope_audit(sess, 'Cập nhật kỳ tổ chức: ' + (change_text or 'Không có thay đổi dữ liệu.'), request)
        if before.get('competitionId') and before.get('competitionId') != after.get('competitionId'):
            append_audit(f"competition-{before['competitionId']}", f'Kỳ tổ chức {sess.code} · {sess.name} đã chuyển sang cuộc thi khác.', request)
        important_fields = {'name', 'phase', 'national', 'nationalDate', 'international', 'internationalDate', 'competitionId', 'rounds'}
        if any(before.get(field) != after.get(field) for field in important_fields):
            notify_examination_staff(
                event_key=f'examination-session-updated:{sess.id}:{uuid.uuid4().hex}',
                title=f'Đã cập nhật kỳ tổ chức {sess.code}',
                message=f'{audit_actor(request)} đã cập nhật: {change_text}',
                action_url=f'/examination/sessions/{sess.id}',
            )
        _refresh_examination_work_schedule()
        return Response(serialize_session(sess))
        
    elif request.method == 'DELETE':
        if getattr(request, 'user_role', 'EMPLOYEE') != 'ADMIN':
            return Response({'error': 'Quyền admin là bắt buộc để xóa.'}, status=status.HTTP_403_FORBIDDEN)
            
        # Remove this session from candidate's session_ids
        candidates = Candidate.objects.filter(session_ids__contains=sess.id)
        for c in candidates:
            if sess.id in c.session_ids:
                c.session_ids = [s_id for s_id in c.session_ids if s_id != sess.id]
                c.save()
                
        append_audit(f'session-{sess.id}', f'Xóa kỳ tổ chức {sess.name}.', request)
        append_competition_scope_audit(sess, f'Xóa kỳ tổ chức {sess.name}.', request)
        sess.delete()
        sync_session_candidate_totals()
        _refresh_examination_work_schedule()
        return Response({'success': True})


def _session_round_config(session, round_id):
    configured = [item for item in (session.rounds or []) if isinstance(item, dict)]
    matched = next((item for item in configured if str(item.get('id') or '') == str(round_id or '')), None)
    if matched:
        return matched
    # Older sessions predate the editable `rounds` JSON configuration. Their
    # UI still exposes two legacy rounds, so room and schedule APIs must do the
    # same instead of returning a false 404.
    legacy_rounds = [
        {'id': 'legacy-national', 'name': 'Vòng Chung kết Quốc gia', 'label': session.national or '', 'date': session.national_date or '', 'slots': []},
        {'id': 'legacy-international', 'name': 'Vòng Chung kết Quốc tế', 'label': session.international or '', 'date': session.international_date or '', 'slots': []},
    ]
    return next((item for item in legacy_rounds if item['id'] == str(round_id or '')), None)

def _serialize_exam_room(room):
    return {
        'id': str(room.id),
        'roundId': room.round_id,
        'occurrenceId': room.occurrence_id,
        'roundName': room.round_name,
        'commonName': room.common_name,
        'number': room.room_number,
        'label': room.label,
        'mode': room.mode,
        'location': room.location,
        'link': room.link,
        'examLink': room.exam_link,
        'allocationStrategy': room.allocation_strategy,
        'capacity': room.capacity,
        'assignedCount': room.assignments.count(),
    }


@api_view(['GET', 'POST'])
@permission_classes([IsManagerOrAdmin])
def exam_room_allocation(request, session_id, round_id):
    try:
        session = ExamSession.objects.get(id=session_id)
    except ExamSession.DoesNotExist:
        return Response({'error': 'Không tìm thấy kỳ tổ chức.'}, status=status.HTTP_404_NOT_FOUND)

    round_config = _session_round_config(session, round_id)
    if not round_config:
        return Response({'error': 'Không tìm thấy vòng thi trong kỳ tổ chức này.'}, status=status.HTTP_404_NOT_FOUND)
    round_name = str(round_config.get('name') or '').strip()
    occurrence_id = str((request.query_params.get('occurrenceId') if request.method == 'GET' else (request.data or {}).get('occurrenceId')) or '').strip()
    occurrence_ids = [str(slot.get('id') or '').strip() for slot in (round_config.get('slots') or []) if isinstance(slot, dict) and str(slot.get('id') or '').strip()]
    if occurrence_id and occurrence_ids and occurrence_id not in occurrence_ids:
        return Response({'error': 'Đợt tổ chức không thuộc vòng thi đã chọn.'}, status=status.HTTP_400_BAD_REQUEST)
    result_query = RoundResult.objects.filter(
        participation__session=session,
        eligibility=ELIGIBILITY_ELIGIBLE,
    ).filter(
        Q(round_id=str(round_id)) | Q(round_id='', round_name=round_name),
    )
    if occurrence_id:
        result_query = result_query.filter(occurrence_id=occurrence_id)

    if request.method == 'GET':
        rooms = list(ExamRoom.objects.filter(session=session, occurrence_id=occurrence_id).filter(Q(round_id=str(round_id)) | Q(round_name=round_name)))
        return Response({
            'sessionId': session.id,
            'roundId': str(round_id),
            'roundName': round_name,
            'candidateCount': result_query.count(),
            'assignedCount': result_query.exclude(exam_room=None).count(),
            'rooms': [_serialize_exam_room(room) for room in rooms],
        })

    data = request.data or {}
    common_name = str(data.get('commonName') or '').strip()
    mode = str(data.get('mode') or '').strip().upper()
    strategy = str(data.get('allocationStrategy') or '').strip().upper()
    incoming_rooms = data.get('rooms') if isinstance(data.get('rooms'), list) else []

    if not common_name:
        return Response({'error': 'Vui lòng nhập tên gọi chung của phòng thi.'}, status=status.HTTP_400_BAD_REQUEST)
    if len(common_name) > 255:
        return Response({'error': 'Tên gọi chung không được dài quá 255 ký tự.'}, status=status.HTTP_400_BAD_REQUEST)
    if mode not in {ExamRoom.MODE_IN_PERSON, ExamRoom.MODE_ONLINE}:
        return Response({'error': 'Hình thức thi phải là trực tiếp hoặc trực tuyến.'}, status=status.HTTP_400_BAD_REQUEST)
    if strategy not in {ExamRoom.STRATEGY_BALANCED, ExamRoom.STRATEGY_CAPACITY}:
        return Response({'error': 'Cách chia phòng không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
    if not incoming_rooms:
        return Response({'error': 'Vui lòng khai báo ít nhất một phòng thi.'}, status=status.HTTP_400_BAD_REQUEST)
    if len(incoming_rooms) > 200:
        return Response({'error': 'Mỗi lần chỉ có thể tạo tối đa 200 phòng thi.'}, status=status.HTTP_400_BAD_REQUEST)

    max_candidates = None
    if strategy == ExamRoom.STRATEGY_CAPACITY:
        try:
            max_candidates = int(data.get('maxCandidates') or 0)
        except (TypeError, ValueError):
            max_candidates = 0
        if max_candidates <= 0:
            return Response({'error': 'Số thí sinh tối đa mỗi phòng phải lớn hơn 0.'}, status=status.HTTP_400_BAD_REQUEST)

    cleaned_rooms = []
    seen_numbers = set()
    for position, item in enumerate(incoming_rooms):
        if not isinstance(item, dict):
            return Response({'error': f'Phòng thứ {position + 1} không đúng định dạng.'}, status=status.HTTP_400_BAD_REQUEST)
        number = str(item.get('number') or '').strip()
        location = str(item.get('location') or '').strip()
        link = normalize_online_room_link(item.get('link'))
        exam_link = normalize_online_room_link(item.get('examLink'))
        if not number:
            return Response({'error': f'Vui lòng nhập số hoặc mã cho phòng thứ {position + 1}.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(number) > 100:
            return Response({'error': f'Số hoặc mã phòng thứ {position + 1} quá dài.'}, status=status.HTTP_400_BAD_REQUEST)
        number_key = number.casefold()
        if number_key in seen_numbers:
            return Response({'error': f'Phòng "{number}" đang bị nhập trùng.'}, status=status.HTTP_400_BAD_REQUEST)
        seen_numbers.add(number_key)
        if mode == ExamRoom.MODE_IN_PERSON and not location:
            return Response({'error': f'Vui lòng nhập địa chỉ/số phòng cho phòng "{number}".'}, status=status.HTTP_400_BAD_REQUEST)
        if mode == ExamRoom.MODE_ONLINE:
            parsed_link = urllib.parse.urlparse(link)
            if parsed_link.scheme not in {'http', 'https'} or not parsed_link.netloc:
                return Response({'error': f'Link của phòng "{number}" chưa hợp lệ. Có thể dán link Google Meet/Facebook không cần https://.'}, status=status.HTTP_400_BAD_REQUEST)
        if exam_link:
            parsed_exam_link = urllib.parse.urlparse(exam_link)
            if parsed_exam_link.scheme not in {'http', 'https'} or not parsed_exam_link.netloc:
                return Response({'error': f'Link dự thi của phòng "{number}" chưa hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
        cleaned_rooms.append({
            'number': number,
            'label': f'{common_name} {number}'.strip(),
            'location': location,
            'link': link if mode == ExamRoom.MODE_ONLINE else '',
            'exam_link': exam_link,
            'position': position,
        })

    candidate_count = result_query.count()
    if strategy == ExamRoom.STRATEGY_CAPACITY and len(cleaned_rooms) * max_candidates < candidate_count:
        capacity = len(cleaned_rooms) * max_candidates
        return Response({
            'error': f'Tổng sức chứa chỉ có {capacity} chỗ nhưng vòng thi có {candidate_count} thí sinh. Hãy thêm phòng hoặc tăng số lượng tối đa.',
            'candidateCount': candidate_count,
            'capacity': capacity,
        }, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        locked_results = list(
            result_query.select_for_update()
            .select_related('participation__candidate')
            .order_by('participation__candidate__sort_key', 'participation__candidate__code')
        )
        candidate_count = len(locked_results)
        if strategy == ExamRoom.STRATEGY_CAPACITY and len(cleaned_rooms) * max_candidates < len(locked_results):
            capacity = len(cleaned_rooms) * max_candidates
            return Response({
                'error': f'Tổng sức chứa chỉ có {capacity} chỗ nhưng vòng thi hiện có {len(locked_results)} thí sinh. Hãy tải lại và tăng sức chứa.',
                'candidateCount': len(locked_results),
                'capacity': capacity,
            }, status=status.HTTP_409_CONFLICT)
        previous_rooms = list(ExamRoom.objects.filter(session=session, occurrence_id=occurrence_id).filter(Q(round_id=str(round_id)) | Q(round_name=round_name)))
        # Deleting a room only nulls its foreign key. Clear its derived display
        # values too, so an ineligible candidate does not keep a stale room
        # after a reset/reallocation.
        for stale_result in RoundResult.objects.select_for_update().select_related('exam_room').filter(exam_room__in=previous_rooms):
            previous_room = stale_result.exam_room
            stale_result.exam_room = None
            stale_result.room_name = ''
            stale_result.location = ''
            stale_result.mode = ''
            update_fields = ['exam_room', 'room_name', 'location', 'mode', 'updated_at']
            if previous_room and previous_room.exam_link and stale_result.link == previous_room.exam_link:
                stale_result.link = ''
                update_fields.append('link')
            stale_result.save(update_fields=update_fields)
        ExamRoom.objects.filter(id__in=[room.id for room in previous_rooms]).delete()
        created_rooms = [
            ExamRoom.objects.create(
                session=session,
                round_id=str(round_id),
                occurrence_id=occurrence_id,
                round_name=round_name,
                common_name=common_name,
                room_number=item['number'],
                label=item['label'],
                mode=mode,
                location=item['location'],
                link=item['link'],
                exam_link=item['exam_link'],
                allocation_strategy=strategy,
                capacity=max_candidates,
                position=item['position'],
                created_by=audit_actor(request),
            )
            for item in cleaned_rooms
        ]

        for index, result in enumerate(locked_results):
            room_index = index % len(created_rooms) if strategy == ExamRoom.STRATEGY_BALANCED else index // max_candidates
            room = created_rooms[room_index]
            result.exam_room = room
            result.round_id = str(round_id)
            result.occurrence_id = occurrence_id
            result.room_name = room.label
            result.mode = 'Trực tiếp' if mode == ExamRoom.MODE_IN_PERSON else 'Trực tuyến'
            result.location = f'{room.label}:\n{room.link}' if mode == ExamRoom.MODE_ONLINE else ' · '.join(value for value in [room.label, room.location] if value)
            # A room link identifies where the candidate sits; an optional room exam link is assigned separately.
            if room.exam_link:
                result.link = room.exam_link
            update_fields = ['exam_room', 'round_id', 'occurrence_id', 'room_name', 'mode', 'location', 'updated_at']
            if room.exam_link:
                update_fields.append('link')
            result.save(update_fields=update_fields)

    strategy_label = 'chia đều' if strategy == ExamRoom.STRATEGY_BALANCED else f'tối đa {max_candidates} thí sinh/phòng'
    audit_content = (
        f'Phân phòng thi cho {round_name}: tạo {len(created_rooms)} phòng với tên chung "{common_name}", '
        f'phân {candidate_count} thí sinh theo cách {strategy_label}.'
    )
    append_audit(f'session-{session.id}', audit_content, request)
    append_competition_scope_audit(session, audit_content, request)

    candidate_ids = [result.participation.candidate_id for result in locked_results]
    updated_candidates = Candidate.objects.filter(id__in=candidate_ids).order_by('sort_key', 'code')
    return Response({
        'sessionId': session.id,
        'roundId': str(round_id),
        'occurrenceId': occurrence_id,
        'roundName': round_name,
        'candidateCount': candidate_count,
        'assignedCount': len(locked_results),
        'rooms': [_serialize_exam_room(room) for room in created_rooms],
        'updatedCandidates': [serialize_candidate(candidate, include_private=True) for candidate in updated_candidates],
    })


@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def apply_round_slot(request, session_id, round_id):
    """Apply one configured exam slot to all eligible candidates in a round.

    A slot supplies the shared exam schedule.  Room allocation is intentionally
    untouched: `location`, `room_name`, and `exam_room` remain owned by rooms.
    """
    try:
        session = ExamSession.objects.get(id=session_id)
    except ExamSession.DoesNotExist:
        return Response({'error': 'Không tìm thấy kỳ tổ chức.'}, status=status.HTTP_404_NOT_FOUND)

    round_config = _session_round_config(session, round_id)
    if not round_config:
        return Response({'error': 'Không tìm thấy vòng thi trong kỳ tổ chức này.'}, status=status.HTTP_404_NOT_FOUND)
    slots = [slot for slot in (round_config.get('slots') or []) if isinstance(slot, dict)]
    data = request.data or {}
    requested_slot_id = str(data.get('slotId') or '').strip()
    try:
        requested_index = int(data.get('slotIndex')) if data.get('slotIndex') is not None else None
    except (TypeError, ValueError):
        requested_index = None
    selected = next((slot for slot in slots if requested_slot_id and str(slot.get('id') or '') == requested_slot_id), None)
    if selected is None and requested_index is not None and 0 <= requested_index < len(slots):
        selected = slots[requested_index]
    if not selected:
        return Response({'error': 'Không tìm thấy lịch/ca thi đã chọn.'}, status=status.HTTP_404_NOT_FOUND)
    occurrence_id = str(selected.get('id') or '').strip()

    values = {key: str(selected.get(key) or '').strip() for key in ('date', 'time', 'mode', 'link')}
    if not any(values.values()):
        return Response({'error': 'Lịch/ca thi chưa có dữ liệu để áp dụng.'}, status=status.HTTP_400_BAD_REQUEST)
    apply_link = bool(data.get('applyLink', True))
    round_name = str(round_config.get('name') or '').strip()
    results = RoundResult.objects.filter(
        participation__session=session,
        eligibility=ELIGIBILITY_ELIGIBLE,
    ).filter(Q(round_id=str(round_id)) | Q(round_id='', round_name=round_name)).select_related('participation__candidate')
    is_batched_round = len(slots) > 1 and any(str(slot.get('label') or '').strip() for slot in slots if isinstance(slot, dict))
    if occurrence_id and is_batched_round and results.exclude(occurrence_id='').exists():
        # A batch action must never overwrite candidates in another batch.
        results = results.filter(Q(occurrence_id=occurrence_id) | Q(occurrence_id='', exam_date=values['date']))

    changed = 0
    candidate_ids = []
    with transaction.atomic():
        for result in results.select_for_update():
            update_fields = []
            for slot_field, model_field in (('date', 'exam_date'), ('time', 'time_slot'), ('mode', 'mode')):
                value = values[slot_field]
                if value and getattr(result, model_field) != value:
                    setattr(result, model_field, value)
                    update_fields.append(model_field)
            if apply_link and values['link'] and result.link != values['link']:
                result.link = values['link']
                update_fields.append('link')
            if result.round_id != str(round_id):
                result.round_id = str(round_id)
                update_fields.append('round_id')
            if occurrence_id and result.occurrence_id != occurrence_id:
                result.occurrence_id = occurrence_id
                update_fields.append('occurrence_id')
            candidate_ids.append(result.participation.candidate_id)
            if update_fields:
                result.save(update_fields=list(set(update_fields)) + ['updated_at'])
                candidate = result.participation.candidate
                candidate.updated = timezone.now().strftime('%d/%m/%Y %H:%M')
                candidate.save(update_fields=['updated'])
                changed += 1

    slot_number = (slots.index(selected) + 1) if selected in slots else 1
    audit_content = f'Áp dụng lịch/ca {slot_number} cho {round_name}: {changed}/{len(candidate_ids)} thí sinh được cập nhật.'
    append_audit(f'session-{session.id}', audit_content, request)
    append_competition_scope_audit(session, audit_content, request)
    candidates = Candidate.objects.filter(id__in=candidate_ids).order_by('sort_key', 'code')
    return Response({
        'sessionId': session.id,
        'roundId': str(round_id),
        'occurrenceId': occurrence_id,
        'roundName': round_name,
        'slotIndex': slot_number - 1,
        'candidateCount': len(candidate_ids),
        'updatedCount': changed,
        'updatedCandidates': [serialize_candidate(candidate, include_private=True) for candidate in candidates],
    })


@api_view(['PUT', 'DELETE'])
@permission_classes([IsManagerOrAdmin])
def candidate_detail(request, pk):
    try:
        cand = Candidate.objects.get(code=pk)
    except Candidate.DoesNotExist:
        try:
            cand = Candidate.objects.get(id=pk)
        except Candidate.DoesNotExist:
            return Response({'error': 'Không tìm thấy thí sinh.'}, status=status.HTTP_404_NOT_FOUND)
            
    if request.method == 'PUT':
        before = {'name': cand.name, 'school': cand.school, 'className': cand.class_name, 'city': cand.city, 'ward': cand.ward, 'nationality': cand.nationality, 'grade': cand.grade, 'contests': cand.contests, 'achievement': cand.achievement, 'highestRound': cand.highest_round, 'email': cand.email, 'parent': cand.parent, 'phone': cand.phone, 'identity': cand.identity, 'address': cand.address, 'birthDate': cand.birth_date, 'sessionIds': ', '.join(sorted(cand.session_ids or []))}
        data = request.data or {}
        
        fields = ['name', 'school', 'className', 'city', 'ward', 'nationality', 'grade', 'contests', 'achievement', 'highestRound', 'email', 'parent', 'phone', 'identity', 'address', 'birthDate']
        for field in fields:
            if field in data:
                val = str(data[field]).strip()
                if field == 'name': cand.name = format_person_name(val)
                elif field == 'school': cand.school = val
                elif field == 'className': cand.class_name = val
                elif field == 'city': cand.city = val
                elif field == 'ward': cand.ward = val
                elif field == 'nationality': cand.nationality = val
                elif field == 'grade': cand.grade = val
                elif field == 'contests': cand.contests = val
                elif field == 'achievement': cand.achievement = val
                elif field == 'highestRound': cand.highest_round = val
                elif field == 'email': cand.email = val
                elif field == 'parent': cand.parent = format_person_name(val)
                elif field == 'phone': cand.phone = val
                elif field == 'identity': cand.identity = val
                elif field == 'address': cand.address = val
                elif field == 'birthDate': cand.birth_date = val
                
        if 'contests' in data:
            cand.contests = merge_contest_codes(cand.contests)
            
        if 'sessionIds' in data and isinstance(data['sessionIds'], list):
            cand.session_ids = list(set([str(s_id).strip() for s_id in data['sessionIds'] if str(s_id).strip()]))
            
        cand.updated = timezone.now().strftime('%d/%m/%Y %H:%M')
        cand.sort_key = f"{cand.name.lower()}_{cand.identity or cand.id}"
        cand.save()
        
        sync_session_candidate_totals()
        cand.refresh_from_db()
        after = {'name': cand.name, 'school': cand.school, 'className': cand.class_name, 'city': cand.city, 'ward': cand.ward, 'nationality': cand.nationality, 'grade': cand.grade, 'contests': cand.contests, 'achievement': cand.achievement, 'highestRound': cand.highest_round, 'email': cand.email, 'parent': cand.parent, 'phone': cand.phone, 'identity': cand.identity, 'address': cand.address, 'birthDate': cand.birth_date, 'sessionIds': ', '.join(sorted(cand.session_ids or []))}
        labels = {'name':'Họ và tên', 'school':'Trường học', 'className':'Lớp đang học', 'city':'Tỉnh/Thành phố cư trú', 'ward':'Phường/Xã', 'nationality':'Quốc tịch', 'grade':'Khối lớp', 'contests':'Cuộc thi', 'achievement':'Thành tích cao nhất', 'highestRound':'Vòng cao nhất', 'email':'Email', 'parent':'Phụ huynh', 'phone':'Điện thoại', 'identity':'CCCD/Hộ chiếu', 'address':'Địa chỉ', 'birthDate':'Ngày sinh', 'sessionIds':'Các kỳ tổ chức'}
        change_text = audit_values(before, after, labels)
        append_audit(f'candidate-{cand.code}', 'Cập nhật hồ sơ thí sinh: ' + (change_text or 'Không có thay đổi dữ liệu.'), request)
        affected_session_ids = {value for value in (before.get('sessionIds') or '').split(', ') if value} | set(cand.session_ids or []) | set(CandidateParticipation.objects.filter(candidate=cand).values_list('session_id', flat=True))
        for session_id in affected_session_ids:
            append_audit(f'session-{session_id}', f'Cập nhật hồ sơ thí sinh {cand.code} ({cand.name}): ' + (change_text or 'Không có thay đổi dữ liệu.'), request)
            append_competition_scope_audit(session_id, f'Cập nhật hồ sơ thí sinh {cand.code} ({cand.name}): ' + (change_text or 'Không có thay đổi dữ liệu.'), request)
        return Response(serialize_candidate(cand))
        
    elif request.method == 'DELETE':
        if getattr(request, 'user_role', 'EMPLOYEE') != 'ADMIN':
            return Response({'error': 'Quyền admin là bắt buộc để xóa.'}, status=status.HTTP_403_FORBIDDEN)
            
        affected_session_ids = set(cand.session_ids or []) | set(CandidateParticipation.objects.filter(candidate=cand).values_list('session_id', flat=True))
        for session_id in affected_session_ids:
            append_audit(f'session-{session_id}', f'Xóa thí sinh {cand.code} ({cand.name}) khỏi kỳ tổ chức.', request)
            append_competition_scope_audit(session_id, f'Xóa thí sinh {cand.code} ({cand.name}) khỏi kỳ tổ chức.', request)
        append_audit(f'candidate-{cand.code}', f'Xóa hồ sơ thí sinh {cand.code} ({cand.name}).', request)
        cand.delete()
        sync_session_candidate_totals()
        return Response({'success': True})

@api_view(['PUT', 'DELETE'])
@permission_classes([IsManagerOrAdmin])
def round_result_detail(request, pk):
    try:
        item = RoundResult.objects.select_related('participation__candidate', 'participation__session', 'exam_room').get(id=pk)
    except RoundResult.DoesNotExist:
        return Response({'error': 'Không tìm thấy dữ liệu vòng thi.'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'DELETE':
        candidate = item.participation.candidate
        round_name = item.round_name
        session_id_for_log = item.participation.session_id
        if request.query_params.get('removeFromSession') == '1':
            session_id = item.participation.session_id
            all_sessions = list(ExamSession.objects.all())
            existing_ids = list(candidate.session_ids or [])
            remaining_ids = [value for value in existing_ids if value != session_id]
            if not existing_ids:
                existing_codes = get_contest_codes(candidate.contests)
                remaining_ids = [session.id for session in all_sessions if session.id != session_id and session.code.upper() in existing_codes]
            candidate.session_ids = remaining_ids
            removed_session = next((session for session in all_sessions if session.id == session_id), None)
            remaining_codes = {session.code.upper() for session in all_sessions if session.id in remaining_ids}
            if removed_session and removed_session.code.upper() not in remaining_codes:
                candidate.contests = ', '.join(code for code in get_contest_codes(candidate.contests) if code.upper() != removed_session.code.upper())
            CandidateParticipation.objects.filter(candidate=candidate, session_id=session_id).delete()
        else:
            item.delete()
        candidate.updated = timezone.now().strftime('%d/%m/%Y %H:%M')
        candidate.save()
        action = f'Gỡ thí sinh {candidate.code} ({candidate.name}) khỏi toàn bộ kỳ tổ chức.' if request.query_params.get('removeFromSession') == '1' else f'Gỡ thí sinh {candidate.code} ({candidate.name}) khỏi {round_name}.'
        append_audit(f'candidate-{candidate.code}', action, request)
        append_audit(f'session-{session_id_for_log}', action, request)
        append_competition_scope_audit(session_id_for_log, action, request)
        sync_session_candidate_totals()
        return Response({'candidate': serialize_candidate(candidate)})
    data = request.data or {}
    before_round = {'occurrenceId': item.occurrence_id, 'roomName': item.room_name, 'eligibility': item.eligibility, 'sbd': item.sbd, 'date': item.exam_date, 'time': item.time_slot, 'mode': item.mode, 'location': item.location, 'link': item.link, 'account': item.account, 'password': item.password, 'attendance': item.attendance, 'score': item.score, 'scoreRate': item.score_rate, 'rank': item.rank, 'result': item.result, 'note': item.note, 'registration': json.dumps(item.participation.registration_data or {}, ensure_ascii=False)}
    fields = {
        'eligibility': 'eligibility', 'sbd': 'sbd', 'date': 'exam_date', 'time': 'time_slot',
        'mode': 'mode', 'location': 'location', 'link': 'link', 'account': 'account', 'password': 'password',
        'attendance': 'attendance', 'score': 'score', 'scoreRate': 'score_rate',
        'rank': 'rank', 'result': 'result', 'note': 'note',
    }
    for payload_field, model_field in fields.items():
        if payload_field in data:
            value = str(data[payload_field] or '').strip()
            if payload_field == 'scoreRate':
                value = format_sheet_percentage(value)
            setattr(item, model_field, normalize_eligibility(value) if payload_field == 'eligibility' else value)
    requested_round_id = str(data.get('roundId') or item.round_id or '').strip()
    requested_occurrence_id = str(data.get('occurrenceId') or item.occurrence_id or '').strip()
    round_config = _session_round_config(item.participation.session, requested_round_id)
    if requested_occurrence_id:
        valid_occurrences = {str(slot.get('id') or '').strip() for slot in ((round_config or {}).get('slots') or []) if isinstance(slot, dict)}
        if valid_occurrences and requested_occurrence_id not in valid_occurrences:
            return Response({'error': 'Đợt tổ chức không thuộc vòng thi đã chọn.'}, status=status.HTTP_400_BAD_REQUEST)
        item.occurrence_id = requested_occurrence_id
    if 'roomId' in data:
        requested_room_id = str(data.get('roomId') or '').strip()
        previous_room = item.exam_room
        if requested_room_id:
            room = ExamRoom.objects.filter(id=requested_room_id, session=item.participation.session).first()
            if not room:
                return Response({'error': 'Không tìm thấy phòng thi đã chọn.'}, status=status.HTTP_404_NOT_FOUND)
            if requested_round_id and room.round_id != requested_round_id:
                return Response({'error': 'Phòng thi không thuộc vòng đang chọn.'}, status=status.HTTP_400_BAD_REQUEST)
            if requested_occurrence_id and room.occurrence_id != requested_occurrence_id:
                return Response({'error': 'Phòng thi không thuộc đợt tổ chức đang chọn.'}, status=status.HTTP_400_BAD_REQUEST)
            item.exam_room = room
            item.round_id = room.round_id
            item.occurrence_id = room.occurrence_id
            item.room_name = room.label
            item.mode = 'Trực tiếp' if room.mode == ExamRoom.MODE_IN_PERSON else 'Trực tuyến'
            item.location = f'{room.label}:\n{room.link}' if room.mode == ExamRoom.MODE_ONLINE else ' · '.join(value for value in [room.label, room.location] if value)
            if room.exam_link:
                item.link = room.exam_link
            elif previous_room and previous_room.exam_link and item.link == previous_room.exam_link:
                item.link = ''
        else:
            item.exam_room = None
            item.room_name = ''
            item.location = ''
            if previous_room and previous_room.exam_link and item.link == previous_room.exam_link:
                item.link = ''

    if 'slotId' in data:
        round_config = _session_round_config(item.participation.session, requested_round_id)
        if not round_config:
            return Response({'error': 'Không tìm thấy vòng thi để đổi ca.'}, status=status.HTTP_404_NOT_FOUND)
        requested_slot_id = str(data.get('slotId') or '').strip()
        slot = next((value for value in (round_config.get('slots') or []) if isinstance(value, dict) and str(value.get('id') or '') == requested_slot_id), None)
        if not slot:
            return Response({'error': 'Không tìm thấy lịch/ca thi đã chọn.'}, status=status.HTTP_404_NOT_FOUND)
        for slot_field, model_field in (('date', 'exam_date'), ('time', 'time_slot'), ('mode', 'mode')):
            value = str(slot.get(slot_field) or '').strip()
            if value:
                setattr(item, model_field, value)
        slot_link = str(slot.get('link') or '').strip()
        if slot_link:
            item.link = slot_link
        item.round_id = requested_round_id
        item.occurrence_id = requested_slot_id
    registration = data.get('registration') if isinstance(data.get('registration'), dict) else {}
    registration_fields = {
        'subject': 'subject', 'category': 'category', 'registrationMethod': 'registration_method',
        'registrationUnit': 'registration_unit', 'teamName': 'team_name', 'examLanguage': 'exam_language',
        'generalNote': 'general_note', 'certificateLink': 'certificate_link',
    }
    participation_updates = []
    for payload_field, model_field in registration_fields.items():
        if payload_field in registration:
            setattr(item.participation, model_field, str(registration[payload_field] or '').strip())
            participation_updates.append(model_field)
    if registration:
        item.participation.registration_data = {str(key): value for key, value in registration.items() if value not in (None, '')}
        participation_updates.append('registration_data')
    item.save()
    if participation_updates:
        item.participation.save(update_fields=list(set(participation_updates)) + ['updated_at'])
    candidate = item.participation.candidate
    candidate.updated = timezone.now().strftime('%d/%m/%Y %H:%M')
    candidate.save(update_fields=['updated'])
    after_round = {'roomName': item.room_name, 'eligibility': item.eligibility, 'sbd': item.sbd, 'date': item.exam_date, 'time': item.time_slot, 'mode': item.mode, 'location': item.location, 'link': item.link, 'account': item.account, 'password': item.password, 'attendance': item.attendance, 'score': item.score, 'scoreRate': item.score_rate, 'rank': item.rank, 'result': item.result, 'note': item.note, 'registration': json.dumps(item.participation.registration_data or {}, ensure_ascii=False)}
    round_labels = {'roomName':'Phòng thi', 'eligibility':'Điều kiện', 'sbd':'Số báo danh', 'date':'Ngày thi', 'time':'Giờ/ca thi', 'mode':'Hình thức', 'location':'Địa điểm', 'link':'Link dự thi (Nếu có)', 'account':'Tài khoản', 'password':'Mật khẩu', 'attendance':'Trạng thái dự thi', 'score':'Điểm', 'scoreRate':'Tỷ lệ điểm', 'rank':'Xếp hạng', 'result':'Kết quả', 'note':'Ghi chú', 'registration':'Thông tin đăng ký'}
    change_text = audit_values(before_round, after_round, round_labels)
    audit_content = f'Cập nhật {item.round_name} cho {candidate.code} ({candidate.name}): ' + (change_text or 'Không có thay đổi dữ liệu.')
    append_audit(f'candidate-{candidate.code}', audit_content, request)
    append_audit(f'session-{item.participation.session_id}', audit_content, request)
    append_competition_scope_audit(item.participation.session_id, audit_content, request)
    return Response({'candidate': serialize_candidate(candidate)})

@api_view(['DELETE'])
@permission_classes([IsAdmin])
def candidate_remove_from_session(request, pk, session_id):
    try:
        cand = Candidate.objects.get(code=pk)
    except Candidate.DoesNotExist:
        try:
            cand = Candidate.objects.get(id=pk)
        except Candidate.DoesNotExist:
            return Response({'error': 'Không tìm thấy thí sinh.'}, status=status.HTTP_404_NOT_FOUND)
            
    all_sessions = list(ExamSession.objects.all())
    derived = list(cand.session_ids) if cand.session_ids else []
    if not cand.session_ids:
        # derive sessions from contests code
        sess_codes = get_contest_codes(cand.contests)
        derived = [s.id for s in all_sessions if s.code.upper() in sess_codes]
        
    cand.session_ids = [s_id for s_id in derived if s_id != session_id]
    CandidateParticipation.objects.filter(candidate=cand, session_id=session_id).delete()
    cand.updated = timezone.now().strftime('%d/%m/%Y %H:%M')
    cand.save()
    action = f'Gỡ thí sinh {cand.code} ({cand.name}) khỏi kỳ tổ chức.'
    append_audit(f'candidate-{cand.code}', action, request)
    append_audit(f'session-{session_id}', action, request)
    append_competition_scope_audit(session_id, action, request)
    
    sync_session_candidate_totals()
    return Response(serialize_candidate(cand))

@api_view(['GET', 'PUT'])
@permission_classes([IsAuthenticated])
def sheet_publication_config(request):
    requested_year = str((request.query_params.get('academicYear') if request.method == 'GET' else (request.data or {}).get('academicYear')) or '').strip()
    academic_year = requested_year if re.fullmatch(r'\d{4}-\d{4}', requested_year) else academic_year_for_date(timezone.localdate())
    publication, _ = ExaminationSheetPublication.objects.get_or_create(academic_year=academic_year)
    if request.method == 'GET':
        payload = publication_payload(publication)
        payload['availableAcademicYears'] = list(ExaminationSheetPublication.objects.exclude(academic_year='').order_by('-academic_year').values_list('academic_year', flat=True))
        return Response(payload)
    if getattr(request, 'user_role', getattr(request.user, 'role', '')) not in {'ADMIN', 'MANAGER'}:
        return Response({'error': 'Ban khong co quyen cau hinh Google Sheet xuat ban.'}, status=status.HTTP_403_FORBIDDEN)
    data = request.data or {}
    if 'spreadsheetUrl' in data:
        publication.spreadsheet_url = str(data.get('spreadsheetUrl') or '').strip()
    if 'enabled' in data:
        publication.enabled = bool(data.get('enabled'))
    publication.save(update_fields=['spreadsheet_url', 'enabled', 'updated_at'])
    append_audit('sheet-publication', f'Cap nhat cau hinh Google Sheet xuat ban nam hoc {academic_year}.', request)
    return Response(publication_payload(publication))


@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def sheet_publication_sync(request):
    data = request.data or {}
    requested_year = str(data.get('academicYear') or '').strip()
    academic_year = requested_year if re.fullmatch(r'\d{4}-\d{4}', requested_year) else academic_year_for_date(timezone.localdate())
    publication, _ = ExaminationSheetPublication.objects.get_or_create(academic_year=academic_year)
    if not publication.enabled:
        return Response({'error': 'Kenh xuat ban Google Sheet dang tam tat.'}, status=status.HTTP_400_BAD_REQUEST)
    scope = str(data.get('scope') or 'all').strip()
    session_ids = data.get('sessionIds') if isinstance(data.get('sessionIds'), list) else []
    try:
        result = sync_publication(
            publication, persisted_partners(),
            session_ids=session_ids if scope == 'sessions' else None,
            include_summary=scope == 'all',
            include_partners=scope in {'all', 'partners'},
        )
    except Exception as exc:
        publication.last_status = 'failed'
        publication.last_error = str(exc)
        publication.save(update_fields=['last_status', 'last_error', 'updated_at'])
        return Response({'error': str(exc), 'publication': publication_payload(publication)}, status=status.HTTP_400_BAD_REQUEST)
    append_audit('sheet-publication', f'Dong bo Google Sheet nam hoc {academic_year}: {result["sessions"]} ky to chuc, {result["partners"]} doi tac.', request)
    return Response({'success': True, 'result': result, 'publication': publication_payload(publication)})

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def sheets_list(request):
    if request.method == 'GET':
        sheets = ExaminationSheet.objects.all().order_by('-created_at')
        result = [serialize_examination_sheet(sheet) for sheet in sheets]
            
        if not result:
            return Response([])

        return Response(result)
        
    elif request.method == 'POST':
        if getattr(request, 'user_role', 'EMPLOYEE') not in ['ADMIN', 'MANAGER']:
            return Response({"error": "Quyền quản trị viên hoặc quản lý là bắt buộc."}, status=status.HTTP_403_FORBIDDEN)
            
        data = request.data or {}
        name = data.get('name', '').strip()
        url = data.get('url', '').strip()
        session_id = str(data.get('sessionId') or '').strip()
        stage = str(data.get('stage') or '').strip()
        
        if not name or not url:
            return Response({'error': 'Tên nguồn và đường dẫn Google Sheets là bắt buộc.'}, status=status.HTTP_400_BAD_REQUEST)
            
        if not session_id or not ExamSession.objects.filter(id=session_id).exists():
            return Response({'error': 'Mỗi tab nguồn phải được gắn với một kỳ tổ chức hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

        if stage not in {'registration-source', 'session-output'}:
            return Response({'error': 'Chọn Sheet đầu vào hoặc Sheet tổng hợp.'}, status=status.HTTP_400_BAD_REQUEST)

        if ExaminationSheet.objects.filter(session_id=session_id, stage=stage).exists():
            label = 'Sheet tổng hợp' if stage == 'session-output' else 'Sheet đầu vào'
            return Response(
                {'error': f'Kỳ tổ chức này đã có {label}. Hãy chỉnh sửa liên kết hiện tại.'},
                status=status.HTTP_409_CONFLICT,
            )

        try:
            automation_start = parse_optional_date(data.get('automationStartDate'), 'Ngày bắt đầu tự động')
            automation_end = parse_optional_date(data.get('automationEndDate'), 'Ngày kết thúc tự động')
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if automation_start and automation_end and automation_start > automation_end:
            return Response({'error': 'Ngày kết thúc tự động phải từ ngày bắt đầu trở đi.'}, status=status.HTTP_400_BAD_REQUEST)

        sheet = ExaminationSheet.objects.create(
            id=f"sheet-{uuid.uuid4().hex[:10]}",
            name=name,
            url=url,
            status='idle',
            session_id=session_id,
            sheet_tab=data.get('sheetTab', '').strip(),
            stage=stage,
            automation_enabled=bool(data.get('automationEnabled', False)),
            automation_start_date=automation_start,
            automation_end_date=automation_end,
            created_at=timezone.now(),
            updated_at=timezone.now(),
            created_by=request.user.email if hasattr(request.user, 'email') else None
        )
        sheet_content = f'Tạo nguồn Google Sheet {sheet.name} cho kỳ tổ chức {sheet.session_id}.'
        append_audit(f'session-{sheet.session_id}', sheet_content, request)
        append_competition_scope_audit(sheet.session_id, sheet_content, request)
        return Response(serialize_examination_sheet(sheet), status=status.HTTP_201_CREATED)

@api_view(['PUT', 'DELETE'])
@permission_classes([IsManagerOrAdmin])
def sheet_detail(request, pk):
    try:
        sheet = ExaminationSheet.objects.get(id=pk)
    except ExaminationSheet.DoesNotExist:
        return Response({'error': 'Không tìm thấy nguồn sheets.'}, status=status.HTTP_404_NOT_FOUND)
        
    if request.method == 'PUT':
        before = {'name': sheet.name, 'url': sheet.url, 'sessionId': sheet.session_id, 'sheetTab': sheet.sheet_tab, 'stage': sheet.stage, 'automationEnabled': sheet.automation_enabled, 'automationStartDate': str(sheet.automation_start_date or ''), 'automationEndDate': str(sheet.automation_end_date or '')}
        data = request.data or {}
        if 'name' in data and data['name'].strip():
            sheet.name = data['name'].strip()
        if 'url' in data and data['url'].strip():
            sheet.url = data['url'].strip()
        if 'sessionId' in data:
            requested_session_id = str(data.get('sessionId') or '').strip()
            if not requested_session_id or not ExamSession.objects.filter(id=requested_session_id).exists():
                return Response({'error': 'Mỗi tab nguồn phải được gắn với một kỳ tổ chức hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
            sheet.session_id = requested_session_id
        if 'sheetTab' in data:
            sheet.sheet_tab = str(data.get('sheetTab') or '').strip()
        if 'stage' in data:
            requested_stage = str(data.get('stage') or '').strip()
            if requested_stage not in {'registration-source', 'session-output'}:
                return Response({'error': 'Chọn Sheet đầu vào hoặc Sheet tổng hợp.'}, status=status.HTTP_400_BAD_REQUEST)
            sheet.stage = requested_stage
        if 'automationEnabled' in data:
            sheet.automation_enabled = bool(data.get('automationEnabled'))
        try:
            if 'automationStartDate' in data:
                sheet.automation_start_date = parse_optional_date(data.get('automationStartDate'), 'Ngày bắt đầu tự động')
            if 'automationEndDate' in data:
                sheet.automation_end_date = parse_optional_date(data.get('automationEndDate'), 'Ngày kết thúc tự động')
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if sheet.automation_start_date and sheet.automation_end_date and sheet.automation_start_date > sheet.automation_end_date:
            return Response({'error': 'Ngày kết thúc tự động phải từ ngày bắt đầu trở đi.'}, status=status.HTTP_400_BAD_REQUEST)

        if ExaminationSheet.objects.filter(session_id=sheet.session_id, stage=sheet.stage).exclude(id=sheet.id).exists():
            label = 'Sheet tổng hợp' if sheet.stage == 'session-output' else 'Sheet đầu vào'
            return Response(
                {'error': f'Kỳ tổ chức này đã có {label}. Hãy chỉnh sửa liên kết hiện tại.'},
                status=status.HTTP_409_CONFLICT,
            )
            
        if (sheet.url, sheet.sheet_tab) != (before['url'], before['sheetTab']):
            sheet.last_observed_fingerprint = ''
            sheet.pending_manual_import = False
            sheet.change_detected_at = None
        sheet.updated_at = timezone.now()
        sheet.save()
        after = {'name': sheet.name, 'url': sheet.url, 'sessionId': sheet.session_id, 'sheetTab': sheet.sheet_tab, 'stage': sheet.stage, 'automationEnabled': sheet.automation_enabled, 'automationStartDate': str(sheet.automation_start_date or ''), 'automationEndDate': str(sheet.automation_end_date or '')}
        sheet_changes = audit_values(before, after, {'name':'Tên nguồn Google Sheet', 'url':'Đường dẫn Google Sheet', 'sessionId':'Kỳ tổ chức', 'sheetTab':'Tên tab', 'stage':'Loại Sheet', 'automationEnabled':'Tự động', 'automationStartDate':'Ngày bắt đầu tự động', 'automationEndDate':'Ngày kết thúc tự động'})
        if sheet_changes:
            sheet_content = 'Cập nhật nguồn Google Sheet: ' + sheet_changes
            append_audit(f'session-{sheet.session_id}', sheet_content, request)
            append_competition_scope_audit(sheet.session_id, sheet_content, request)
            if before.get('sessionId') and before.get('sessionId') != sheet.session_id:
                moved_content = f'Nguồn Google Sheet {sheet.name} đã được chuyển sang kỳ tổ chức {sheet.session_id}.'
                append_audit(f"session-{before['sessionId']}", moved_content, request)
                append_competition_scope_audit(before['sessionId'], moved_content, request)
        return Response(serialize_examination_sheet(sheet))
        
    elif request.method == 'DELETE':
        if getattr(request, 'user_role', 'EMPLOYEE') != 'ADMIN':
            return Response({'error': 'Quyền admin là bắt buộc để xóa.'}, status=status.HTTP_403_FORBIDDEN)
        sheet_content = f'Xóa nguồn Google Sheet {sheet.name}.'
        append_audit(f'session-{sheet.session_id}', sheet_content, request)
        append_competition_scope_audit(sheet.session_id, sheet_content, request)
        sheet.delete()
        return Response({'success': True})

@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def sheet_export(request, pk):
    try:
        sheet = ExaminationSheet.objects.get(id=pk)
    except ExaminationSheet.DoesNotExist:
        return Response({'error': 'Không tìm thấy nguồn dữ liệu.'}, status=status.HTTP_404_NOT_FOUND)
    if not sheet.session_id:
        return Response({'error': 'Nguồn dữ liệu chưa được gắn với kỳ tổ chức.'}, status=status.HTTP_400_BAD_REQUEST)
    if sheet.stage != 'session-output':
        return Response({'error': 'Sheet đầu vào chỉ dùng để nhập dữ liệu.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        preview = output_sheet_export_preview(sheet, getattr(request, 'google_access_token', None))
    except Exception as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    export_mode = str((request.data or {}).get('exportMode') or 'merge').strip()
    if export_mode not in {'merge', 'append-only'}:
        return Response({'error': 'Chế độ xuất dữ liệu không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
    # Only web-only candidates require a choice. Extra rows already in Sheet
    # follow the normal overwrite export flow.
    roster_mismatch = bool(preview.get('appendedRows'))
    selected_append_codes = (request.data or {}).get('appendCandidateCodes')
    if selected_append_codes is not None and (not isinstance(selected_append_codes, list) or len(selected_append_codes) > 1000):
        return Response({'error': 'Danh sách thí sinh cần thêm không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
    confirm_overwrite = bool((request.data or {}).get('confirmOverwrite'))
    preview_fingerprint = str((request.data or {}).get('currentFingerprint') or '')
    if roster_mismatch and (not confirm_overwrite or preview_fingerprint != preview['currentFingerprint']):
        return Response({
            'error': 'Số lượng thí sinh giữa hệ thống và Sheet đang lệch. Hãy chọn cách xử lý sau khi xem danh sách.',
            'requiresConfirmation': True,
            'requiresRosterReview': True,
            'preview': preview,
        }, status=status.HTTP_409_CONFLICT)
    needs_confirmation = preview['hasExistingData'] and preview.get('hasReviewChanges', preview['hasChanges'])
    if needs_confirmation and (not confirm_overwrite or preview_fingerprint != preview['currentFingerprint']):
        return Response({
            'error': 'Sheet đích có dữ liệu khác với dữ liệu chuẩn bị xuất. Hãy kiểm tra thay đổi và xác nhận trước khi ghi đè.',
            'requiresConfirmation': True,
            'preview': preview,
        }, status=status.HTTP_409_CONFLICT)

    if not preview['hasChanges']:
        sheet.status = 'success'
        sheet.pending_manual_import = False
        sheet.last_error = ''
        sheet.updated_at = timezone.now()
        sheet.save(update_fields=['status', 'pending_manual_import', 'last_error', 'updated_at'])
        return Response({'success': True, 'unchanged': True, 'message': 'Dữ liệu trên Sheet đã khớp với hệ thống; không có gì cần ghi đè.', 'preview': preview})

    sheet.status = 'running'
    sheet.updated_at = timezone.now()
    sheet.save(update_fields=['status', 'updated_at'])
    try:
        result = export_session_to_google_sheet(sheet, getattr(request, 'google_access_token', None), export_mode=export_mode, append_candidate_codes=selected_append_codes)
    except Exception as exc:
        sheet.status = 'failed'
        sheet.last_error = str(exc)
        sheet.updated_at = timezone.now()
        sheet.save(update_fields=['status', 'last_error', 'updated_at'])
        failure_content = f'Xuất dữ liệu sang Google Sheet {sheet.name} thất bại: {exc}.'
        append_audit(f'session-{sheet.session_id}', failure_content, request, system=True)
        append_competition_scope_audit(sheet.session_id, failure_content, request, system=True)
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    sheet.status = 'success'
    sheet.last_export_at = timezone.now()
    sheet.last_content_fingerprint = str(result.get('fingerprint') or '')
    sheet.pending_manual_import = False
    sheet.last_observed_fingerprint = ''
    sheet.change_detected_at = None
    sheet.last_error = ''
    sheet.updated_at = timezone.now()
    sheet.save(update_fields=['status', 'last_export_at', 'last_content_fingerprint', 'last_observed_fingerprint', 'change_detected_at', 'pending_manual_import', 'last_error', 'updated_at'])
    export_content = f'Xuất dữ liệu sang Google Sheet {sheet.name} thành công.'
    append_audit(f'session-{sheet.session_id}', export_content, request, system=True)
    append_competition_scope_audit(sheet.session_id, export_content, request, system=True)
    return Response({**result, 'preview': preview})

@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def sheets_sync(request):
    data = request.data or {}
    url = data.get('url', '').strip()
    sheet_id = data.get('id')
    sheet_tab = str(data.get('sheetTab') or '').strip()
    
    target_url = url or None
    session_id = str(data.get('sessionId') or '').strip() or None
    if sheet_id:
        try:
            sheet = ExaminationSheet.objects.get(id=sheet_id)
            if sheet.stage != 'registration-source':
                return Response(
                    {'error': 'Sheet tổng hợp chỉ được nhập qua bước xem trước và xác nhận thủ công.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            target_url = sheet.url
            session_id = sheet.session_id or session_id
            sheet_tab = sheet.sheet_tab or sheet_tab
        except ExaminationSheet.DoesNotExist:
            return Response({'error': 'Không tìm thấy nguồn dữ liệu.'}, status=status.HTTP_404_NOT_FOUND)

    if target_url and not session_id:
        return Response({'error': 'Nguồn dữ liệu chưa được gắn với kỳ tổ chức.'}, status=status.HTTP_400_BAD_REQUEST)
            
    result = sync_examination_from_google_sheet(target_url, session_id, sheet_id, sheet_tab)
    if not result['success']:
        return Response({'error': result['message']}, status=status.HTTP_400_BAD_REQUEST)
    sync_content = f"Đồng bộ dữ liệu từ Google Sheet: {result.get('message') or result.get('status') or 'đã hoàn tất'}."
    if session_id:
        append_audit(f'session-{session_id}', sync_content, request, system=True)
        append_competition_scope_audit(session_id, sync_content, request, system=True)
    return Response(result)


@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def sheet_import_preview(request):
    """Read and analyse a Google Sheet without changing examination data."""
    data = request.data or {}
    sheet_id = str(data.get('id') or '').strip()
    source_url = str(data.get('url') or '').strip()
    session_id = str(data.get('sessionId') or '').strip()
    sheet_tab = str(data.get('sheetTab') or '').strip()
    update_mode = str(data.get('updateMode') or 'replace-nonempty').strip()
    import_empty_values = bool(data.get('importEmptyValues', True))
    if update_mode not in {'fill-empty', 'replace-nonempty'}:
        return Response({'error': 'Chính sách cập nhật dữ liệu không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
    source_name = 'Google Sheets'
    source_stage = ''

    if sheet_id:
        try:
            sheet = ExaminationSheet.objects.get(id=sheet_id)
        except ExaminationSheet.DoesNotExist:
            return Response({'error': 'Không tìm thấy nguồn dữ liệu.'}, status=status.HTTP_404_NOT_FOUND)
        source_url = sheet.url
        session_id = sheet.session_id or session_id
        sheet_tab = sheet.sheet_tab or sheet_tab
        source_name = sheet.name
        source_stage = sheet.stage

    if not source_url:
        return Response({'error': 'Hãy nhập liên kết Google Sheets.'}, status=status.HTTP_400_BAD_REQUEST)
    if not session_id:
        return Response({'error': 'Hãy chọn kỳ tổ chức nhận dữ liệu.'}, status=status.HTTP_400_BAD_REQUEST)
    session = ExamSession.objects.filter(id=session_id).first()
    if not session:
        return Response({'error': 'Không tìm thấy kỳ tổ chức đã chọn.'}, status=status.HTTP_404_NOT_FOUND)

    timestamp = timezone.now().strftime('%d/%m/%Y %H:%M:%S')
    result = sync_single_sheet(
        source_url,
        timestamp,
        sheet_doc_id=None,
        session_id=session_id,
        preview=True,
        sheet_tab=sheet_tab,
        preview_update_mode=update_mode,
        preview_import_empty_values=import_empty_values,
    )
    if not result.get('success'):
        return Response({'error': result.get('message') or 'Không thể đọc Google Sheets.'}, status=status.HTTP_400_BAD_REQUEST)
    result['source']['name'] = source_name
    result['source']['id'] = sheet_id
    result['source']['stage'] = source_stage
    if source_stage == 'session-output':
        try:
            result['source']['fingerprint'] = remote_sheet_fingerprint(sheet, getattr(request, 'google_access_token', None))
        except Exception as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    result['targetSession'] = {
        'id': session.id,
        'code': session.code,
        'name': session.name,
        'time': session.time,
    }
    return Response(result)

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def sync_status(request):
    config = SystemConfig.objects.filter(key='examination_sync_state').first()
    return Response(config.data if config and config.data else {'status': 'idle'})

def duplicate_candidate_summary(candidate):
    sessions = list(ExamSession.objects.filter(id__in=list(candidate.session_ids or [])).values('id', 'code', 'name'))
    return {
        'code': candidate.code,
        'name': candidate.name,
        'birthDate': candidate.birth_date or '',
        'identity': candidate.identity or '',
        'email': candidate.email or '',
        'phone': candidate.phone or '',
        'school': candidate.school or '',
        'className': candidate.class_name or '',
        'city': candidate.city or '',
        'ward': candidate.ward or '',
        'address': candidate.address or '',
        'sessions': sessions,
    }

@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def import_candidate_duplicates(request):
    """Preview safe identity matches before a spreadsheet is committed."""
    records = (request.data or {}).get('records', [])
    if not isinstance(records, list):
        return Response({'error': 'Danh sách hồ sơ không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
    if len(records) > 1000:
        return Response({'error': 'Mỗi lần chỉ được kiểm tra tối đa 1.000 hồ sơ.'}, status=status.HTTP_400_BAD_REQUEST)

    existing = list(Candidate.objects.all())
    duplicates = []
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            continue
        name = format_person_name(record.get('name', ''))
        if not name:
            continue
        raw_code = str(record.get('code') or '').replace('/', '-').replace('?', '-').replace('#', '-').strip().upper()
        supplied_code = '' if raw_code in {'', '-', '—', 'N/A', 'NA'} else raw_code
        incoming = {
            'name': name,
            'birth_date': parse_dob(record.get('birthDate', '')),
            'identity': str(record.get('identity') or '').strip(),
            'email': str(record.get('email') or '').strip(),
            'phone': str(record.get('phone') or '').strip(),
            'school': str(record.get('school') or '').strip(),
            'class_name': str(record.get('className') or '').strip(),
            'city': str(record.get('city') or '').strip(),
            'ward': str(record.get('ward') or '').strip(),
            'address': str(record.get('address') or '').strip(),
        }
        matches = []
        for candidate in existing:
            assessment = candidate_match_assessment({
                'name': candidate.name, 'birth_date': candidate.birth_date, 'identity': candidate.identity,
                'email': candidate.email, 'phone': candidate.phone, 'school': candidate.school,
                'class_name': candidate.class_name,
                'city': candidate.city, 'ward': candidate.ward, 'address': candidate.address,
            }, incoming)
            if assessment:
                matches.append((candidate, assessment))
        if supplied_code:
            coded = next((candidate for candidate in existing if str(candidate.code or '').upper() == supplied_code), None)
            if coded and not any(candidate.id == coded.id for candidate, _ in matches):
                matches.append((coded, {'status': 'confirmed', 'reason': 'Mã hồ sơ'}))
        for matched, assessment in matches:
            duplicates.append({
                'row': index + 1,
                'importedName': name,
                'status': assessment['status'],
                'matchBy': assessment['reason'],
                'existing': duplicate_candidate_summary(matched),
            })
    return Response({'duplicates': duplicates})

@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def import_candidates(request):
    try:
        data = request.data or {}
        input_records = data.get('records', [])
        confirmed_matches = data.get('confirmedMatches', {})
        if not isinstance(confirmed_matches, dict):
            confirmed_matches = {}
        source = data.get('source', '')
        session_id = str(data.get('sessionId') or '').strip()
        source_sheet_id = str(data.get('sheetId') or '').strip()
        source_fingerprint = str(data.get('sourceFingerprint') or '').strip()
        remove_session_candidate_codes = data.get('removeSessionCandidateCodes') or []
        if not isinstance(remove_session_candidate_codes, list) or len(remove_session_candidate_codes) > 1000:
            return Response({'error': 'Danh sách thí sinh cần gỡ khỏi kỳ thi không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
        remove_session_candidate_codes = {str(code or '').strip().upper() for code in remove_session_candidate_codes if str(code or '').strip()}
        update_mode = str(data.get('updateMode') or 'replace-nonempty').strip()
        import_empty_values = bool(data.get('importEmptyValues', True))
        if update_mode not in {'add-only', 'fill-empty', 'replace-nonempty'}:
            return Response({'error': 'Chính sách cập nhật dữ liệu không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
        
        if not input_records:
            return Response({'error': 'Không có hồ sơ để nhập.'}, status=status.HTTP_400_BAD_REQUEST)

        ensure_examination_seed()
        if not session_id:
            return Response({'error': 'Chọn kỳ tổ chức trước khi nhập dữ liệu.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            target_session = ExamSession.objects.get(id=session_id)
        except ExamSession.DoesNotExist:
            return Response({'error': 'Không tìm thấy kỳ tổ chức đã chọn.'}, status=status.HTTP_404_NOT_FOUND)

        source_sheet = None
        if source_sheet_id:
            source_sheet = ExaminationSheet.objects.filter(id=source_sheet_id, session_id=session_id).first()
            if not source_sheet:
                return Response({'error': 'Nguồn Google Sheet không thuộc kỳ tổ chức đã chọn.'}, status=status.HTTP_400_BAD_REQUEST)
            if source_sheet.stage == 'session-output':
                if not source_fingerprint:
                    return Response(
                        {'error': 'Hãy xem trước lại Sheet tổng hợp trước khi nhập.'},
                        status=status.HTTP_409_CONFLICT,
                    )
                try:
                    current_fingerprint = remote_sheet_fingerprint(
                        source_sheet,
                        getattr(request, 'google_access_token', None),
                    )
                except Exception as exc:
                    return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
                if current_fingerprint != source_fingerprint:
                    return Response(
                        {'error': 'Sheet tổng hợp vừa có thay đổi. Hãy xem trước lại để nhập đúng bản mới nhất.'},
                        status=status.HTTP_409_CONFLICT,
                    )

        if len(input_records) > 1000:
            return Response({'error': 'Mỗi lần chỉ được nhập tối đa 1.000 hồ sơ.'}, status=status.HTTP_400_BAD_REQUEST)
        
        existing = list(Candidate.objects.all())
        existing_codes_set = {c.code for c in existing}
        
        created = 0
        updated = 0
        linked_existing = 0
        items_returned = []
        
        for idx, rec in enumerate(input_records):
            # Clean records
            raw_code = str(rec.get('code', '')).replace('/', '-').replace('?', '-').replace('#', '-').strip().upper()
            # Blank placeholders in a template are never stored as a profile
            # code. They receive the next FT-00001 style code below; a supplied
            # legacy code remains usable for re-import matching.
            rec_code = '' if raw_code in {'', '-', '—', 'N/A', 'NA'} else raw_code
            rec_name = format_person_name(rec.get('name', ''))
            if not rec_name:
                continue
                
            rec_cand = {
                'code': rec_code,
                'name': rec_name,
                'school': str(rec.get('school', '')).strip(),
                'class_name': str(rec.get('className', '')).strip(),
                'city': str(rec.get('city', '')).strip(),
                'ward': str(rec.get('ward', '')).strip(),
                'nationality': str(rec.get('nationality', '')).strip(),
                'grade': str(rec.get('grade', '')).strip(),
                'contests': merge_contest_codes(str(rec.get('contests', '')).strip(), target_session.code),
                'achievement': str(rec.get('achievement', '')).strip(),
                'highest_round': str(rec.get('highestRound', '')).strip(),
                'email': str(rec.get('email', '')).strip(),
                'parent': format_person_name(rec.get('parent', '')),
                'phone': str(rec.get('phone', '')).strip(),
                'identity': str(rec.get('identity', '')).strip(),
                'address': str(rec.get('address', '')).strip(),
                'birth_date': parse_dob(rec.get('birthDate', '')),
                'registration': {
                    'subject': str(rec.get('subject', '')).strip(),
                    'category': str(rec.get('category', '')).strip(),
                    'registrationMethod': str(rec.get('registrationMethod', '')).strip(),
                    'registrationUnit': str(rec.get('registrationUnit', '')).strip(),
                    'teamName': str(rec.get('teamName', '')).strip(),
                    'examLanguage': str(rec.get('examLanguage', '')).strip(),
                    'generalNote': str(rec.get('generalNote', '')).strip(),
                    'certificateLink': str(rec.get('certificateLink', '')).strip(),
                },

                'exam_history': rec.get('examHistory') or [],
            }
            
            # Automatically link only when the rules yield one unambiguous,
            # confirmed profile. Multiple matches stay separate for safety.
            assessments = []
            for e in existing:
                e_dict = {
                    'name': e.name,
                    'birth_date': e.birth_date,
                    'identity': e.identity,
                    'email': e.email,
                    'phone': e.phone,
                    'school': e.school,
                    'class_name': e.class_name,
                    'city': e.city,
                    'ward': e.ward,
                    'address': e.address,
                }
                assessment = candidate_match_assessment(e_dict, rec_cand)
                if assessment:
                    assessments.append((e, assessment))
            confirmed = [(candidate, assessment) for candidate, assessment in assessments if assessment['status'] == 'confirmed']
            matched, matched_assessment = confirmed[0] if len(confirmed) == 1 else (None, None)

            # A manager can explicitly confirm a row marked "Cần xác nhận" in
            # the preview. The server verifies that the requested profile was
            # actually one of those suspicious matches before linking it.
            forced_candidate = None
            forced_code = str(confirmed_matches.get(str(idx + 1), '') or '').strip().upper()
            if forced_code:
                possible = next(((candidate, assessment) for candidate, assessment in assessments if candidate.code.upper() == forced_code and assessment['status'] == 'possible'), None)
                if possible:
                    forced_candidate, matched_assessment = possible

            same_code_cand = next((e for e in existing if rec_code and e.code.upper() == rec_code), None)
            base = matched or same_code_cand or forced_candidate
            # Add-only leaves every existing profile and participation untouched.
            if update_mode == 'add-only' and base:
                continue
            code = base.code if base else (rec_code if (rec_code and rec_code not in existing_codes_set) else next_code(existing_codes_set))
            ts_vn = timezone.now().strftime('%d/%m/%Y %H:%M')
            
            if base:
                before_values = {
                    field: getattr(base, field)
                    for field in ('name', 'birth_date', 'identity', 'email', 'phone', 'school', 'class_name', 'city', 'ward', 'nationality', 'grade', 'address', 'achievement', 'highest_round', 'parent')
                }
                previous_session_ids = list(base.session_ids or [])
                already_in_target_session = session_id in previous_session_ids or CandidateParticipation.objects.filter(candidate=base, session_id=session_id).exists()
                should_write = lambda current, incoming: bool(incoming) and (
                    not str(current or '').strip() if update_mode == 'fill-empty'
                    else (import_empty_values or bool(str(current or '').strip()))
                )
                if should_write(base.name, rec_cand['name']): base.name = rec_cand['name']
                for model_field in ('school', 'class_name', 'city', 'ward', 'nationality', 'grade', 'achievement', 'highest_round', 'email', 'parent', 'phone', 'identity', 'address'):
                    incoming_value = rec_cand[model_field]
                    if should_write(getattr(base, model_field), incoming_value):
                        setattr(base, model_field, incoming_value)
                if rec_cand['birth_date'] and should_replace_birth_date(base.birth_date, rec_cand['birth_date']) and should_write(base.birth_date, rec_cand['birth_date']):
                    base.birth_date = rec_cand['birth_date']

                base.contests = merge_contest_codes(base.contests, rec_cand['contests'])
                if session_id:
                    s_ids = list(base.session_ids) if base.session_ids else []
                    if session_id not in s_ids:
                        s_ids.append(session_id)
                    base.session_ids = s_ids
                base.exam_history = merge_exam_history(base.exam_history, rec_cand['exam_history'], session_id, source, update_mode, import_empty_values)
                base.updated = ts_vn
                base.save()
                upsert_participation_history(base, session_id, rec_cand['exam_history'], source, rec_cand['registration'], update_mode, import_empty_values)

                after_values = {
                    field: getattr(base, field)
                    for field in ('name', 'birth_date', 'identity', 'email', 'phone', 'school', 'class_name', 'city', 'ward', 'nationality', 'grade', 'address', 'achievement', 'highest_round', 'parent')
                }
                changes = audit_values(before_values, after_values, {
                    'name': 'họ tên', 'birth_date': 'ngày sinh', 'identity': 'CCCD/Hộ chiếu',
                    'email': 'email', 'phone': 'số điện thoại', 'school': 'trường', 'class_name': 'lớp',
                    'city': 'tỉnh/thành phố', 'ward': 'xã/phường', 'nationality': 'quốc tịch',
                    'grade': 'khối lớp', 'address': 'địa chỉ', 'achievement': 'thành tích',
                    'highest_round': 'vòng cao nhất', 'parent': 'phụ huynh',
                })
                note_lines = []
                if forced_candidate:
                    note_lines.append(f'Người dùng đã xác nhận hồ sơ nhập là trùng với mã {base.code}.')
                elif matched:
                    note_lines.append(f'Hệ thống tự nhận diện hồ sơ trùng theo {matched_assessment["reason"]}.')
                if changes:
                    note_lines.append(changes)
                if not already_in_target_session:
                    linked_existing += 1
                    previous_sessions = list(ExamSession.objects.filter(id__in=previous_session_ids).exclude(id=session_id).values_list('code', 'name'))
                    previous_label = ', '.join(f'{code} · {name}' for code, name in previous_sessions) or 'chưa có kỳ tổ chức khác được ghi nhận'
                    note_lines.append(f'Đã bổ sung dữ liệu vào kỳ tổ chức {target_session.code} · {target_session.name}. Thí sinh đã từng thi: {previous_label}.')
                if note_lines:
                    append_audit(f'candidate-{base.code}', '\n'.join(note_lines), request, system=not bool(forced_candidate))
                updated += 1
                items_returned.append(serialize_candidate(base))
            else:
                s_ids = [session_id] if session_id else []
                new_c = Candidate.objects.create(
                    id=code,
                    code=code,
                    name=rec_cand['name'],
                    school=rec_cand['school'],
                    class_name=rec_cand['class_name'],
                    city=rec_cand['city'],
                    ward=rec_cand['ward'],
                    nationality=rec_cand['nationality'],
                    grade=rec_cand['grade'],
                    contests=rec_cand['contests'],
                    achievement=rec_cand['achievement'],
                    highest_round=rec_cand['highest_round'],
                    email=rec_cand['email'],
                    parent=rec_cand['parent'],
                    phone=rec_cand['phone'],
                    identity=rec_cand['identity'],
                    address=rec_cand['address'],
                    birth_date=rec_cand['birth_date'],
                    session_ids=s_ids,
                    exam_history=merge_exam_history([], rec_cand['exam_history'], session_id, source, update_mode, True),
                    updated=ts_vn,
                    sort_key=f"{rec_cand['name'].lower()}_{rec_cand['identity'] or code}"
                )
                upsert_participation_history(new_c, session_id, rec_cand['exam_history'], source, rec_cand['registration'], update_mode, True)
                existing.append(new_c)
                existing_codes_set.add(code)
                created += 1
                items_returned.append(serialize_candidate(new_c))
                
        removed_from_session = 0
        if remove_session_candidate_codes:
            for candidate in Candidate.objects.filter(code__in=remove_session_candidate_codes):
                had_membership = CandidateParticipation.objects.filter(candidate=candidate, session_id=session_id).exists() or session_id in list(candidate.session_ids or [])
                CandidateParticipation.objects.filter(candidate=candidate, session_id=session_id).delete()
                session_ids = [item for item in (candidate.session_ids or []) if str(item) != session_id]
                if session_ids != list(candidate.session_ids or []):
                    candidate.session_ids = session_ids
                    candidate.save(update_fields=['session_ids', 'updated_at'])
                if had_membership:
                    removed_from_session += 1
        sync_session_candidate_totals()
        source_label = str(source or 'nguồn nhập dữ liệu').strip()
        existing_summary = f'; trong đó {linked_existing} hồ sơ đã có được bổ sung vào kỳ tổ chức này' if linked_existing else ''
        policy_label = {'add-only': 'chỉ nhập hồ sơ chưa có trên hệ thống', 'fill-empty': 'chỉ bổ sung trường còn trống', 'replace-nonempty': 'cập nhật theo giá trị có nội dung trong nguồn'}[update_mode]
        import_summary = f'Hệ thống nhập dữ liệu từ {source_label}: thêm {created} thí sinh, cập nhật {updated} thí sinh, gỡ {removed_from_session} thí sinh khỏi kỳ thi{existing_summary}; chính sách: {policy_label}. Không xóa dữ liệu do ô nguồn trống.'
        append_audit(f'session-{session_id}', import_summary, request, system=True)
        append_competition_scope_audit(target_session, import_summary, request, system=True)
        if source_sheet:
            source_sheet.last_import_at = timezone.now()
            source_sheet.last_content_fingerprint = source_fingerprint or source_sheet.last_content_fingerprint
            source_sheet.pending_manual_import = False
            source_sheet.last_observed_fingerprint = f'csv:{source_fingerprint}' if source_fingerprint else ''
            source_sheet.change_detected_at = None
            source_sheet.status = 'success'
            source_sheet.last_error = ''
            source_sheet.updated_at = timezone.now()
            source_sheet.save(update_fields=['last_import_at', 'last_content_fingerprint', 'last_observed_fingerprint', 'change_detected_at', 'pending_manual_import', 'status', 'last_error', 'updated_at'])
        return Response({'created': created, 'updated': updated, 'linkedExisting': linked_existing, 'removedFromSession': removed_from_session, 'items': items_returned})
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def lognotes_detail(request, entityKey):
    try:
        if request.method == 'GET':
            notes = [
                serialize_lognote(note)
                for note in LogNote.objects.filter(entity_key=entityKey).order_by('-created_at')
            ]
            return Response(notes)

        data = request.data or {}
        content = data.get('content', '').strip()
        if not content:
            return Response({'error': 'Nội dung không được để trống.'}, status=status.HTTP_400_BAD_REQUEST)

        actor_email = getattr(request.user, 'email', '') or ''
        profile = UserProfile.objects.filter(email=actor_email).first() if actor_email else None
        actor = (profile.name or '').strip() if profile else ''
        note = LogNote.objects.create(
            key=f"{entityKey}:{uuid.uuid4().hex}",
            entity_key=entityKey,
            content=content,
            updated_by=actor or actor_email or 'Nhân viên FT Workspace',
            actor_email=actor_email or None,
            actor_photo_url=(profile.photo_url or '') if profile else '',
            # Only server-side workflows may create system audit entries.
            system=False,
        )
        return Response({'success': True, 'note': serialize_lognote(note)}, status=status.HTTP_201_CREATED)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
