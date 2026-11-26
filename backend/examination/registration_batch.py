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
    results = entry_round_results(participation, entry)
    if any(result.occurrence_id or result.exam_date for result in results):
        return None
    return add_batch(participation, entry, day)


def entry_round_results(participation, entry):
    round_id = str(entry.get('id') or '').strip()
    round_name = str(entry.get('name') or '').strip() or 'Vòng 1'
    return list(RoundResult.objects.filter(participation=participation).filter(
        Q(round_id=round_id) | Q(round_id='', round_name__iexact=round_name)))


def result_batch_day(result, entry):
    for slot in entry.get('slots') or []:
        if isinstance(slot, dict) and result.occurrence_id and str(slot.get('id')) == result.occurrence_id:
            return parse_date(slot.get('date')) or parse_date(str(result.exam_date or '')[:10])
    return parse_date(str(result.exam_date or '')[:10])


def batch_result_locked(result):
    return any(getattr(result, field) for field in (
        'exam_room_id', 'room_name', 'sbd', 'time_slot', 'mode', 'location', 'link', 'account', 'password',
        'attendance', 'score', 'score_rate', 'rank', 'result',
    ))


def add_batch(participation, entry, day, slot_id=None):
    """Cho thí sinh thi thêm một đợt của vòng (miễn phí, chốt 25/11/2026).

    Đã có đợt này thì trả None. Có kết quả vòng còn trống thì điền vào đó;
    còn lại tạo một kết quả mới cho đợt, giữ nguyên các đợt đã thi.
    `slot_id`: ca Khảo thí chọn; mặc định là ca duy nhất của ngày đó.
    """
    slot_id = slot_id if slot_id is not None else batch_slot_id(entry, day)
    results = entry_round_results(participation, entry)
    if any(result_batch_day(result, entry) == day for result in results):
        return None
    blank = next((result for result in results if not result.occurrence_id and not result.exam_date
                  and not batch_result_locked(result)), None)
    if blank:
        return _fill(blank, entry, slot_id, day)
    return RoundResult.objects.create(participation=participation, round_id=str(entry.get('id') or '').strip(),
                                      round_name=str(entry.get('name') or '').strip() or 'Vòng 1',
                                      occurrence_id=slot_id, exam_date=day.isoformat())


def _fill(result, entry, slot_id, day):
    result.round_id = str(entry.get('id') or '').strip()
    result.occurrence_id = slot_id
    result.exam_date = day.isoformat()
    result.save(update_fields=['round_id', 'occurrence_id', 'exam_date', 'updated_at'])
    return result


def move_batch(participation, entry, source_id, day):
    results = entry_round_results(participation, entry)
    source = next((result for result in results if str(result.pk) == source_id), None)
    if source is None or result_batch_day(source, entry) not in batch_days(entry):
        raise ValueError('Không tìm thấy đợt cũ trong hồ sơ. Hãy tải lại danh sách.')
    if batch_result_locked(source):
        raise ValueError('Đợt cũ đã có thông tin dự thi hoặc kết quả. Có thể dùng “Thêm đợt” để giữ dữ liệu cũ.')
    if any(result_batch_day(result, entry) == day for result in results):
        raise ValueError('Thí sinh đã có lượt ở đợt này.')
    return _fill(source, entry, batch_slot_id(entry, day), day)


def staff_batch(session, exam_date):
    rounds = session_rounds(session)
    entry = rounds[0] if rounds else {}
    day = parse_date(exam_date)
    days = batch_days(entry)
    if len(days) < 2 or day not in days:
        raise ValueError(f'Hãy chọn một đợt trong vòng đầu của {session.code}.')
    return entry, day


def registered_on(participation):
    """Ưu tiên ngày gửi Google Form, kể cả khi webhook nhập muộn."""
    data = participation.registration_data or {}
    return (parse_date(str(data.get('formSubmittedAt') or '')[:10])
            or parse_date(str(data.get('registeredAt') or '')[:10])
            or timezone.localdate(participation.created_at))


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
    """`today`: ngày đăng ký (dòng Form nhập muộn vẫn vào đợt mở lúc đăng ký)."""
    batch = open_batch(participation.session, today)
    if not batch:
        return None
    entry, _number, day = batch
    return place_in_batch(participation, entry, day)


def add_open_batch(participation, today=None):
    """Đăng ký lại của thí sinh đã có lượt tham gia: thêm đợt đang mở nếu chưa có.

    Trả về (số đợt, ngày thi, RoundResult hoặc None nếu đã có đợt này); None nếu
    vòng đầu không chia đợt hoặc không còn đợt nào mở.
    """
    batch = open_batch(participation.session, today)
    if not batch:
        return None
    entry, number, day = batch
    return number, day, add_batch(participation, entry, day)
