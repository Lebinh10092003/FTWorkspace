import io
import csv
import hashlib
import json
import re
import requests
import datetime
import uuid
import unicodedata
import urllib.parse
from django.utils import timezone
from .models import Candidate, CandidateParticipation, RoundResult, ExamSession, Competition, ExaminationSheet, LogNote
from .eligibility import normalize_eligibility
from authentication.models import SystemConfig
from integrations.google_sheets import build_sheets_service, extract_spreadsheet_id

DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1kqztN_iCeZ9uR1mO7gz9j1TcUt8ZmCdpEv0TagTf4VA/edit?usp=sharing'

def clean_txt(value):
    if value is None:
        return ''
    return str(value).strip()

def normalise_str(value):
    text = clean_txt(value).casefold().replace(chr(273), 'd')
    text = unicodedata.normalize('NFD', text)
    text = ''.join(char for char in text if not unicodedata.combining(char))
    return re.sub(r'[^a-z0-9]+', '', text)

def get_contest_codes(value):
    val = clean_txt(value)
    if not val:
        return []
    parts = re.split(r'[,;]', val)
    return [p.strip().upper() for p in parts if p.strip()]

def merge_contest_codes(*values):
    codes = []
    for v in values:
        codes.extend(get_contest_codes(v))
    # Remove duplicates preserving order
    seen = set()
    result = []
    for c in codes:
        if c not in seen:
            seen.add(c)
            result.append(c)
    return ', '.join(result)

def format_person_name(value):
    """Normalize a person's name to title case while preserving Vietnamese accents."""
    words = re.sub(r'\s+', ' ', clean_txt(value)).split(' ')
    return ' '.join('-'.join(part[:1].upper() + part[1:].lower() for part in word.split('-') if part) for word in words if word)

def normalized_identity(value):
    digits = re.sub(r'\D', '', clean_txt(value))
    return digits if len(digits) >= 6 and len(set(digits)) > 1 else ''


def normalized_phone(value):
    digits = re.sub(r'\D', '', clean_txt(value))
    if digits.startswith('84') and len(digits) in {11, 12}:
        digits = '0' + digits[2:]
    return digits if len(digits) >= 9 and len(set(digits)) > 1 else ''


def normalized_email(value):
    email = clean_txt(value).casefold()
    return email if '@' in email and '.' in email.rsplit('@', 1)[-1] else ''


def birth_date_parts(value):
    raw = clean_txt(value)
    full = raw if re.fullmatch(r'\d{4}-\d{2}-\d{2}', raw) else ''
    year = raw[:4] if re.fullmatch(r'\d{4}(?:-\d{2}-\d{2})?', raw) else ''
    return year, full


def same_nonempty(a, b):
    left, right = normalise_str(a), normalise_str(b)
    return bool(left and right and left == right)


def should_replace_birth_date(existing_value, incoming_value):
    """Keep a known DD/MM/YYYY-equivalent ISO date when a later import has only its year."""
    _, existing_full = birth_date_parts(existing_value)
    _, incoming_full = birth_date_parts(incoming_value)
    return bool(clean_txt(incoming_value)) and not (existing_full and not incoming_full)


def candidate_match_assessment(a, b):
    """Classify matches using only reliable identifiers, then a strict fallback.

    CCCD, email and phone are the primary keys. Matching one of those plus the
    same name is safe to link automatically; the same identifier with a
    different name is surfaced for an operator to confirm. When at least one
    record is missing an identifier, a full name + full DOB + school + class is
    the only automatic fallback.
    """
    identity_a, identity_b = normalized_identity(a.get('identity')), normalized_identity(b.get('identity'))
    email_a, email_b = normalized_email(a.get('email')), normalized_email(b.get('email'))
    phone_a, phone_b = normalized_phone(a.get('phone')), normalized_phone(b.get('phone'))
    identifier_pairs = [
        ('CCCD/Hộ chiếu', identity_a, identity_b),
        ('email', email_a, email_b),
        ('số điện thoại', phone_a, phone_b),
    ]
    shared_identifiers = [label for label, left, right in identifier_pairs if left and right and left == right]
    name_matches = same_nonempty(a.get('name'), b.get('name'))

    if shared_identifiers:
        reason = ', '.join(shared_identifiers)
        if name_matches:
            return {'status': 'confirmed', 'reason': f'Họ tên và {reason} trùng'}
        return {'status': 'possible', 'reason': f'{reason} trùng nhưng họ tên khác, cần xác nhận'}

    # Do not use descriptive fields when both records already have a complete
    # but different identity footprint. It is very likely two people.
    identifiers_missing = any(not value for _, left, right in identifier_pairs for value in (left, right))
    if not identifiers_missing or not name_matches:
        return None

    year_a, full_a = birth_date_parts(a.get('birth_date'))
    year_b, full_b = birth_date_parts(b.get('birth_date'))
    if full_a and full_b and full_a != full_b:
        return None
    if year_a and year_b and year_a != year_b:
        return None

    school_matches = same_nonempty(a.get('school'), b.get('school'))
    class_matches = same_nonempty(a.get('class_name') or a.get('className'), b.get('class_name') or b.get('className'))
    full_birth_matches = bool(full_a and full_b and full_a == full_b)
    compatible_birth = bool(year_a and year_b and year_a == year_b)

    if full_birth_matches and school_matches and class_matches:
        return {'status': 'confirmed', 'reason': 'Họ tên, ngày sinh đầy đủ, trường và lớp trùng'}
    if compatible_birth and (school_matches or class_matches):
        return {'status': 'possible', 'reason': 'Họ tên, năm/ngày sinh và trường hoặc lớp trùng, cần xác nhận'}
    if school_matches and class_matches:
        return {'status': 'possible', 'reason': 'Họ tên, trường và lớp trùng nhưng thiếu ngày sinh, cần xác nhận'}
    return None


def same_candidate(a, b):
    assessment = candidate_match_assessment(a, b)
    return bool(assessment and assessment['status'] == 'confirmed')
def next_code(existing_codes_set, offset=0):
    """Return the next stable, human-readable FermatTech candidate code."""
    numbers = [int(match.group(1)) for code in existing_codes_set if (match := re.fullmatch(r'FT-(\d+)', str(code).strip().upper()))]
    seq = max(numbers, default=0) + 1 + max(offset, 0)
    candidate = f"FT-{seq:05d}"
    while candidate in existing_codes_set:
        seq += 1
        candidate = f"FT-{seq:05d}"
    return candidate

def parse_dob(raw):
    """Return a valid ISO date or a four-digit birth year from spreadsheet input."""
    cleaned = clean_txt(raw).replace(' ', '')
    cleaned = re.sub(r'[^0-9/\-.]', '', cleaned)
    if re.fullmatch(r'\d{4}', cleaned):
        return cleaned
    parts = [part for part in re.split(r'[/\-.]', cleaned) if part]
    if len(parts) != 3:
        return ''

    try:
        if len(parts[0]) == 4:
            year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
        else:
            first, second, last = int(parts[0]), int(parts[1]), parts[2]
            year = int(last)
            if len(last) == 2:
                year += 2000
            # Vietnamese templates use DD/MM/YYYY. When one part exceeds 12,
            # unambiguously accept the spreadsheet's US-style MM/DD/YY too.
            if first > 12:
                day, month = first, second
            elif second > 12:
                month, day = first, second
            else:
                day, month = first, second
        date_value = datetime.date(year, month, day)
        current_year = timezone.localdate().year
        if date_value.year < 1900 or date_value.year > current_year:
            return ''
        return date_value.isoformat()
    except (TypeError, ValueError):
        return ''
