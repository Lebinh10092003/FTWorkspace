"""Which exam sessions the public registration form offers, and at what fee.

Quy tắc chủ dự án chốt ngày 12/11/2026:
- Một kỳ chỉ hiện trên form khi **cả hai** điều kiện đúng: kỳ chưa qua giai đoạn
  tuyển sinh, và hôm nay nằm trong 4 tháng trước hạn đăng ký (hết hạn thì ẩn).
- Lệ phí và hạn đăng ký khai theo từng vòng trong kỳ tổ chức. Thí sinh mới đăng
  ký vào vòng đầu tiên (vòng loại nếu có, không có thì vòng chung kết), nên form
  thu lệ phí vòng đầu. Các vòng sau chỉ hiện để phụ huynh biết trước.
- Vòng đầu có thể tổ chức nhiều đợt (vd FIMO vòng loại 3 đợt): mỗi đợt có hạn
  đăng ký riêng, form lấy đợt gần nhất chưa hết hạn. Đợt chưa khai hạn thì dùng
  ngày thi của đợt đó.
"""
import re
from datetime import date

from django.utils import timezone

WINDOW_MONTHS = 4
# Giai đoạn là ô nhập tự do; các giai đoạn trước và trong tuyển sinh.
OPEN_PHASE_MARKERS = ('chuẩn bị', 'truyền thông', 'tuyển sinh', 'đăng ký', 'chưa cập nhật', 'idle')
SCO_ALIASES = {code: f'S{code}' for code in ('IMO', 'IEO', 'ISO', 'ICO', 'IGKO', 'IMAO', 'IFKO', 'IEIO', 'ISSO')}
MAX_FEE = 100_000_000


def clean_fee(value):
    """Lệ phí VND nguyên dương, hoặc None khi chưa công bố."""
    if value in (None, '') or isinstance(value, bool):
        return None
    try:
        amount = int(str(value).replace('.', '').replace(',', '').strip()) if isinstance(value, str) else value
    except ValueError:
        return None
    if not isinstance(amount, int) or amount < 0 or amount > MAX_FEE:
        return None
    return amount


def clean_iso_date(value):
    text = str(value or '').strip()
    return text if re.fullmatch(r'\d{4}-\d{2}-\d{2}', text) and parse_date(text) else ''


def parse_date(value):
    try:
        return date.fromisoformat(str(value or '').strip())
    except ValueError:
        return None


def months_before(day, months):
    month_index = day.year * 12 + day.month - 1 - months
    year, month = divmod(month_index, 12)
    month += 1
    for candidate in (day.day, 30, 29, 28):
        try:
            return date(year, month, candidate)
        except ValueError:
            continue
    return date(year, month, 28)


def phase_open(phase):
    text = str(phase or '').strip().casefold()
    return not text or any(marker in text for marker in OPEN_PHASE_MARKERS)


def public_code(session, competition_codes=None):
    from .form_registration import SESSION_IDS
    legacy = {session_id: code for code, session_id in SESSION_IDS.items()}
    code = str(legacy.get(session.id) or (competition_codes or {}).get(session.competition_id) or session.code).upper()
    return SCO_ALIASES.get(code, code)


def session_rounds(session):
    rounds = [item for item in (session.rounds or []) if isinstance(item, dict) and str(item.get('name') or '').strip()]
    if rounds:
        return rounds
    if session.national or session.national_date:
        return [{'id': 'legacy-national', 'name': 'Vòng Chung kết Quốc gia', 'date': session.national_date or ''}]
    return []


def round_dates(round_config):
    values = [round_config.get('date'), *[slot.get('date') for slot in round_config.get('slots') or [] if isinstance(slot, dict)]]
    return sorted(day for day in (parse_date(value) for value in values) if day)


def deadline_options(round_config):
    """[(hạn, khai riêng?, số đợt hoặc None)] của một vòng, sắp theo ngày."""
    if not round_config:
        return []
    options = []
    slots = [slot for slot in round_config.get('slots') or [] if isinstance(slot, dict)]
    for index, slot in enumerate(slots):
        explicit = parse_date(slot.get('registrationDeadline'))
        day = explicit or parse_date(slot.get('date'))
        if day:
            options.append((day, bool(explicit), index + 1 if len(slots) > 1 else None))
    explicit_round = parse_date(round_config.get('registrationDeadline'))
    if explicit_round:
        options.append((explicit_round, True, None))
    if not options and parse_date(round_config.get('date')):
        options.append((parse_date(round_config.get('date')), False, None))
    return sorted(set(options), key=lambda item: (item[0], not item[1]))


def registration_deadline(round_config, today=None):
    """Hạn gần nhất chưa qua; hết cả thì trả hạn cuối để báo đã hết hạn."""
    today = today or timezone.localdate()
    options = deadline_options(round_config)
    upcoming = [item for item in options if item[0] >= today]
    return (upcoming or options[-1:] or [None])[0]


def session_offer(session, today=None):
    """Trạng thái nhận đăng ký của một kỳ, kèm lý do để Workspace giải thích."""
    today = today or timezone.localdate()
    rounds = session_rounds(session)
    entry = rounds[0] if rounds else None
    chosen = registration_deadline(entry, today)
    deadline, explicit, batch = chosen if chosen else (None, False, None)
    opens = months_before(deadline, WINDOW_MONTHS) if deadline else None
    if not phase_open(session.phase):
        status = 'closed-phase'
    elif not deadline:
        status = 'missing-deadline'
    elif today > deadline:
        status = 'expired'
    elif today < opens:
        status = 'not-yet'
    else:
        status = 'open'
    return {
        'status': status,
        'deadline': deadline.isoformat() if deadline else '',
        'opensOn': opens.isoformat() if opens else '',
        'deadlineIsExplicit': explicit,
        'entryRound': (f"{entry.get('name') or ''} · đợt {batch}" if batch else str(entry.get('name') or '')) if entry else '',
        'fee': clean_fee(entry.get('fee')) if entry else None,
        'laterRounds': [{'name': str(item.get('name') or ''), 'fee': clean_fee(item.get('fee'))} for item in rounds[1:]],
    }


def candidate_sessions():
    """Mọi kỳ có thể còn liên quan tới tuyển sinh, kèm mã cuộc thi công khai."""
    from .models import Competition, ExamSession
    codes = dict(Competition.objects.values_list('id', 'code'))
    names = dict(Competition.objects.values_list('id', 'name'))
    rows = []
    for session in ExamSession.objects.all().order_by('sort_key'):
        rows.append((public_code(session, codes), session, names.get(session.competition_id) or session.parent or session.name))
    return rows


def open_registration_sessions(hidden_codes=(), today=None):
    """{mã cuộc thi: (kỳ, offer, tên cuộc thi)}; mỗi mã lấy kỳ có hạn đăng ký sớm nhất."""
    hidden = {str(code).upper() for code in hidden_codes or ()}
    chosen = {}
    for code, session, name in candidate_sessions():
        if code in hidden or not re.fullmatch(r'[A-Z][A-Z0-9]{1,19}', code):
            continue
        offer = session_offer(session, today)
        if offer['status'] != 'open':
            continue
        current = chosen.get(code)
        if current is None or offer['deadline'] < current[1]['deadline']:
            chosen[code] = (session, offer, name)
    return chosen
