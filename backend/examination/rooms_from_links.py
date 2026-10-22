"""Rooms from an allocation already typed in the session Sheet.

Khảo thí sometimes allocates rooms straight in the session tab: every
candidate of a room gets the same "Địa điểm/Phòng thi" (an online meeting
link or a room name). The Sheet import copies that text onto the round result,
but Coi thi needs real rooms. This turns each distinct value into a room of its
round and batch, seats the candidates there and opens one duty per room with a
guest invigilator link. Only the room assignment is written: dates, links,
SBD and every Sheet cell stay as they are. Preview first; applying backs the
database up before writing.
"""
import logging
import os
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from django.core.management import call_command
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.permissions import IsWorkspaceAuthenticated
from .invigilation import can_manage, new_guest_token
from .models import ExamInvigilationShift, ExamRoom, ExamSession, RoundResult

logger = logging.getLogger(__name__)
VN = ZoneInfo('Asia/Ho_Chi_Minh')
TIME_RANGE = re.compile(r'(\d{1,2})\s*[:hH]\s*(\d{2})?\s*[-–—]\s*(\d{1,2})\s*[:hH]\s*(\d{2})?')
DEFAULT_BACKUP_DIR = '/home/workspace/ft-workspace-data/backups'


def room_key(value):
    """Same room whatever the scheme, case or trailing slash of a meeting link."""
    text = ' '.join(str(value or '').split())
    if not text:
        return ''
    lowered = re.sub(r'^https?://', '', text.lower()).rstrip('/')
    return lowered.split('?')[0] if '.' in lowered.split('/')[0] else lowered


def _url(value):
    text = str(value or '').strip()
    host = re.sub(r'^https?://', '', text, flags=re.I).split('/')[0]
    if not text or ' ' in text or '.' not in host:
        return ''
    return text if re.match(r'^https?://', text, re.I) else f'https://{text}'


def _sbd_order(value):
    text = str(value or '').strip()
    return (0, int(text), text) if text.isdigit() else (1, 0, text)


def _rounds(session):
    return [item for item in (session.rounds or []) if isinstance(item, dict) and item.get('id')]


def _slot(round_config, occurrence_id):
    return next((slot for slot in (round_config.get('slots') or [])
                 if isinstance(slot, dict) and str(slot.get('id') or '') == occurrence_id), {}) or {}


def _duty_times(date_text, time_text):
    """(starts, ends) in Vietnam time from '2026-10-18' and '9:30-10:30', else (None, None)."""
    date_match = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', str(date_text or '').strip())
    if not date_match:
        date_match = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', str(date_text or '').strip())
        if not date_match:
            return None, None
        day, month, year = (int(part) for part in date_match.groups())
    else:
        year, month, day = (int(part) for part in date_match.groups())
    time_match = TIME_RANGE.search(str(time_text or ''))
    if not time_match:
        return None, None
    h1, m1, h2, m2 = time_match.groups()
    try:
        starts = datetime(year, month, day, int(h1), int(m1 or 0), tzinfo=VN)
        ends = datetime(year, month, day, int(h2), int(m2 or 0), tzinfo=VN)
    except ValueError:
        return None, None
    return (starts, ends) if ends > starts else (None, None)


def build_plan(session):
    """Rooms each round/batch would get, without writing anything."""
    plans = []
    for round_config in _rounds(session):
        round_id = str(round_config['id'])
        round_name = str(round_config.get('name') or '')
        results = list(RoundResult.objects.filter(participation__session=session).filter(
            Q(round_id=round_id) | Q(round_id='', round_name=round_name)).exclude(location='')
            .select_related('participation__candidate'))
        groups = defaultdict(list)
        for result in results:
            key = room_key(result.location)
            if key:
                groups[key].append(result)
        if not groups:
            continue
        slot_ids = [str(slot.get('id')) for slot in (round_config.get('slots') or []) if isinstance(slot, dict) and slot.get('id')]
        by_occurrence = defaultdict(list)
        unresolved = 0
        for key, members in groups.items():
            known = Counter(r.occurrence_id for r in members if r.occurrence_id)
            occurrence = known.most_common(1)[0][0] if known else (slot_ids[0] if len(slot_ids) == 1 else '')
            if not occurrence:
                unresolved += len(members)
                continue
            by_occurrence[occurrence].append((key, members))
        for occurrence_id, entries in by_occurrence.items():
            slot = _slot(round_config, occurrence_id)
            existing = list(ExamRoom.objects.filter(session=session, round_id=round_id, occurrence_id=occurrence_id))
            existing_by_key = {}
            for room in existing:
                for value in (room.link, room.exam_link, room.location):
                    if room_key(value):
                        existing_by_key.setdefault(room_key(value), room)
            next_number = max([int(r.room_number) for r in existing if str(r.room_number).isdigit()] or [0]) + 1
            entries.sort(key=lambda item: min(_sbd_order(r.sbd) for r in item[1]))
            times = Counter(r.time_slot for _, members in entries for r in members if r.time_slot)
            time_text = str(slot.get('time') or '') or (times.most_common(1)[0][0] if times else '')
            starts, ends = _duty_times(slot.get('date'), time_text)
            rooms = []
            for key, members in entries:
                room = existing_by_key.get(key)
                if room:
                    number, label = room.room_number, room.label
                else:
                    number, label = str(next_number), f'Phòng {next_number}'
                    next_number += 1
                rooms.append({
                    'key': key, 'link': _url(members[0].location) or members[0].location,
                    'roomNumber': number, 'label': label, 'existingRoomId': str(room.pk) if room else '',
                    'candidates': len(members),
                    'moving': sum(1 for r in members if r.exam_room_id and (not room or r.exam_room_id != room.pk)),
                    'alreadySeated': sum(1 for r in members if room and r.exam_room_id == room.pk),
                    'missingDate': sum(1 for r in members if not r.exam_date),
                    'firstSbd': min((r.sbd for r in members), key=_sbd_order, default=''),
                    'hasShift': bool(room and ExamInvigilationShift.objects.filter(exam_room=room).exists()),
                    'resultIds': [r.pk for r in members],
                })
            plans.append({
                'roundId': round_id, 'roundName': round_name, 'occurrenceId': occurrence_id,
                'occurrenceLabel': str(slot.get('label') or ''), 'date': str(slot.get('date') or ''), 'time': time_text,
                'startsAt': starts.isoformat() if starts else '', 'endsAt': ends.isoformat() if ends else '',
                'rooms': rooms, 'unresolved': unresolved,
            })
            unresolved = 0
    return plans