def resolve_column_indices(header):
    """Resolve both legacy sheets and the official two-row candidate template."""
    idx = {}
    for i, title in enumerate(header):
        nh = normalise_str(title)
        if 'code' not in idx and ('mahoso' in nh or 'maft' in nh):
            idx['code'] = i
        elif 'timestamp' not in idx and ('thoigian' in nh or 'timestamp' in nh):
            idx['timestamp'] = i
        elif 'stt' not in idx and (nh == 'stt' or nh.startswith('sott') or nh.endswith('stt')):
            idx['stt'] = i
        elif 'name' not in idx and ('hovantenthisinh' in nh or 'hovaten' in nh or 'thisinh' in nh or nh == 'ten'):
            idx['name'] = i
        elif 'amount' not in idx and ('sotiendanop' in nh or 'lephi' in nh or nh == 'tien'):
            idx['amount'] = i
        elif 'invoice' not in idx and ('hoadon' in nh or 'hoadien' in nh):
            idx['invoice'] = i
        elif 'contests' not in idx and ('kythidangky' in nh or 'dangkythi' in nh or 'dangthi' in nh or 'contest' in nh or 'kythi' in nh):
            idx['contests'] = i
        elif 'subject' not in idx and ('monthi' in nh or 'linhvuc' in nh):
            idx['subject'] = i
        elif 'category' not in idx and ('bangthi' in nh or 'category' in nh):
            idx['category'] = i
        elif 'registrationMethod' not in idx and ('hinhthucdangky' in nh or 'registrationmethod' in nh):
            idx['registrationMethod'] = i
        elif 'registrationUnit' not in idx and ('donvidangky' in nh or 'registrationunit' in nh):
            idx['registrationUnit'] = i
        elif 'teamName' not in idx and ('tendoinhom' in nh or 'doinhom' in nh or 'teamname' in nh):
            idx['teamName'] = i
        elif 'examLanguage' not in idx and ('ngonnguthi' in nh or 'examlanguage' in nh):
            idx['examLanguage'] = i
        elif 'generalNote' not in idx and ('ghichuchung' in nh or nh.endswith('ghichu') or 'generalnote' in nh):
            idx['generalNote'] = i
        elif 'certificateLink' not in idx and ('linkchungnhan' in nh or 'certificatelink' in nh):
            idx['certificateLink'] = i
        elif 'highestRound' not in idx and ('vongcaonhatdadat' in nh or 'highestround' in nh):
            idx['highestRound'] = i
        elif 'achievement' not in idx and ('ketquacaonhat' in nh or 'ketquathanhthich' in nh or 'achievement' in nh):
            idx['achievement'] = i
        elif 'updated' not in idx and ('ngaycapnhatgannhat' in nh or nh == 'updated'):
            idx['updated'] = i
        elif 'className' not in idx and ('hocsinhlop' in nh or ('lop' in nh and 'khoi' not in nh)):
            idx['className'] = i
        elif 'dob' not in idx and ('ngaythangnamsinh' in nh or 'namsinh' in nh or 'ngaysinh' in nh or 'dob' in nh or 'birthday' in nh):
            idx['dob'] = i
        elif 'grade' not in idx and ('khoithi' in nh or 'khoilop' in nh or nh == 'khoi'):
            idx['grade'] = i
        elif 'school' not in idx and ('truong' in nh and 'email' not in nh):
            idx['school'] = i
        elif 'cccd' not in idx and ('cccd' in nh or 'canchuan' in nh or 'dinhdanh' in nh or 'identity' in nh or 'cmnd' in nh):
            idx['cccd'] = i
        elif 'nationality' not in idx and ('quoctich' in nh or 'nationality' in nh):
            idx['nationality'] = i
        elif 'parent' not in idx and ('hotenphuhuynh' in nh or 'phuhuynh' in nh or 'parent' in nh):
            idx['parent'] = i
        elif 'streetAddress' not in idx and ('diachinh' in nh or 'diachinharieng' in nh):
            idx['streetAddress'] = i
        elif 'ward' not in idx and ('xaphuong' in nh or 'phuongxa' in nh or nh == 'phuong' or nh == 'xa'):
            idx['ward'] = i
        elif 'city' not in idx and ('tinhthanhpho' in nh or 'tinh' in nh or 'thanhpho' in nh or 'city' in nh):
            idx['city'] = i
        elif 'fullAddress' not in idx and ('diachilienhe' in nh or nh == 'diachi' or 'diachidaydu' in nh or 'address' in nh):
            idx['fullAddress'] = i
        elif 'email' not in idx and 'email' in nh:
            idx['email'] = i
        elif 'emailStatus' not in idx and ('tinhtranggui' in nh or 'guiemail' in nh):
            idx['emailStatus'] = i
        elif 'phone' not in idx and ('dienthoai' in nh or 'sdt' in nh or 'phone' in nh or 'giamho' in nh):
            idx['phone'] = i
        elif 'paymentStatus' not in idx and ('chuyenkhoan' in nh or 'noplephi' in nh or 'tinhtrangnop' in nh or 'thanhtoan' in nh):
            idx['paymentStatus'] = i
        elif 'note' not in idx and ('ghichusuco' in nh or nh == 'note' or 'ghichu' in nh):
            idx['note'] = i

    is_am_format = len(header) <= 15 or idx.get('contests') == 12
    if is_am_format:
        defaults = {'timestamp': 0, 'name': 1, 'dob': 2, 'className': 3, 'school': 4, 'city': 5, 'phone': 6, 'email': 7, 'cccd': 8, 'fullAddress': 9, 'paymentStatus': 10, 'note': 11, 'contests': 12}
    elif len(header) <= 25:
        defaults = {'timestamp': 0, 'stt': 1, 'name': 2, 'amount': 3, 'invoice': 4, 'contests': 5, 'className': 6, 'dob': 7, 'grade': 8, 'school': 9, 'cccd': 10, 'streetAddress': 11, 'ward': 12, 'city': 13, 'fullAddress': 14, 'email': 15, 'emailStatus': 16, 'phone': 17, 'paymentStatus': 18, 'note': 19}
    else:
        defaults = {}
    for key, value in defaults.items():
        idx.setdefault(key, value)
    return idx
