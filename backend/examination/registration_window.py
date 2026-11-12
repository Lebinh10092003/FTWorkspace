"""Which exam sessions the public registration form offers, and at what fee.

Quy tắc chủ dự án chốt ngày 12/11/2026:
- Một kỳ chỉ hiện trên form khi **cả hai** điều kiện đúng: kỳ chưa qua giai đoạn
  tuyển sinh, và hôm nay nằm trong 4 tháng trước hạn đăng ký (hết hạn thì ẩn).
- Lệ phí và hạn đăng ký khai theo từng vòng trong kỳ tổ chức. Thí sinh mới đăng
  ký vào vòng đầu tiên (vòng loại nếu có, không có thì vòng chung kết), nên form
  thu lệ phí vòng đầu. Các vòng sau chỉ hiện để phụ huynh biết trước.
- Hạn đăng ký để trống thì lấy ngày thi sớm nhất của vòng đầu.
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


def registration_deadline(round_config):
    if not round_config:
        return None
    explicit = parse_date(round_config.get('registrationDeadline'))
    if explicit:
        return explicit
    dates = round_dates(round_config)
    return dates[0] if dates else None


def session_offer(session, today=None):
    """Trạng thái nhận đăng ký của một kỳ, kèm lý do để Workspace giải thích."""
    today = today or timezone.localdate()
    rounds = session_rounds(session)
    entry = rounds[0] if rounds else None
    deadline = registration_deadline(entry)
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
        'deadlineIsExplicit': bool(entry and parse_date(entry.get('registrationDeadline'))),
        'entryRound': str(entry.get('name') or '') if entry else '',
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