def _public(plans):
    return [{**plan, 'rooms': [{k: v for k, v in room.items() if k != 'resultIds'} for room in plan['rooms']]} for plan in plans]


def backup_database():
    destination = os.getenv('WORKSPACE_BACKUP_DIR') or DEFAULT_BACKUP_DIR
    if not Path(destination).parent.exists():
        logger.info('Backup skipped: %s is not available on this machine.', destination)
        return ''
    call_command('backup_workspace_db', destination=destination, keep=60)
    return destination


def apply_plan(session, plans, actor_email):
    summary = {'roomsCreated': 0, 'seated': 0, 'shiftsCreated': 0, 'warnings': []}
    touched_rooms = []
    with transaction.atomic():
        for plan in plans:
            starts = datetime.fromisoformat(plan['startsAt']) if plan['startsAt'] else None
            ends = datetime.fromisoformat(plan['endsAt']) if plan['endsAt'] else None
            for index, item in enumerate(plan['rooms']):
                room = ExamRoom.objects.filter(pk=item['existingRoomId']).first() if item['existingRoomId'] else None
                if not room:
                    link = _url(item['link'])
                    room = ExamRoom.objects.create(
                        session=session, round_id=plan['roundId'], occurrence_id=plan['occurrenceId'],
                        round_name=plan['roundName'], common_name='Phòng', room_number=item['roomNumber'],
                        label=item['label'], mode=ExamRoom.MODE_ONLINE if link else ExamRoom.MODE_IN_PERSON,
                        location='' if link else item['link'], link=link, exam_link=link,
                        position=int(item['roomNumber']) if str(item['roomNumber']).isdigit() else index,
                        created_by=actor_email,
                    )
                    summary['roomsCreated'] += 1
                # Only the room assignment changes; update() keeps every other field and skips Sheet jobs.
                summary['seated'] += RoundResult.objects.filter(pk__in=item['resultIds']).exclude(exam_room=room).update(exam_room=room)
                touched_rooms.append(room)
                shift = ExamInvigilationShift.objects.filter(exam_room=room).first()
                if shift:
                    continue
                if not starts or not ends:
                    summary['warnings'].append(f'{plan["roundName"]} · {room.label}: chưa có ngày/giờ thi nên chưa tạo ca coi thi.')
                    continue
                occurrence = room.occurrence_id or room.round_id
                clash = ExamInvigilationShift.objects.filter(session=session, occurrence_id=occurrence, room_number=room.room_number).first()
                if clash and clash.exam_room_id is None:
                    clash.exam_room = room
                    clash.guest_token = clash.guest_token or new_guest_token()
                    clash.save(update_fields=['exam_room', 'guest_token', 'updated_at'])
                    continue
                if clash:
                    summary['warnings'].append(f'{room.label}: số phòng này đã có ca coi thi khác, chưa tạo ca mới.')
                    continue
                ExamInvigilationShift.objects.create(
                    session=session, exam_room=room, occurrence_id=occurrence, round_name=room.round_name,
                    label=plan['occurrenceLabel'] or 'Ca thi', room_number=room.room_number,
                    room_link=room.exam_link or room.link, starts_at=starts, ends_at=ends,
                    guest_token=new_guest_token(), enabled=True,
                )
                summary['shiftsCreated'] += 1
        from .room_sheet import mark_room_sheet_dirty
        mark_room_sheet_dirty(session.pk)
    return summary


@api_view(['GET', 'POST'])
@permission_classes([IsWorkspaceAuthenticated])
def rooms_from_links(request, session_id):
    if not can_manage(request):
        return Response({'error': 'Chỉ quản lý khảo thí được tạo phòng thi.'}, status=403)
    session = get_object_or_404(ExamSession, pk=session_id)
    plans = build_plan(session)
    if request.method == 'GET':
        return Response({'plans': _public(plans)})
    wanted = {(str(item.get('roundId')), str(item.get('occurrenceId'))) for item in (request.data.get('plans') or [])
              if isinstance(item, dict)}
    chosen = [plan for plan in plans if (plan['roundId'], plan['occurrenceId']) in wanted]
    if not chosen:
        return Response({'error': 'Chọn ít nhất một đợt thi để tạo phòng.'}, status=400)
    try:
        backup = backup_database()
    except Exception as exc:  # never write without the safety copy
        logger.exception('Backup before creating rooms failed.')
        return Response({'error': f'Chưa sao lưu được dữ liệu nên chưa tạo phòng: {exc}'}, status=500)
    summary = apply_plan(session, chosen, getattr(request.user, 'email', '') or '')
    summary['backup'] = bool(backup)
    return Response({**summary, 'plans': _public(build_plan(session))})