ROUND_HISTORY_FIELD_MAP = {
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


def occurrence_id_from_history(round_config, occurrence_id='', exam_date=''):
    explicit = clean_txt(occurrence_id)
    if explicit:
        return explicit
    date_value = clean_txt(exam_date)
    slots = (round_config or {}).get('slots') or []
    for slot in slots:
        if isinstance(slot, dict) and date_value and clean_txt(slot.get('date')) == date_value:
            return clean_txt(slot.get('id'))
    if len(slots) == 1 and isinstance(slots[0], dict):
        return clean_txt(slots[0].get('id'))
    return ''


def merged_headers(grid, header_index):
    group_row = grid[header_index - 1] if header_index > 0 else []
    current_group = ''
    inline_round_group = ''
    headers = []
    for index, label in enumerate(grid[header_index]):
        group = clean_txt(group_row[index]) if index < len(group_row) else ''
        if group:
            current_group = group
        title = clean_txt(label)
        normalized_title = normalise_str(title)
        if any(normalized_title.startswith(f'vong{number}') for number in (1, 2, 3)):
            inline_round_group = round_group_from_header(title)
        elif normalized_title.startswith('tonghop'):
            inline_round_group = ''
        if inline_round_group and title and not any(normalized_title.startswith(f'vong{number}') for number in (1, 2, 3)):
            title = f"{inline_round_group}: {title}"
        headers.append(f"{current_group}: {title}" if current_group and title else title)
    return headers


def round_group_from_header(header):
    raw = clean_txt(header)
    if ':' in raw:
        return raw.split(':', 1)[0].strip()
    field_labels = (
        'Điều kiện tham gia', 'Số báo danh (SBD)', 'Số báo danh', 'Ngày thi', 'Giờ/Ca thi',
        'Hình thức thi', 'Địa điểm/Phòng thi', 'Link thi', 'Tài khoản/Mã truy cập',
        'Mật khẩu', 'Trạng thái dự thi', 'Điểm', 'Tỷ lệ điểm', 'Xếp hạng',
        'Kết quả/Giải thưởng', 'Ghi chú/Sự cố',
    )
    for label in field_labels:
        match = re.search(rf'\s+{re.escape(label)}\s*$', raw, flags=re.IGNORECASE)
        if match:
            return raw[:match.start()].strip()
    return raw


ROUND_TEMPLATE_FIELD_ORDER = (
    'eligibility', 'sbd', 'date', 'time', 'mode', 'location', 'link', 'account',
    'password', 'attendance', 'score', 'scoreRate', 'rank', 'result', 'note',
)
ROUND_FIELD_ALIASES = {
    'eligibility': ['dieukienduthi', 'dieukien'], 'sbd': ['sobaodanh', 'sbd'],
    'date': ['ngaythi'], 'time': ['giocathi', 'giothi'], 'mode': ['hinhthucthi'],
    'location': ['diadiemphongthi', 'diadiemthi'], 'link': ['linkthi'],
    'account': ['taikhoanmatruycap', 'taikhoan'], 'password': ['matkhau', 'password'],
    'attendance': ['trangthaiduthi', 'trangthaithamgia'], 'scoreRate': ['tylediem'],
    'score': ['diem'], 'rank': ['xephang'], 'result': ['ketquagiaithuong', 'ketqua'],
    'note': ['ghichusuco', 'ghichu'],
}


def _round_name_from_group(source_group, number):
    detailed_name = clean_txt(source_group)
    parts = re.split(r'\s*[-\u2013\u2014]\s*', detailed_name, maxsplit=1)
    if len(parts) == 2 and normalise_str(parts[0]).startswith(f'vong{number}'):
        detailed_name = parts[1].strip()
    elif normalise_str(detailed_name) == f'vong{number}':
        detailed_name = ''
    return detailed_name or ('V\u00f2ng ' + str(number))


def _is_official_round_layout(headers):
    """Official template columns are fixed: V:AJ, AK:AY, AZ:BN.

    Repeated labels such as Ng\u00e0y thi or \u0110i\u1ec3m are therefore resolved by their
    A1 position, not by the first matching label.
    """
    if len(headers) < 66:
        return False
    starts = (21, 36, 51)
    return all(
        index < len(headers) and normalise_str(headers[index]).endswith('dieukienthamgia')
        for index in starts
    )


def history_from_sheet_row(headers, row):
    rounds = []
    if _is_official_round_layout(headers):
        for number, start in enumerate((21, 36, 51), start=1):
            values, columns = {}, {}
            source_group = round_group_from_header(headers[start])
            for offset, key in enumerate(ROUND_TEMPLATE_FIELD_ORDER):
                index = start + offset
                value = clean_txt(row[index]) if index < len(row) else ''
                if value:
                    values[key] = value
                    columns[key] = _column_name(index)
            if values:
                values['eligibility'] = normalize_eligibility(values.get('eligibility'))
                values['round'] = _round_name_from_group(source_group, number)
                values['templateSlot'] = number
                values['templateColumns'] = columns
                rounds.append(values)
        return rounds

    # Legacy/custom Sheet: retain header parsing, but remember the exact A1
    # columns that were selected so a later review can explain every mapping.
    for number in (1, 2, 3):
        prefix = f"vong{number}"
        values, columns = {}, {}
        source_group = ''
        for index, header in enumerate(headers):
            if index >= len(row):
                continue
            normalized = normalise_str(header)
            if not normalized.startswith(prefix):
                continue
            if not source_group:
                source_group = round_group_from_header(header)
            value = clean_txt(row[index])
            if not value:
                continue
            for key, aliases in ROUND_FIELD_ALIASES.items():
                matches = (
                    normalized.endswith('diem') and 'diadiem' not in normalized and 'tylediem' not in normalized
                    if key == 'score'
                    else any(alias in normalized for alias in aliases)
                )
                if matches:
                    values[key] = value
                    columns[key] = _column_name(index)
                    break
        if values:
            values['eligibility'] = normalize_eligibility(values.get('eligibility'))
            values['round'] = _round_name_from_group(source_group, number)
            values['templateSlot'] = number
            values['templateColumns'] = columns
            rounds.append(values)
    return rounds

def sync_candidate_payload(candidate):
    """Return the same record shape accepted by the reviewed import endpoint."""
    return {
        'code': candidate.get('code', ''), 'name': candidate.get('name', ''),
        'birthDate': candidate.get('birth_date', ''), 'identity': candidate.get('identity', ''),
        'email': candidate.get('email', ''), 'phone': candidate.get('phone', ''),
        'school': candidate.get('school', ''), 'className': candidate.get('class_name', ''),
        'city': candidate.get('city', ''), 'ward': candidate.get('ward', ''),
        'nationality': candidate.get('nationality', ''), 'grade': candidate.get('grade', ''),
        'address': candidate.get('address', ''), 'contests': candidate.get('contests', ''),
        'achievement': candidate.get('achievement', ''), 'highestRound': candidate.get('highest_round', ''),
        'parent': candidate.get('parent', ''), 'updated': candidate.get('updated', ''),
        'subject': candidate.get('registration', {}).get('subject', ''),
        'category': candidate.get('registration', {}).get('category', ''),
        'registrationMethod': candidate.get('registration', {}).get('registrationMethod', ''),
        'registrationUnit': candidate.get('registration', {}).get('registrationUnit', ''),
        'teamName': candidate.get('registration', {}).get('teamName', ''),
        'examLanguage': candidate.get('registration', {}).get('examLanguage', ''),
        'generalNote': candidate.get('registration', {}).get('generalNote', ''),
        'certificateLink': candidate.get('registration', {}).get('certificateLink', ''),
        'examHistory': candidate.get('exam_history', []),
    }


def build_sheet_preview(incoming, headers, columns, raw, session_id, source_url, sheet_tab='', source_row_offset=1, update_mode='replace-nonempty', import_empty_values=True):
    existing = list(Candidate.objects.all())
    # Compare against memberships in this session, not every historic profile.
    session_candidates = list(Candidate.objects.filter(participations__session_id=session_id).distinct()) if session_id else []
    session_candidate_ids = {candidate.id for candidate in session_candidates}
    matched_session_candidate_ids = set()
    created = matched = conflicts = changed = unchanged = 0
    rows = []
    profile_fields = (
        ('name', 'name', 'Họ và tên'), ('birth_date', 'birth_date', 'Ngày sinh'), ('identity', 'identity', 'CCCD/Hộ chiếu'), ('email', 'email', 'Email'),
        ('phone', 'phone', 'Số điện thoại'), ('school', 'school', 'Trường'), ('class_name', 'class_name', 'Lớp'), ('city', 'city', 'Tỉnh/Thành phố'),
        ('ward', 'ward', 'Xã/Phường'), ('nationality', 'nationality', 'Quốc tịch'), ('grade', 'grade', 'Khối lớp'), ('address', 'address', 'Địa chỉ'),
        ('achievement', 'achievement', 'Kết quả cao nhất'), ('highest_round', 'highest_round', 'Vòng cao nhất đã đạt'), ('parent', 'parent', 'Phụ huynh'),
    )
    for source_index, item in enumerate(incoming, start=source_row_offset):
        assessments = []
        for candidate in existing:
            assessment = candidate_match_assessment({
                'name': candidate.name, 'birth_date': candidate.birth_date, 'identity': candidate.identity,
                'email': candidate.email, 'phone': candidate.phone, 'school': candidate.school,
                'class_name': candidate.class_name, 'city': candidate.city, 'ward': candidate.ward,
                'address': candidate.address,
            }, item)
            if assessment:
                assessments.append((candidate, assessment))
        confirmed = [(candidate, assessment) for candidate, assessment in assessments if assessment['status'] == 'confirmed']
        same_code = next((candidate for candidate in existing if item.get('code') and candidate.code.upper() == item['code'].upper()), None)
        base = confirmed[0][0] if len(confirmed) == 1 else same_code
        possible = [(candidate, assessment) for candidate, assessment in assessments if assessment['status'] == 'possible']
        # Mirror the selected import policy. The old implementation always
        # previewed fill-empty changes, even though the default policy replaces
        # non-empty source values.
        changed_fields = []
        changes = []

        def add_change(field, label, current, incoming_value):
            current_value = clean_txt(current)
            next_value = clean_txt(incoming_value)
            can_write = next_value and (
                not current_value if update_mode == 'fill-empty'
                else (import_empty_values or bool(current_value))
            )
            same_percentage = field.endswith('.scoreRate') and format_sheet_percentage(current_value) == format_sheet_percentage(next_value)
            if can_write and current_value != next_value and not same_percentage:
                changed_fields.append(field)
                changes.append({'field': field, 'label': label, 'current': current_value, 'next': next_value})

        if base:
            matched += 1
            if base.id in session_candidate_ids:
                matched_session_candidate_ids.add(base.id)
            for model_field, incoming_field, label in profile_fields:
                incoming_value = clean_txt(item.get(incoming_field))
                add_change(model_field, label, getattr(base, model_field), incoming_value)
            participation = CandidateParticipation.objects.filter(candidate=base, session_id=session_id).prefetch_related('round_results').first() if session_id else None
            if not participation:
                add_change('session', 'Kỳ tổ chức', '', 'Thêm vào kỳ tổ chức')
            else:
                registration_fields = {
                    'subject': 'subject', 'category': 'category', 'registrationMethod': 'registration_method',
                    'registrationUnit': 'registration_unit', 'teamName': 'team_name', 'examLanguage': 'exam_language',
                    'generalNote': 'general_note', 'certificateLink': 'certificate_link',
                }
                for incoming_field, model_field in registration_fields.items():
                    incoming_value = clean_txt((item.get('registration') or {}).get(incoming_field))
                    add_change(f'registration.{incoming_field}', incoming_field, getattr(participation, model_field), incoming_value)
                existing_rounds = list(participation.round_results.all())
                for history_index, history_item in enumerate(item.get('exam_history') or []):
                    incoming_round = clean_txt(history_item.get('round'))
                    existing_round = next((round_item for round_item in existing_rounds if clean_txt(round_item.round_name).casefold() == incoming_round.casefold()), None)
                    if not existing_round and history_index < len(existing_rounds):
                        existing_round = existing_rounds[history_index]
                    if not existing_round:
                        add_change(f'round.{incoming_round}', incoming_round or 'Vòng thi', '', 'Thêm dữ liệu vòng')
                        continue
                    for payload_field, model_field in ROUND_HISTORY_FIELD_MAP.items():
                        incoming_value = clean_txt(history_item.get(payload_field))
                        if payload_field == 'date' and incoming_value:
                            incoming_value = parse_dob(incoming_value) or incoming_value
                        add_change(
                            f'round.{incoming_round}.{payload_field}',
                            f'{incoming_round or "V?ng thi"} · {payload_field}',
                            getattr(existing_round, model_field), incoming_value,
                        )
            if changed_fields:
                changed += 1
            else:
                unchanged += 1
        is_conflict = len(confirmed) > 1 or (not base and possible)
        if is_conflict:
            conflicts += 1
            if base:
                matched -= 1
                if changed_fields:
                    changed -= 1
                else:
                    unchanged -= 1
        elif not base:
            created += 1
        payload = sync_candidate_payload(item)
        payload['_preview'] = {
            'sourceRow': source_index,
            'status': 'conflict' if is_conflict else ('new' if not base else ('changed' if changed_fields else 'unchanged')),
            'matchedCode': base.code if base else '',
            'changedFields': changed_fields,
            'changes': changes,
        }
        rows.append(payload)

    # Do not hide the other side of a count mismatch. These people are already
    # in the selected session on Fermat but have no safe counterpart in Sheet.
    # Import does not remove them automatically.
    web_only_records = [
        {
            'code': candidate.code,
            'name': candidate.name,
            'birthDate': candidate.birth_date or '',
            'identity': candidate.identity or '',
            'email': candidate.email or '',
            'phone': candidate.phone or '',
            'school': candidate.school or '',
            'className': candidate.class_name or '',
        }
        for candidate in session_candidates
        if candidate.id not in matched_session_candidate_ids
    ]

    mapped = []
    used_indices = set()
    for field, index in columns.items():
        if isinstance(index, int) and 0 <= index < len(headers):
            mapped.append({'field': field, 'column': headers[index], 'index': index + 1})
            used_indices.add(index)
    for index, header in enumerate(headers):
        normalized = normalise_str(header)
        if index not in used_indices and any(normalized.startswith(f'vong{number}') for number in (1, 2, 3)):
            mapped.append({'field': 'examHistory', 'column': header, 'index': index + 1})
            used_indices.add(index)
    round_groups = []
    for header in headers:
        group = round_group_from_header(header)
        if normalise_str(group).startswith('vong') and group not in round_groups:
            round_groups.append(group)
    warnings = []
    if 'name' not in columns:
        warnings.append('Không nhận diện được cột Họ và tên thí sinh.')
    if not any(field in columns for field in ('cccd', 'email', 'phone')):
        warnings.append('Không có CCCD, email hoặc số điện thoại; việc đối chiếu hồ sơ trùng sẽ kém chính xác.')
    if conflicts:
        warnings.append(f'Có {conflicts} hồ sơ cần người dùng xác nhận trước khi nhập.')
    return {
        'success': True,
        'records': rows,
        'summary': {
            'total': len(rows), 'new': created, 'matched': matched, 'changed': changed,
            'unchanged': unchanged, 'conflicts': conflicts,
            'webOnly': len(web_only_records),
        },
        'webOnlyRecords': web_only_records,
        'mapping': {
            'headerCount': len(headers), 'mapped': mapped,
            'unmapped': [header for index, header in enumerate(headers) if header and index not in used_indices],
            'roundGroups': round_groups,
        },
        'warnings': warnings,
        'source': {
            'url': source_url, 'sheetTab': sheet_tab,
            'fingerprint': hashlib.sha256(raw.encode('utf-8')).hexdigest(),
        },
    }


def upsert_participation_history(candidate, session_id, history, source='', registration=None):
    if not session_id:
        return None
    session = ExamSession.objects.filter(id=session_id).first()
    if not session:
        return None
    participation, _ = CandidateParticipation.objects.get_or_create(
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
        value = clean_txt(registration.get(payload_field))
        if value:
            setattr(participation, model_field, value)
            updates.append(model_field)
    if registration:
        participation.registration_data = {str(key): value for key, value in registration.items() if value not in (None, '')}
        updates.append('registration_data')
    if updates:
        participation.save(update_fields=list(set(updates)) + ['updated_at'])
    configured_rounds = [item for item in (session.rounds or []) if isinstance(item, dict)]
    for position, item in enumerate(history or []):
        if not isinstance(item, dict):
            continue
        round_name = clean_txt(item.get('round'))
        if not round_name:
            continue
        values = {
            model_field: clean_txt(item.get(payload_field))
            for payload_field, model_field in ROUND_HISTORY_FIELD_MAP.items()
        }
        if values.get('eligibility'):
            values['eligibility'] = normalize_eligibility(values['eligibility'])
        if values.get('exam_date'):
            values['exam_date'] = parse_dob(values['exam_date']) or values['exam_date']
        round_config = next((config for config in configured_rounds if clean_txt(config.get('name')).casefold() == round_name.casefold()), configured_rounds[position] if position < len(configured_rounds) else {})
        values['round_id'] = clean_txt(item.get('roundId')) or clean_txt(round_config.get('id'))
        values['occurrence_id'] = occurrence_id_from_history(round_config, values.get('occurrence_id'), values.get('exam_date'))
        values['raw_data'] = {str(key): value for key, value in item.items() if value not in (None, '')}
        existing_result = RoundResult.objects.filter(participation=participation, round_id=values['round_id'], occurrence_id=values['occurrence_id']).first() if values['round_id'] and values['occurrence_id'] else RoundResult.objects.filter(participation=participation, round_name=round_name, occurrence_id=values['occurrence_id']).first()
        if existing_result:
            for model_field in ROUND_HISTORY_FIELD_MAP.values():
                if not values.get(model_field):
                    values[model_field] = getattr(existing_result, model_field)
        if existing_result:
            for key, value in values.items():
                setattr(existing_result, key, value)
            existing_result.save()
        else:
            RoundResult.objects.create(participation=participation, round_name=round_name, **values)
    return participation

def append_existing_candidate_link_note(candidate, session_id, previous_session_ids):
    """Leave a readable trace when an import reuses a profile in another session."""
    session = ExamSession.objects.filter(id=session_id).first()
    if not session:
        return
    previous_sessions = list(ExamSession.objects.filter(id__in=previous_session_ids).exclude(id=session_id).values_list('code', 'name'))
    previous_label = ', '.join(f'{code} · {name}' for code, name in previous_sessions) or 'chưa có kỳ tổ chức khác được ghi nhận'
    LogNote.objects.create(
        key=f'candidate-{candidate.code}:import-link:{uuid.uuid4().hex}',
        entity_key=f'candidate-{candidate.code}',
        content=f'Hệ thống nhận diện hồ sơ đã có. Đã bổ sung dữ liệu vào kỳ tổ chức {session.code} · {session.name}. Thí sinh đã từng thi: {previous_label}.',
        updated_by='Hệ thống FT Workspace',
        system=True,
    )
def sync_session_candidate_totals():
    sessions = ExamSession.objects.all()
    totals = {}
    for session_id in CandidateParticipation.objects.values_list('session_id', flat=True):
        totals[session_id] = totals.get(session_id, 0) + 1

    # Preserve older imports until their data migration has linked them.
    if not totals:
        sessions_by_code = {}
        for session in sessions:
            sessions_by_code.setdefault(clean_txt(session.code).upper(), []).append(session.id)
        for candidate in Candidate.objects.all():
            linked = list(candidate.session_ids or [])
            if not linked:
                for code in get_contest_codes(candidate.contests):
                    linked.extend(sessions_by_code.get(code, []))
            for session_id in set(linked):
                totals[session_id] = totals.get(session_id, 0) + 1

    for session in sessions:
        next_count = totals.get(session.id, 0)
        if session.candidates_count == next_count:
            continue
        session.candidates_count = next_count
        session.save(update_fields=['candidates_count', 'updated_at'])

PROFILE_EXPORT_HEADERS = [
    'STT', 'Mã hồ sơ', 'Họ và tên thí sinh', 'Ngày sinh', 'Số CCCD/Hộ chiếu', 'Quốc tịch',
    'Họ tên phụ huynh', 'Số điện thoại', 'Email', 'Tỉnh/Thành phố', 'Xã/phường', 'Địa chỉ liên hệ',
    'Trường', 'Lớp đang học (ví dụ: 6A1)', 'Khối lớp',
]
REGISTRATION_EXPORT_HEADERS = ['Môn thi/Lĩnh vực', 'Bảng thi/Category', 'Hình thức đăng ký', 'Tên đội/Nhóm', 'Ngôn ngữ thi', 'Ghi chú']
ROUND_EXPORT_HEADERS = [
    'Điều kiện tham gia', 'Số báo danh (SBD)', 'Ngày thi', 'Giờ/Ca thi', 'Hình thức thi', 'Địa điểm/Phòng thi',
    'Link thi', 'Tài khoản/Mã truy cập', 'Mật khẩu', 'Trạng thái dự thi', 'Điểm', 'Tỷ lệ điểm', 'Xếp hạng',
    'Kết quả/Giải thưởng', 'Ghi chú/Sự cố',
]
SUMMARY_EXPORT_HEADERS = ['Vòng cao nhất đã đạt', 'Kết quả cao nhất', 'Link chứng nhận', 'Ngày cập nhật gần nhất']
EXPORT_HEADERS = PROFILE_EXPORT_HEADERS + REGISTRATION_EXPORT_HEADERS + ROUND_EXPORT_HEADERS * 3 + SUMMARY_EXPORT_HEADERS
EXPORT_GROUP_HEADERS = (
    ['HỒ SƠ THÍ SINH'] + [''] * (len(PROFILE_EXPORT_HEADERS) - 1)
    + ['THÔNG TIN ĐĂNG KÝ'] + [''] * (len(REGISTRATION_EXPORT_HEADERS) - 1)
    + ['VÒNG 1'] + [''] * (len(ROUND_EXPORT_HEADERS) - 1)
    + ['VÒNG 2'] + [''] * (len(ROUND_EXPORT_HEADERS) - 1)
    + ['VÒNG 3'] + [''] * (len(ROUND_EXPORT_HEADERS) - 1)
    + ['TỔNG HỢP'] + [''] * (len(SUMMARY_EXPORT_HEADERS) - 1)
)

def _round_slots(round_results, configured_rounds):
    """Place a result in the configured template slot, never by DB ordering."""
    slots = {}
    by_id = {clean_txt(item.get('id')): index for index, item in enumerate(configured_rounds, start=1) if clean_txt(item.get('id'))}
    by_name = {normalise_str(item.get('name')): index for index, item in enumerate(configured_rounds, start=1) if normalise_str(item.get('name'))}
    leftovers = []
    for item in round_results:
        slot = by_id.get(clean_txt(item.round_id)) or by_name.get(normalise_str(item.round_name))
        if not slot:
            match = re.search(r'(?<!\d)([1-3])(?!\d)', clean_txt(item.round_name))
            slot = int(match.group(1)) if match else None
        if slot and slot not in slots and slot <= 3:
            slots[slot] = item
        else:
            leftovers.append(item)
    for number in (1, 2, 3):
        if number not in slots and leftovers:
            slots[number] = leftovers.pop(0)
    return slots


def _session_highest_round(slots, configured_rounds):
    if not slots:
        return ''
    slot = max(slots)
    config = configured_rounds[slot - 1] if slot <= len(configured_rounds) else {}
    name = clean_txt(config.get('name')) or clean_txt(slots[slot].round_name)
    return f'V\u00f2ng {slot} \u2013 {name}' if name else f'V\u00f2ng {slot}'

def session_candidate_sort_key(candidate):
    """Sort a session roster by grade, then the culturally appropriate given name."""
    grade_source = clean_txt(candidate.grade) or clean_txt(candidate.class_name)
    grade_match = re.search(r'\d+', grade_source)
    grade = int(grade_match.group()) if grade_match else 999
    words = [word for word in re.split(r'\s+', clean_txt(candidate.name)) if word]
    nationality = normalise_str(candidate.nationality)
    # Empty nationality remains Vietnamese for the existing SCO data. For an
    # overseas record, use its first name instead of applying Vietnamese order.
    is_vietnamese = not nationality or nationality in {'vietnam', 'viet nam'}
    given_name = words[-1] if is_vietnamese and words else (words[0] if words else '')
    return (grade, normalise_str(given_name), normalise_str(candidate.name), normalise_str(candidate.code))

def format_sheet_date(value):
    """Write dates in the Vietnamese template's stable DD/MM/YYYY display format."""
    parsed = parse_dob(value)
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', parsed):
        return datetime.date.fromisoformat(parsed).strftime('%d/%m/%Y')
    return clean_txt(value)


def format_sheet_percentage(value):
    """Use a decimal comma for a simple percentage in Vietnamese Google Sheets."""
    raw = clean_txt(value)
    match = re.fullmatch(r'([+-]?\d+)[\.,](\d+)(\s*%)?', raw)
    if not match:
        return raw
    return f'{match.group(1)},{match.group(2)}{match.group(3) or ""}'


def session_export_rows(session_id):
    """Build a re-importable export matching the official candidate template."""
    session = ExamSession.objects.filter(id=session_id).first()
    configured_rounds = [item for item in ((session.rounds if session else []) or []) if isinstance(item, dict)]
    rows = [EXPORT_GROUP_HEADERS, EXPORT_HEADERS]
    participations = list(
        CandidateParticipation.objects.filter(session_id=session_id)
        .select_related('candidate')
        .prefetch_related('round_results')
    )
    participations.sort(key=lambda item: session_candidate_sort_key(item.candidate))
    for sequence, participation in enumerate(participations, start=1):
        candidate = participation.candidate
        row = [
            sequence, candidate.code, candidate.name, format_sheet_date(candidate.birth_date), candidate.identity or '', candidate.nationality or '',
            candidate.parent or '', candidate.phone or '', candidate.email or '', candidate.city or '', candidate.ward or '', candidate.address or '',
            candidate.school or '', candidate.class_name or '', candidate.grade or '',
            participation.subject or '', participation.category or '', participation.registration_method or '', participation.team_name or '',
            participation.exam_language or '', participation.general_note or '',
        ]
        slots = _round_slots(list(participation.round_results.all()), configured_rounds)
        for number in (1, 2, 3):
            result = slots.get(number)
            if not result:
                row.extend([''] * len(ROUND_EXPORT_HEADERS))
                continue
            row.extend([
                result.eligibility, result.sbd, format_sheet_date(result.exam_date), result.time_slot, result.mode, result.location,
                result.link, result.account, result.password, result.attendance, result.score, format_sheet_percentage(result.score_rate),
                result.rank, result.result, result.note,
            ])
        row.extend([_session_highest_round(slots, configured_rounds), candidate.achievement or '', participation.certificate_link or '', candidate.updated or ''])
        rows.append(row)
    return rows

def _sheet_range_title(title):
    return "'" + title.replace("'", "''") + "'"


def _column_name(index):
    """Return the familiar A1 column name for a zero-based index."""
    name = ''
    number = index + 1
    while number:
        number, remainder = divmod(number - 1, 26)
        name = chr(65 + remainder) + name
    return name


def _output_sheet_target(sheet, service):
    """Resolve the existing output tab, never creating a new tab."""
    spreadsheet_id = extract_spreadsheet_id(sheet.url)
    metadata = service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields='sheets(properties(sheetId,title))',
    ).execute()
    tabs = [item.get('properties', {}) for item in metadata.get('sheets', [])]
    parsed_url = urllib.parse.urlparse(clean_txt(sheet.url))
    query = urllib.parse.parse_qs(parsed_url.query)
    fragment = urllib.parse.parse_qs(parsed_url.fragment)
    gid = (query.get('gid') or fragment.get('gid') or [''])[0]
    if gid:
        for tab in tabs:
            if str(tab.get('sheetId')) == str(gid):
                requested_title = clean_txt(sheet.sheet_tab)
                if requested_title and tab.get('title') != requested_title:
                    raise ValueError(
                        f'Link \u0111ang tr\u1ecf \u0111\u1ebfn tab \u201c{tab.get("title")}\u201d (gid={gid}) nh\u01b0ng t\u00ean tab \u0111\u00e3 khai b\u00e1o l\u00e0 '
                        f'\u201c{requested_title}\u201d. H\u00e3y s\u1eeda t\u00ean tab ho\u1eb7c d\u00e1n \u0111\u00fang li\u00ean k\u1ebft c\u1ee7a tab c\u1ea7n xu\u1ea5t.'
                    )
                return tab
        raise ValueError('Li\u00ean k\u1ebft Google Sheet c\u00f3 gid nh\u01b0ng kh\u00f4ng t\u00ecm th\u1ea5y tab t\u01b0\u01a1ng \u1ee9ng.')
    requested_title = clean_txt(sheet.sheet_tab)
    if requested_title:
        for tab in tabs:
            if tab.get('title') == requested_title:
                return tab
        raise ValueError(f'Kh\u00f4ng t\u00ecm th\u1ea5y tab \u201c{requested_title}\u201d trong Google Sheet \u0111\u00e3 li\u00ean k\u1ebft.')
    raise ValueError('Sheet t\u1ed5ng h\u1ee3p ch\u01b0a khai b\u00e1o tab. H\u00e3y ch\u1ecdn \u0111\u00fang tab c\u1ea7n xu\u1ea5t; h\u1ec7 th\u1ed1ng s\u1ebd kh\u00f4ng t\u1ef1 t\u1ea1o tab m\u1edbi.')


def _export_row_record(row):
    """Return only identity fields needed to align a Sheet row with a candidate."""
    def value(index):
        return clean_txt(row[index]) if index < len(row) else ''
    return {
        'code': value(1),
        'name': value(2),
        'birth_date': parse_dob(value(3)) or value(3),
        'identity': value(4),
        'phone': value(7),
        'email': value(8),
    }


def _row_identity_description(record):
    labels = (
        ('code', 'M\u00e3 h\u1ed3 s\u01a1'), ('name', 'H\u1ecd t\u00ean'), ('birth_date', 'Ng\u00e0y sinh'),
        ('identity', 'CCCD/H\u1ed9 chi\u1ebfu'), ('email', 'Email'), ('phone', 'S\u1ed1 \u0111i\u1ec7n tho\u1ea1i'),
    )
    return ' \u00b7 '.join(f'{label}: {record[key]}' for key, label in labels if clean_txt(record.get(key))) or 'Kh\u00f4ng c\u00f3 th\u00f4ng tin \u0111\u1ecbnh danh'


def _candidate_options_for_sheet_row(sheet_record, proposed_rows):
    options = []
    for candidate_row in proposed_rows:
        candidate_record = _export_row_record(candidate_row)
        same_name = same_nonempty(sheet_record['name'], candidate_record['name'])
        same_contact = any((
            normalized_identity(sheet_record['identity']) and normalized_identity(sheet_record['identity']) == normalized_identity(candidate_record['identity']),
            normalized_email(sheet_record['email']) and normalized_email(sheet_record['email']) == normalized_email(candidate_record['email']),
            normalized_phone(sheet_record['phone']) and normalized_phone(sheet_record['phone']) == normalized_phone(candidate_record['phone']),
        ))
        if same_name or same_contact:
            options.append(_row_identity_description(candidate_record))
    return options[:5]


def _match_conflict(row, sheet_record, reason, proposed_rows):
    return {
        'row': row,
        'rowLabel': sheet_record['name'] or f'H\u00e0ng d\u1eef li\u1ec7u {row}',
        'reason': reason,
        'sheetIdentity': _row_identity_description(sheet_record),
        'candidateOptions': _candidate_options_for_sheet_row(sheet_record, proposed_rows),
    }


def _export_row_match(sheet_row, candidate_row):
    """Return a safe, deterministic row match without relying on sort order."""
    sheet_record = _export_row_record(sheet_row)
    candidate_record = _export_row_record(candidate_row)
    sheet_code, candidate_code = clean_txt(sheet_record['code']).upper(), clean_txt(candidate_record['code']).upper()
    if sheet_code and candidate_code:
        if sheet_code == candidate_code:
            return 100, 'm\u00e3 h\u1ed3 s\u01a1'
        return None

    name_matches = same_nonempty(sheet_record['name'], candidate_record['name'])
    if not name_matches:
        return None
    sheet_birth = parse_dob(sheet_record['birth_date']) or clean_txt(sheet_record['birth_date'])
    candidate_birth = parse_dob(candidate_record['birth_date']) or clean_txt(candidate_record['birth_date'])
    if sheet_birth and candidate_birth and sheet_birth != candidate_birth:
        return None
    identity_matches = normalized_identity(sheet_record['identity']) and normalized_identity(sheet_record['identity']) == normalized_identity(candidate_record['identity'])
    email_matches = normalized_email(sheet_record['email']) and normalized_email(sheet_record['email']) == normalized_email(candidate_record['email'])
    phone_matches = normalized_phone(sheet_record['phone']) and normalized_phone(sheet_record['phone']) == normalized_phone(candidate_record['phone'])
    if identity_matches:
        return 95, 'h\u1ecd t\u00ean v\u00e0 CCCD/H\u1ed9 chi\u1ebfu'
    if email_matches:
        return 90, 'h\u1ecd t\u00ean v\u00e0 email'
    if phone_matches:
        return 88, 'h\u1ecd t\u00ean v\u00e0 s\u1ed1 \u0111i\u1ec7n tho\u1ea1i'
    if sheet_birth and candidate_birth and sheet_birth == candidate_birth:
        return 80, 'h\u1ecd t\u00ean v\u00e0 ng\u00e0y sinh'
    return 50, 'h\u1ecd t\u00ean duy nh\u1ea5t'


def _aligned_export_rows(current_rows, session_id):
    """Align output to existing Sheet people; never use the Sheet row order as identity.

    Row 1 is the group label and row 2 is the immutable column header. This
    function receives data rows only (starting at row 3). Existing unmatched
    Sheet rows are retained. System candidates that have no Sheet counterpart
    are appended, while ambiguous or missing matches block an overwrite.
    """
    proposed_rows = session_export_rows(session_id)[2:]
    remaining = set(range(len(proposed_rows)))
    aligned_rows = [list(row) for row in current_rows]
    matched_rows = 0
    appended_rows = 0
    appended_values = []
    unmatched_sheet_rows = []
    conflicts = []

    for row_index, sheet_row in enumerate(current_rows):
        if not any(clean_txt(value) for value in sheet_row):
            continue
        sheet_record = _export_row_record(sheet_row)
        candidates = []
        for candidate_index in remaining:
            match = _export_row_match(sheet_row, proposed_rows[candidate_index])
            if match:
                score, reason = match
                candidates.append((score, candidate_index, reason))
        if not candidates:
            row = row_index + 3
            unmatched_sheet_rows.append(row)
            conflicts.append(_match_conflict(
                row, sheet_record,
                'Kh\u00f4ng t\u00ecm th\u1ea5y h\u1ed3 s\u01a1 trong h\u1ec7 th\u1ed1ng kh\u1edbp an to\u00e0n v\u1edbi d\u00f2ng Sheet n\u00e0y. D\u00f2ng s\u1ebd kh\u00f4ng b\u1ecb ghi \u0111\u00e8.',
                proposed_rows,
            ))
            continue
        highest = max(score for score, _, _ in candidates)
        best = [(candidate_index, reason) for score, candidate_index, reason in candidates if score == highest]
        if len(best) != 1:
            conflicts.append(_match_conflict(
                row_index + 3, sheet_record,
                'C\u00f3 nhi\u1ec1u th\u00ed sinh c\u00f9ng kh\u1edbp; c\u1ea7n m\u00e3 h\u1ed3 s\u01a1 ho\u1eb7c th\u00f4ng tin \u0111\u1ecbnh danh \u0111\u1ec3 ph\u00e2n bi\u1ec7t.',
                [proposed_rows[index] for index, _ in best],
            ))
            continue
        candidate_index, reason = best[0]
        if highest == 50:
            same_name_count = sum(1 for candidate_row in proposed_rows if same_nonempty(_export_row_record(sheet_row)['name'], _export_row_record(candidate_row)['name']))
            if same_name_count != 1:
                conflicts.append(_match_conflict(
                    row_index + 3, sheet_record,
                    'Tr\u00f9ng h\u1ecd t\u00ean nh\u01b0ng thi\u1ebfu ng\u00e0y sinh ho\u1eb7c th\u00f4ng tin \u0111\u1ecbnh danh \u0111\u1ec3 gh\u00e9p an to\u00e0n.',
                    proposed_rows,
                ))
                continue
        replacement = list(proposed_rows[candidate_index])
        # The Sheet owns its display order, so its STT stays with the existing row.
        if sheet_row and clean_txt(sheet_row[0]):
            replacement[0] = sheet_row[0]
        aligned_rows[row_index] = replacement
        remaining.remove(candidate_index)
        matched_rows += 1

    existing_stt = [int(clean_txt(row[0])) for row in current_rows if row and clean_txt(row[0]).isdigit()]
    next_stt = max(existing_stt, default=0) + 1

    # Do not append a possible duplicate. It is safer to pause and ask for a
    # stable identifier than to create a second record for the same person.
    for candidate_index in sorted(remaining):
        candidate_row = proposed_rows[candidate_index]
        candidate_record = _export_row_record(candidate_row)
        possible_rows = [index + 3 for index, sheet_row in enumerate(current_rows) if same_nonempty(_export_row_record(sheet_row)['name'], candidate_record['name'])]
        if possible_rows:
            row = possible_rows[0]
            conflicts.append(_match_conflict(
                row, _export_row_record(current_rows[row - 3]),
                'C\u00f3 c\u00f9ng h\u1ecd t\u00ean tr\u00ean Sheet nh\u01b0ng kh\u00f4ng \u0111\u1ee7 th\u00f4ng tin \u0111\u1ec3 gh\u00e9p an to\u00e0n.',
                [candidate_row],
            ))
            continue
        appended = list(candidate_row)
        appended[0] = next_stt
        next_stt += 1
        aligned_rows.append(appended)
        appended_values.append(appended)
        appended_rows += 1

    return {
        'values': aligned_rows,
        'matchedRows': matched_rows,
        'appendedRows': appended_rows,
        'appendedValues': appended_values,
        'unmatchedSheetRows': unmatched_sheet_rows,
        'matchConflicts': conflicts,
        'systemRows': len(proposed_rows),
    }

def sheet_values_fingerprint(values):
    """Stable fingerprint used to detect edits made in an output Sheet."""
    payload = json.dumps(values or [], ensure_ascii=False, separators=(',', ':'))
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


AUTO_OVERWRITE_EXPORT_HEADERS = {'Ng\u00e0y c\u1eadp nh\u1eadt g\u1ea7n nh\u1ea5t'}
DATE_EXPORT_HEADERS = {'Ng\u00e0y sinh', 'Ng\u00e0y thi'}
PERCENT_EXPORT_HEADERS = {'T\u1ef7 l\u1ec7 \u0111i\u1ec3m'}


def _sheet_values_equivalent(before, after, field):
    if clean_txt(before) == clean_txt(after):
        return True
    if field in DATE_EXPORT_HEADERS:
        before_date, after_date = parse_dob(before), parse_dob(after)
        return bool(before_date and after_date and before_date == after_date)
    if field in PERCENT_EXPORT_HEADERS:
        return format_sheet_percentage(before) == format_sheet_percentage(after)
    return False


def output_sheet_export_preview(sheet, google_access_token=None, max_changes=250):
    """Compare data rows only; Sheet rows 1 and 2 are never overwritten.

    Empty Sheet cells filled from the system and the automatic update timestamp
    are written without appearing as a conflict. Existing non-empty values that
    would change are the only cells requiring explicit confirmation.
    """
    session = ExamSession.objects.filter(id=sheet.session_id).first()
    if not session:
        raise ValueError('Kh\u00f4ng t\u00ecm th\u1ea5y k\u1ef3 t\u1ed5 ch\u1ee9c \u0111\u01b0\u1ee3c g\u1eafn v\u1edbi ngu\u1ed3n Google Sheets.')
    spreadsheet_id = extract_spreadsheet_id(sheet.url)
    if not spreadsheet_id:
        raise ValueError('Li\u00ean k\u1ebft Google Sheets kh\u00f4ng h\u1ee3p l\u1ec7.')
    config = SystemConfig.objects.filter(key='main').first()
    config_data = config.data if config else {}
    saved_token = config.last_google_access_token if config else None
    service = build_sheets_service(google_access_token or saved_token, config_data or {})
    target = _output_sheet_target(sheet, service)
    tab_name = target.get('title')
    range_title = _sheet_range_title(tab_name)
    current = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id, range=f'{range_title}!A3:ZZ',
    ).execute().get('values', [])
    alignment = _aligned_export_rows(current, session.id)
    proposed = alignment['values']
    changes, changed_rows = [], set()
    write_changed_cells = 0
    review_changed_cells = 0
    for row_index in range(max(len(current), len(proposed))):
        before_row = current[row_index] if row_index < len(current) else []
        after_row = proposed[row_index] if row_index < len(proposed) else []
        sheet_row = row_index + 3
        record_row = after_row or before_row
        profile_code = str(record_row[1]) if len(record_row) > 1 and record_row[1] else ''
        candidate_name = str(record_row[2]) if len(record_row) > 2 and record_row[2] else ''
        record_label = ' \u00b7 '.join(item for item in [profile_code, candidate_name] if item) or f'H\u00e0ng d\u1eef li\u1ec7u {sheet_row}'
        for column_index in range(max(len(before_row), len(after_row))):
            before = str(before_row[column_index]) if column_index < len(before_row) else ''
            after = str(after_row[column_index]) if column_index < len(after_row) else ''
            if before == after:
                continue
            write_changed_cells += 1
            field = str(EXPORT_HEADERS[column_index]) if len(EXPORT_HEADERS) > column_index else _column_name(column_index)
            # New values, formatting-equivalent values, and the timestamp do
            # not need operator review; they are still included in the write.
            needs_review = bool(clean_txt(before)) and field not in AUTO_OVERWRITE_EXPORT_HEADERS and not _sheet_values_equivalent(before, after, field)
            if not needs_review:
                continue
            review_changed_cells += 1
            changed_rows.add(sheet_row)
            if len(changes) < max_changes:
                column = _column_name(column_index)
                changes.append({
                    'row': sheet_row,
                    'rowLabel': record_label,
                    'column': column,
                    'field': field or column,
                    'cell': f'{column}{sheet_row}',
                    'current': before,
                    'next': after,
                })
    return {
        'currentFingerprint': sheet_values_fingerprint(current), 'sheetTab': tab_name,
        'currentRows': len(current), 'proposedRows': len(proposed),
        'changedCells': review_changed_cells, 'changedRows': len(changed_rows),
        'writeChangedCells': write_changed_cells,
        'changes': changes, 'changesTruncated': review_changed_cells > len(changes),
        'hasExistingData': bool(current), 'hasChanges': bool(write_changed_cells or alignment['unmatchedSheetRows']),
        'hasReviewChanges': bool(review_changed_cells),
        **{key: alignment[key] for key in ('matchedRows', 'appendedRows', 'unmatchedSheetRows', 'matchConflicts', 'systemRows')},
        'appendedCandidates': [_export_row_record(row) for row in alignment['appendedValues']],
    }

