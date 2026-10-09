"""Seat a candidate added after rooms were allocated.

A session whose first round already has rooms asks, when someone is added by
hand, which room the candidate joins (or creates a new one).  Only the first
round is offered: later rounds admit candidates by eligibility, never on entry.
"""
from django.db.models import Count

from .eligibility import is_first_round
from .models import ExamRoom, RoundResult


def first_round(session):
    rounds = [item for item in (session.rounds or []) if isinstance(item, dict) and item.get('id')]
    return rounds[0] if rounds else None


def _slot(round_config, occurrence_id):
    return next((slot for slot in (round_config.get('slots') or [])
                 if isinstance(slot, dict) and str(slot.get('id') or '') == str(occurrence_id or '')), {}) or {}


def room_options(session):
    """Rooms of the session's first round with their size, time and invigilators."""
    round_config = first_round(session)
    if not round_config:
        return None
    rooms = list(ExamRoom.objects.filter(session=session, round_id=str(round_config['id']))
                 .annotate(assigned=Count('assignments', distinct=True))
                 .prefetch_related('invigilation_shifts__invigilators')
                 .order_by('occurrence_id', 'position', 'room_number'))
    occurrences = [{'id': str(slot.get('id') or ''), 'date': str(slot.get('date') or ''), 'time': str(slot.get('time') or ''),
                    'label': str(slot.get('label') or '')}
                   for slot in (round_config.get('slots') or []) if isinstance(slot, dict) and slot.get('id')]
    items = []
    for room in rooms:
        slot = _slot(round_config, room.occurrence_id)
        peer = room.assignments.exclude(time_slot='').values('exam_date', 'time_slot').first() or {}
        invigilators = []
        for shift in room.invigilation_shifts.all():
            if not shift.enabled:
                continue
            names = [profile.name or profile.email for profile in shift.invigilators.all()]
            invigilators.extend(names or ([shift.invigilator_label] if shift.invigilator_label else []))
        items.append({
            'id': str(room.id), 'label': room.label, 'number': room.room_number, 'link': room.link,
            'location': room.location, 'mode': room.mode, 'occurrenceId': room.occurrence_id,
            'date': peer.get('exam_date') or str(slot.get('date') or ''),
            'time': peer.get('time_slot') or str(slot.get('time') or ''),
            'occurrenceLabel': str(slot.get('label') or ''),
            'assignedCount': room.assigned, 'capacity': room.capacity,
            'invigilators': sorted(set(name for name in invigilators if name)),
        })
    return {'roundId': str(round_config['id']), 'roundName': str(round_config.get('name') or ''), 'occurrences': occurrences, 'rooms': items}


def create_room(session, data, actor):
    """A new room next to the existing ones of the same batch (đợt/ca)."""
    from .views import normalize_online_room_link
    round_config = first_round(session)
    if not round_config:
        raise ValueError('Kỳ tổ chức chưa có vòng thi để tạo phòng.')
    occurrence_id = str(data.get('occurrenceId') or '').strip()
    label = str(data.get('label') or '').strip()
    link = normalize_online_room_link(data.get('link'))
    location = str(data.get('location') or '').strip()
    if not label:
        raise ValueError('Vui lòng nhập tên phòng mới.')
    siblings = ExamRoom.objects.filter(session=session, round_id=str(round_config['id']), occurrence_id=occurrence_id)
    if siblings.filter(label__iexact=label).exists() or siblings.filter(room_number__iexact=label).exists():
        raise ValueError(f'Đợt thi này đã có phòng "{label}".')
    reference = siblings.first()
    mode = ExamRoom.MODE_ONLINE if link or (reference and reference.mode == ExamRoom.MODE_ONLINE and not location) else ExamRoom.MODE_IN_PERSON
    return ExamRoom.objects.create(
        session=session, round_id=str(round_config['id']), occurrence_id=occurrence_id,
        round_name=str(round_config.get('name') or ''), common_name=reference.common_name if reference else 'Phòng thi',
        room_number=label[:100], label=label[:500], mode=mode, location=location if mode == ExamRoom.MODE_IN_PERSON else '',
        link=link if mode == ExamRoom.MODE_ONLINE else '', allocation_strategy=ExamRoom.STRATEGY_BALANCED,
        position=siblings.count(), created_by=actor,
    )


def assign_to_room(participation, room):
    """Seat the candidate in ``room`` and copy the room's schedule to the result.

    The schedule and room cell follow the candidates already seated there, so
    the Sheet row matches its neighbours (e.g. "Room 4: meet.google.com/...").
    """
    session = participation.session
    round_config = next((item for item in (session.rounds or []) if isinstance(item, dict) and str(item.get('id')) == room.round_id), {})
    if not is_first_round(session, room.round_id):
        raise ValueError('Chỉ xếp phòng khi thêm thí sinh cho vòng đầu tiên.')
    slot = _slot(round_config, room.occurrence_id)
    peer = room.assignments.exclude(participation=participation).order_by('-updated_at').first()
    if peer:
        values = {'exam_date': peer.exam_date, 'time_slot': peer.time_slot, 'mode': peer.mode, 'location': peer.location}
    else:
        online = room.mode == ExamRoom.MODE_ONLINE
        values = {
            'exam_date': str(slot.get('date') or ''), 'time_slot': str(slot.get('time') or ''),
            'mode': 'Trực tuyến' if online else 'Trực tiếp',
            'location': f'{room.label}: {room.link}' if online and room.link else ' · '.join(value for value in [room.label, room.location] if value),
        }
    result = (RoundResult.objects.filter(participation=participation, round_id=room.round_id).order_by('-updated_at').first()
              or RoundResult(participation=participation, round_id=room.round_id, round_name=str(round_config.get('name') or room.round_name)))
    result.occurrence_id = room.occurrence_id
    result.exam_room = room
    result.room_name = room.label
    for key, value in values.items():
        if value:
            setattr(result, key, value)
    if room.exam_link:
        result.link = room.exam_link
    result.save()
    return result
