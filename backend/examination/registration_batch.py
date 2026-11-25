"""Place a new registration in the exam batch its registration form offered.

Quy tắc chủ dự án chốt ngày 25/11/2026: vòng đầu tổ chức nhiều đợt (FIMO, FIEO
vòng loại 3 đợt) thì thí sinh đăng ký mới vào **đợt đang mở**, tức đợt có hạn
đăng ký gần nhất chưa qua, đúng đợt mà form đăng ký hiển thị. Chỉ điền đợt và
ngày thi; phòng, giờ/ca, hình thức và link vẫn để trống chờ Khảo thí xếp.
Thí sinh Khảo thí đã xếp đợt/ngày thì không bị đổi.
"""
from django.db.models import Q
from django.utils import timezone

from .models import RoundResult
from .registration_window import parse_date, registration_deadline, session_rounds


def batch_days(round_config):
    """Ngày thi khác nhau của vòng, sắp tăng dần: đợt n là phần tử n-1."""
    slots = [slot for slot in (round_config or {}).get('slots') or [] if isinstance(slot, dict)]
    return sorted({day for day in (parse_date(slot.get('date')) for slot in slots) if day})


def batch_slot_id(round_config, day):
    """Mã ca của đợt khi đợt chỉ có một ca; nhiều ca cùng ngày thì để Khảo thí chọn."""
    ids = [str(slot.get('id')) for slot in (round_config or {}).get('slots') or []
           if isinstance(slot, dict) and slot.get('id') and parse_date(slot.get('date')) == day]
    return ids[0] if len(ids) == 1 else ''


def open_batch(session, today=None):
    """(vòng đầu, số đợt, ngày thi) của đợt đang mở; None nếu vòng đầu chỉ có một đợt."""
    today = today or timezone.localdate()
    rounds = session_rounds(session)
    entry = rounds[0] if rounds else None
    if not entry or not str(entry.get('id') or '').strip():
        return None
    days = batch_days(entry)
    chosen = registration_deadline(entry, today)
    if len(days) < 2 or not chosen or chosen[0] < today or not chosen[2]:
        return None
    return entry, chosen[2], days[chosen[2] - 1]


def place_in_batch(participation, entry, day):
    """Ghi đợt + ngày thi vào kết quả vòng đầu. Trả về RoundResult đã ghi, hoặc None nếu đã được xếp."""
    round_id = str(entry.get('id') or '').strip()
    round_name = str(entry.get('name') or '').strip() or 'Vòng 1'
    results = list(RoundResult.objects.filter(participation=participation).filter(
        Q(round_id=round_id) | Q(round_id='', round_name__iexact=round_name)))
    if any(result.occurrence_id or result.exam_date for result in results):
        return None
    slot_id = batch_slot_id(entry, day)
    if results:
        result = results[0]
        result.round_id = round_id
        result.occurrence_id = slot_id
        result.exam_date = day.isoformat()
        result.save(update_fields=['round_id', 'occurrence_id', 'exam_date', 'updated_at'])
        return result
    return RoundResult.objects.create(participation=participation, round_id=round_id, round_name=round_name,
                                      occurrence_id=slot_id, exam_date=day.isoformat())


def registered_on(participation):
    """Ngày đăng ký: registeredAt của hồ sơ, không có thì ngày tạo lượt tham gia."""
    value = str((participation.registration_data or {}).get('registeredAt') or '')[:10]
    return parse_date(value) or timezone.localdate(participation.created_at)


def batch_on(session, day):
    """(vòng đầu, số đợt, ngày thi) của đợt mà form mở vào ngày `day`."""
    return open_batch(session, day)


def backfill_plan(sessions):
    """[(participation, số đợt, ngày thi)] cho thí sinh đăng ký từ đợt 2 trở đi mà chưa có đợt.

    Đợt tính theo ngày đăng ký (đợt form đang mở hôm đó). Đăng ký trong đợt 1,
    nhóm trường và dữ liệu lịch sử thì để Khảo thí xếp như trước.
    """
    from .models import CandidateParticipation
    plan, skipped = [], {'batch1': 0, 'placed': 0, 'school': 0, 'closed': 0}
    for session in sessions:
        participations = CandidateParticipation.objects.filter(session=session).select_related('candidate', 'session').order_by('created_at')
        for participation in participations:
            data = participation.registration_data or {}
            if participation.school_registration_id:
                skipped['school'] += 1
                continue
            if data.get('historicalImport') is True:
                continue
            batch = batch_on(session, registered_on(participation))
            if not batch:
                skipped['closed'] += 1
                continue
            entry, number, day = batch
            if number < 2:
                skipped['batch1'] += 1
                continue
            round_id = str(entry.get('id') or '').strip()
            round_name = str(entry.get('name') or '').strip()
            placed = RoundResult.objects.filter(participation=participation).filter(
                Q(round_id=round_id) | Q(round_id='', round_name__iexact=round_name)).exclude(occurrence_id='', exam_date='')
            if placed.exists():
                skipped['placed'] += 1
                continue
            plan.append((participation, entry, number, day))
    return plan, skipped


def place_new_registration(participation, today=None):
    batch = open_batch(participation.session, today)
    if not batch:
        return None
    entry, _number, day = batch
    return place_in_batch(participation, entry, day)