def remote_sheet_fingerprint(sheet, google_access_token=None):
    spreadsheet_id = extract_spreadsheet_id(sheet.url)
    if not spreadsheet_id:
        raise ValueError('Li?n k?t Google Sheets kh?ng h?p l?.')
    session = ExamSession.objects.filter(id=sheet.session_id).first()
    if not session:
        raise ValueError('Kh?ng t?m th?y k? t? ch?c ???c g?n v?i Google Sheets.')
    config = SystemConfig.objects.filter(key='main').first()
    config_data = config.data if config else {}
    saved_token = config.last_google_access_token if config else None
    try:
        service = build_sheets_service(google_access_token or saved_token, config_data or {})
        tab_name = _output_sheet_target(sheet, service).get('title')
        values = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f'{_sheet_range_title(tab_name)}!A3:ZZ',
        ).execute().get('values', [])
        return sheet_values_fingerprint(values)
    except Exception as api_error:
        # A publicly shared Sheet can be safely reviewed/imported even when
        # this server has no Google API credential. Use its exported CSV as a
        # stable stale-preview guard; writes still require the Sheets API.
        try:
            return public_sheet_fingerprint(sheet.url, sheet.sheet_tab)
        except Exception as public_error:
            raise ValueError(
                f'Kh?ng th? ki?m tra phi?n b?n hi?n t?i c?a Google Sheet. '
                f'Google Sheets API: {api_error}; ??c c?ng khai: {public_error}'
            ) from public_error


def tab_content_fingerprint(sheet, google_access_token=None):
    """Fingerprint every populated cell of the configured tab, including headers."""
    spreadsheet_id = extract_spreadsheet_id(sheet.url)
    if not spreadsheet_id:
        raise ValueError('Liên kết Google Sheets không hợp lệ.')
    try:
        return 'csv:' + public_sheet_fingerprint(sheet.url, sheet.sheet_tab)
    except Exception as exc:
        public_failure = exc
    config = SystemConfig.objects.filter(key='main').first()
    config_data = config.data if config else {}
    saved_token = config.last_google_access_token if config else None
    try:
        service = build_sheets_service(google_access_token or saved_token, config_data or {})
        metadata = service.spreadsheets().get(
            spreadsheetId=spreadsheet_id, fields='sheets(properties(title))',
        ).execute()
        names = [item.get('properties', {}).get('title') for item in metadata.get('sheets', [])]
        tab_name = sheet.sheet_tab or next((name for name in names if name), '')
        if tab_name not in names:
            raise ValueError(f'Không tìm thấy tab {tab_name}.')
        values = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=f'{_sheet_range_title(tab_name)}!A1:ZZ',
        ).execute().get('values', [])
        return 'api:' + sheet_values_fingerprint(values)
    except Exception as api_error:
        raise ValueError(
            f'Không đọc được tab {sheet.sheet_tab or "đầu tiên"}: '
            f'CSV công khai: {public_failure}; Google API: {api_error}'
        ) from api_error

def export_session_to_google_sheet(sheet, google_access_token=None, export_mode='merge', append_candidate_codes=None):
    session = ExamSession.objects.filter(id=sheet.session_id).first()
    if not session:
        raise ValueError('Không tìm thấy kỳ tổ chức được gắn với nguồn Google Sheets.')
    spreadsheet_id = extract_spreadsheet_id(sheet.url)
    if not spreadsheet_id:
        raise ValueError('Liên kết Google Sheets không hợp lệ.')

    config = SystemConfig.objects.filter(key='main').first()
    config_data = config.data if config else {}
    saved_token = config.last_google_access_token if config else None
    service = build_sheets_service(google_access_token or saved_token, config_data or {})
    tab_name = _output_sheet_target(sheet, service).get('title')

    range_title = _sheet_range_title(tab_name)
    current = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f'{range_title}!A3:ZZ',
    ).execute().get('values', [])
    alignment = _aligned_export_rows(current, session.id)
    if export_mode not in {'merge', 'append-only'}:
        raise ValueError('Invalid export mode.')
    selected_codes = {clean_txt(code).upper() for code in (append_candidate_codes or []) if clean_txt(code)}
    appended_codes = {clean_txt(_export_row_record(row)['code']).upper() for row in alignment['appendedValues']}
    # An omitted selection means all new candidates. A supplied selection is
    # authoritative: unticked web-only candidates are not added to Sheet.
    skipped_appended_codes = appended_codes - selected_codes if append_candidate_codes is not None else set()
    values = [
        row for row in session_export_rows(session.id)[2:]
        if clean_txt(_export_row_record(row)['code']).upper() not in skipped_appended_codes
    ]
    values_to_write = [
        row for row in alignment['appendedValues']
        if clean_txt(_export_row_record(row)['code']).upper() not in skipped_appended_codes
    ] if export_mode == 'append-only' else values
    start_row = len(current) + 3 if export_mode == 'append-only' else 3
    if export_mode == 'merge':
        # A normal export is authoritative for the output tab: rows only in
        # Sheet disappear when the web roster is smaller.
        service.spreadsheets().values().clear(
            spreadsheetId=spreadsheet_id,
            range=f'{range_title}!A3:ZZ',
            body={},
        ).execute()
    if values_to_write:
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f'{range_title}!A{start_row}',
            valueInputOption='RAW',
            body={'values': values_to_write},
        ).execute()
    exported_count = len(values_to_write) if export_mode == 'append-only' else len(values)
    resulting_values = [*current, *values_to_write] if export_mode == 'append-only' else values
    return {
        'success': True,
        'sessionId': session.id,
        'sheetTab': tab_name,
        'exported': exported_count,
        'fingerprint': sheet_values_fingerprint(resulting_values),
        'message': '\u0110\u00e3 xu\u1ea5t {} h\u1ed3 s\u01a1 sang Google Sheets.'.format(exported_count),
    }


def canonical_import_sheet_url(spreadsheet_url, sheet_tab=''):
    """Point a tab-selected import at that tab's stable gid before CSV export.

    The Google Visualization endpoint with ``sheet=...`` can return a pivoted
    result for some complex tabs.  Reading the tab by gid through the regular
    export endpoint always preserves the spreadsheet grid (rows stay rows).
    """
    requested_tab = clean_txt(sheet_tab)
    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url)
    if not requested_tab or not spreadsheet_id:
        return spreadsheet_url
    try:
        config = SystemConfig.objects.filter(key='main').first()
        config_data = config.data if config else {}
        saved_token = config.last_google_access_token if config else None
        service = build_sheets_service(saved_token, config_data or {})
        metadata = service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            fields='sheets(properties(sheetId,title))',
        ).execute()
        target = next(
            (
                item.get('properties', {})
                for item in metadata.get('sheets', [])
                if clean_txt(item.get('properties', {}).get('title')) == requested_tab
            ),
            None,
        )
        if target and target.get('sheetId') is not None:
            return f'https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit?gid={target["sheetId"]}'
    except Exception:
        # Keep the configured URL as a fallback for public-only sheets.
        pass
    return spreadsheet_url


def get_google_sheet_csv_urls(spreadsheet_url, sheet_tab=''):
    parsed_source = urllib.parse.urlparse(clean_txt(spreadsheet_url))
    if parsed_source.scheme != 'https' or parsed_source.hostname != 'docs.google.com' or not parsed_source.path.startswith('/spreadsheets/'):
        return []
    urls = []
    if '/d/e/' in spreadsheet_url:
        pub_url = spreadsheet_url
        if pub_url.endswith('/pubhtml') or pub_url.endswith('/pub'):
            pub_url = re.sub(r'/pub(html)?$', '/pub?output=csv', pub_url)
        elif 'output=csv' not in pub_url:
            pub_url = pub_url.split('?')[0] + '/pub?output=csv'
        urls.append(pub_url)
        
    sheet_id = ''
    id_match = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', spreadsheet_url)
    if not id_match:
        id_match = re.search(r'[?&]id=([a-zA-Z0-9-_]+)', spreadsheet_url)
    if id_match:
        sheet_id = id_match.group(1)
        
    if sheet_id and sheet_id != 'e':
        gid_match = re.search(r'[?&#]gid=([0-9]+)', spreadsheet_url)
        gid_param = f"&gid={gid_match.group(1)}" if gid_match else ''

        if clean_txt(sheet_tab) and gid_match:
            # Prefer the grid export. Unlike gviz?sheet=..., this does not
            # pivot a tab whose headers/merged cells are complex.
            urls.append(f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv{gid_param}")
            urls.append(f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv{gid_param}")
        elif clean_txt(sheet_tab):
            encoded_tab = urllib.parse.quote(clean_txt(sheet_tab), safe='')
            urls.append(f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={encoded_tab}")
        else:
            urls.append(f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv{gid_param}")
            urls.append(f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv{gid_param}")
            urls.append(f"https://docs.google.com/spreadsheets/d/{sheet_id}/pub?output=csv{gid_param}")
        
    return urls



def public_sheet_fingerprint(spreadsheet_url, sheet_tab=''):
    """Fingerprint the exact public CSV used by the import preview."""
    spreadsheet_url = canonical_import_sheet_url(spreadsheet_url, sheet_tab)
    last_error = None
    for csv_url in get_google_sheet_csv_urls(spreadsheet_url, sheet_tab):
        try:
            response = requests.get(csv_url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            }, timeout=15)
            if response.status_code in [401, 403]:
                raise ValueError('Sheet ch?a m? quy?n xem c?ng khai.')
            response.raise_for_status()
            response.encoding = 'utf-8'
            content = response.text.strip()
            if not content or 'accounts.google.com' in response.url or content.startswith('<!DOCTYPE html') or content.startswith('<html'):
                raise ValueError('Sheet y?u c?u ??ng nh?p Google ho?c kh?ng c? d? li?u c?ng khai.')
            return hashlib.sha256(response.text.encode('utf-8')).hexdigest()
        except Exception as exc:
            last_error = exc
    raise ValueError(str(last_error or 'Kh?ng ??c ???c CSV c?ng khai c?a Google Sheet.'))


def sync_single_sheet(spreadsheet_url, ts_vn, sheet_doc_id=None, session_id=None, preview=False, sheet_tab='', preview_update_mode='replace-nonempty', preview_import_empty_values=True):
    def update_state(data):
        if sheet_doc_id:
            try:
                sheet = ExaminationSheet.objects.get(id=sheet_doc_id)
                sheet.status = data.get('status', sheet.status)
                if 'error' in data:
                    pass  # ExaminationSheet has no note field
                sheet.updated_at = timezone.now()
                sheet.save()
            except Exception:
                pass

    try:
        spreadsheet_url = canonical_import_sheet_url(spreadsheet_url, sheet_tab)
        candidate_urls = get_google_sheet_csv_urls(spreadsheet_url, sheet_tab)
        if not candidate_urls:
            raise Exception('Đường dẫn Google Sheets không hợp lệ.')
            
        raw = ''
        last_error = None
        
        for csv_url in candidate_urls:
            try:
                res = requests.get(csv_url, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                }, timeout=15)
                
                if res.status_code in [401, 403]:
                    raise Exception('Sheet chưa mở quyền truy cập công khai. Vui lòng chia sẻ công khai.')
                res.raise_for_status()
                
                res.encoding = 'utf-8'
                trimmed = res.text.strip()
                if 'accounts.google.com' in res.url or 'ServiceLogin' in res.url or trimmed.startswith('<!DOCTYPE html') or trimmed.startswith('<html'):
                    raise Exception('Sheet yêu cầu đăng nhập Google (Chưa mở quyền công khai).')
                if not trimmed:
                    raise Exception('Google Sheets trả về nội dung trống.')
                    
                raw = res.text
                last_error = None
                break
            except Exception as err:
                last_error = err
                if 'quyền truy cập' in str(err) or 'đăng nhập' in str(err):
                    break
                    
        if not raw and last_error:
            raise last_error
            
        # Parse CSV
        f = io.StringIO(raw)
        reader = csv.reader(f)
        grid = list(reader)
        
        if len(grid) < 2:
            raise Exception('Không tìm thấy dữ liệu trong tệp (cần ít nhất 1 dòng tiêu đề + 1 dòng dữ liệu).')
            
        header_candidates = []
        for index in range(min(len(grid), 20)):
            candidate_header = merged_headers(grid, index)
            candidate_columns = resolve_column_indices(candidate_header)
            if 'name' in candidate_columns:
                header_candidates.append((len(candidate_columns), index))
        header_index = max(header_candidates, default=(0, 0))[1]
        header_row = merged_headers(grid, header_index)
        col = resolve_column_indices(header_row)
        
        incoming = []
        session_code = clean_txt(ExamSession.objects.filter(id=session_id).values_list('code', flat=True).first()) if session_id else ''
        for row in grid[header_index + 1:]:
            if not row:
                continue

            def value(field):
                index = col.get(field)
                return clean_txt(row[index]) if index is not None and index < len(row) else ''

            name = format_person_name(value('name'))
            if not name:
                continue
            raw_contests = value('contests')
            contests = merge_contest_codes(raw_contests, session_code)
            amount, invoice, payment_status = value('amount'), value('invoice'), value('paymentStatus')
            legacy_achievement = []
            if amount:
                legacy_achievement.append(f"Lệ phí: {amount}")
            if payment_status and payment_status != '—':
                legacy_achievement.append(payment_status)
            if invoice and invoice != 'x':
                legacy_achievement.append(f"HĐ: {invoice}")
            registration = {
                'subject': value('subject'), 'category': value('category'), 'registrationMethod': value('registrationMethod'),
                'registrationUnit': value('registrationUnit'), 'teamName': value('teamName'), 'examLanguage': value('examLanguage'),
                'generalNote': value('generalNote'), 'certificateLink': value('certificateLink'),
            }
            cand = {
                'code': value('code'), 'name': name, 'birth_date': parse_dob(value('dob')), 'identity': re.sub(r'\D', '', value('cccd')),
                'email': value('email'), 'phone': re.sub(r'[^\d+]', '', value('phone')), 'school': value('school'),
                'class_name': value('className'), 'city': value('city'), 'ward': value('ward'), 'nationality': value('nationality'),
                'grade': value('grade'), 'address': value('fullAddress') or ', '.join(filter(None, [value('streetAddress'), value('ward'), value('city')])),
                'contests': contests, 'achievement': value('achievement') or ' | '.join(legacy_achievement), 'highest_round': value('highestRound'),
                'parent': format_person_name(value('parent')), 'updated': value('updated') or ts_vn, 'registration': registration,
                'exam_history': history_from_sheet_row(header_row, row),
            }
            incoming.append(cand)
            if len(incoming) > 1000:
                raise Exception('Mỗi lần chỉ được xử lý tối đa 1.000 hồ sơ. Hãy chia tab nguồn thành nhiều đợt nhỏ hơn.')
        if not incoming:
            if preview:
                result = build_sheet_preview([], header_row, col, raw, session_id, spreadsheet_url, sheet_tab, header_index + 2, preview_update_mode, preview_import_empty_values)
                result['sessionId'] = session_id or ''
                result['timestamp'] = ts_vn
                result['warnings'].append('Không có hồ sơ hợp lệ nào trong tab đã chọn.')
                return result
            if not preview:
                update_state({'status': 'success', 'error': None})
            return {
                'success': True,
                'message': 'Không có hồ sơ hợp lệ nào trong tệp.',
                'created': 0,
                'updated': 0,
                'total': 0,
                'timestamp': ts_vn
            }

        if preview:
            result = build_sheet_preview(incoming, header_row, col, raw, session_id, spreadsheet_url, sheet_tab, header_index + 2, preview_update_mode, preview_import_empty_values)
            result['sessionId'] = session_id or ''
            result['timestamp'] = ts_vn
            return result
            
        # Perform Sync
        existing = list(Candidate.objects.all())
        existing_codes_set = {candidate.code for candidate in existing}
        created = 0
        updated = 0
        linked_existing = 0
        for cand in incoming:
            candidate_assessments = []
            for candidate in existing:
                assessment = candidate_match_assessment({
                    'name': candidate.name, 'birth_date': candidate.birth_date, 'identity': candidate.identity,
                    'email': candidate.email, 'phone': candidate.phone, 'school': candidate.school,
                    'class_name': candidate.class_name, 'city': candidate.city, 'ward': candidate.ward, 'address': candidate.address,
                }, cand)
                if assessment:
                    candidate_assessments.append((candidate, assessment))
            confirmed = [(candidate, assessment) for candidate, assessment in candidate_assessments if assessment['status'] == 'confirmed']
            matched, matched_assessment = confirmed[0] if len(confirmed) == 1 else (None, None)
            same_code = next((candidate for candidate in existing if cand['code'] and candidate.code.upper() == cand['code'].upper()), None)
            base = matched or same_code
            if base:
                before_values = {field: getattr(base, field) for field in ('name', 'birth_date', 'identity', 'email', 'phone', 'school', 'class_name', 'city', 'ward', 'nationality', 'grade', 'address', 'achievement', 'highest_round', 'parent')}
                previous_session_ids = list(base.session_ids or [])
                already_in_target_session = session_id in previous_session_ids or CandidateParticipation.objects.filter(candidate=base, session_id=session_id).exists()
                base.name = cand['name']
                for field, key in [('birth_date', 'birth_date'), ('identity', 'identity'), ('email', 'email'), ('phone', 'phone'), ('school', 'school'), ('class_name', 'class_name'), ('city', 'city'), ('ward', 'ward'), ('nationality', 'nationality'), ('grade', 'grade'), ('address', 'address'), ('achievement', 'achievement'), ('highest_round', 'highest_round')]:
                    if cand[key] and (field != 'birth_date' or should_replace_birth_date(base.birth_date, cand[key])):
                        setattr(base, field, cand[key])
                if cand['parent']:
                    base.parent = cand['parent']
                base.contests = merge_contest_codes(base.contests, cand['contests'])
                linked_sessions = list(base.session_ids or [])
                if session_id and session_id not in linked_sessions:
                    linked_sessions.append(session_id)
                base.session_ids = linked_sessions
                base.updated = ts_vn
                base.sort_key = f"{base.name.lower()}_{base.identity or base.id}"
                base.save()
                upsert_participation_history(base, session_id, cand['exam_history'], spreadsheet_url, cand['registration'])
                if matched:
                    labels = {
                        'name': 'họ tên', 'birth_date': 'ngày sinh', 'identity': 'CCCD/Hộ chiếu', 'email': 'email',
                        'phone': 'số điện thoại', 'school': 'trường', 'class_name': 'lớp', 'city': 'tỉnh/thành phố',
                        'ward': 'xã/phường', 'nationality': 'quốc tịch', 'grade': 'khối lớp', 'address': 'địa chỉ',
                        'achievement': 'thành tích', 'highest_round': 'vòng cao nhất', 'parent': 'phụ huynh',
                    }
                    changes = [
                        f'Đã cập nhật {labels[field]} từ "{before_values[field] or "chưa có thông tin"}" thành "{getattr(base, field) or "chưa có thông tin"}".'
                        for field in labels if before_values[field] != getattr(base, field)
                    ]
                    if changes:
                        LogNote.objects.create(
                            key=f'candidate-{base.code}:import-update:{uuid.uuid4().hex}',
                            entity_key=f'candidate-{base.code}',
                            content=f'Hệ thống tự nhận diện hồ sơ trùng theo {matched_assessment["reason"]}.\n' + '\n'.join(changes),
                            updated_by='Hệ thống FT Workspace', system=True,
                        )
                if not already_in_target_session:
                    linked_existing += 1
                    append_existing_candidate_link_note(base, session_id, previous_session_ids)
                updated += 1
                continue

            code = cand['code'].replace('/', '-').replace('?', '-').replace('#', '-').strip().upper() if cand['code'] else ''
            if not code or code in existing_codes_set:
                code = next_code(existing_codes_set)
            new_candidate = Candidate.objects.create(
                id=code, code=code, name=cand['name'], school=cand['school'], class_name=cand['class_name'], city=cand['city'], ward=cand['ward'],
                nationality=cand['nationality'], grade=cand['grade'], contests=cand['contests'], achievement=cand['achievement'], highest_round=cand['highest_round'],
                email=cand['email'], parent=cand['parent'], phone=cand['phone'], identity=cand['identity'], address=cand['address'], birth_date=cand['birth_date'],
                session_ids=[session_id] if session_id else [], updated=ts_vn, sort_key=f"{cand['name'].lower()}_{cand['identity'] or code}",
            )
            upsert_participation_history(new_candidate, session_id, cand['exam_history'], spreadsheet_url, cand['registration'])
            existing.append(new_candidate)
            existing_codes_set.add(code)
            created += 1
        sync_session_candidate_totals()
        update_state({'status': 'success', 'error': None})
        
        return {
            'success': True,
            'message': f"Đồng bộ thành công – Thêm mới: {created}, Cập nhật: {updated}, Hồ sơ đã có được bổ sung kỳ tổ chức: {linked_existing}, Tổng: {len(incoming)}",
            'created': created,
            'updated': updated,
            'linkedExisting': linked_existing,
            'total': len(incoming),
            'timestamp': ts_vn
        }
    except Exception as e:
        msg = str(e)
        if not preview:
            update_state({'status': 'failed', 'error': msg})
        return {
            'success': False,
            'message': f"Lỗi: {msg}",
            'created': 0,
            'updated': 0,
            'total': 0,
            'timestamp': ts_vn
        }

def sync_examination_from_google_sheet(spreadsheet_url=None, session_id=None, sheet_doc_id=None, sheet_tab=''):
    ts_vn = datetime.datetime.now().strftime('%d/%m/%Y %H:%M:%S')
    
    # helper to update system config state
    def update_global_state(data):
        try:
            config, _ = SystemConfig.objects.get_or_create(key='examination_sync_state')
            current = config.data or {}
            current.update(data)
            config.data = current
            config.save()
        except Exception:
            pass

    if spreadsheet_url:
        result = sync_single_sheet(spreadsheet_url, ts_vn, sheet_doc_id, session_id, sheet_tab=sheet_tab)
        update_global_state({
            'status': 'success' if result['success'] else 'failed',
            'lastSyncDate': ts_vn.split(' ')[0],
            'lastSyncTime': ts_vn,
            'lastSheetUrl': spreadsheet_url,
            'created': result['created'],
            'updated': result['updated'],
            'total': result['total'],
            'message': result['message'],
            'error': None if result['success'] else result['message']
        })
        return result
        
    # Else sync all configured sheets
    try:
        # The global sync is an input operation. Output/summary Sheets are
        # imported only through the explicit manual review flow.
        sheets = list(ExaminationSheet.objects.filter(stage='registration-source'))
        if not sheets:
            return {
                'success': False,
                'message': 'Chưa có tab nguồn nào được cấu hình.',
                'created': 0,
                'updated': 0,
                'total': 0,
                'timestamp': ts_vn,
            }

        unassigned = [sheet.name for sheet in sheets if not sheet.session_id]
        if unassigned:
            return {
                'success': False,
                'message': 'Có tab nguồn chưa được gắn với kỳ tổ chức: ' + ', '.join(unassigned),
                'created': 0,
                'updated': 0,
                'total': 0,
                'timestamp': ts_vn,
            }

        total_created = 0
        total_updated = 0
        total_candidates = 0
        success_count = 0
        error_messages = []
        
        for sheet in sheets:
            sheet.status = 'running'
            sheet.save()
            
            res = sync_single_sheet(sheet.url, ts_vn, sheet.id, sheet.session_id or None, sheet_tab=sheet.sheet_tab)
            if res['success']:
                total_created += res['created']
                total_updated += res['updated']
                total_candidates += res['total']
                success_count += 1
            else:
                error_messages.append(f"{sheet.name}: {res['message']}")
                
        status_text = f"Đã đồng bộ {success_count}/{len(sheets)} nguồn dữ liệu. (Tổng thêm mới: {total_created}, Cập nhật: {total_updated})"
        status = 'failed' if len(error_messages) == len(sheets) else 'success'
        
        update_global_state({
            'status': status,
            'lastSyncDate': ts_vn.split(' ')[0],
            'lastSyncTime': ts_vn,
            'created': total_created,
            'updated': total_updated,
            'total': total_candidates,
            'message': status_text,
            'error': '; '.join(error_messages) if error_messages else None
        })
        
        return {
            'success': status == 'success',
            'message': status_text,
            'created': total_created,
            'updated': total_updated,
            'total': total_candidates,
            'timestamp': ts_vn
        }
    except Exception as e:
        msg = str(e)
        update_global_state({
            'status': 'failed',
            'error': msg,
            'lastSyncTime': ts_vn
        })
        return {
            'success': False,
            'message': f"Lỗi: {msg}",
            'created': 0,
            'updated': 0,
            'total': 0,
            'timestamp': ts_vn
        }
