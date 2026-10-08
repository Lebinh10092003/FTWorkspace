"""Preview and atomically import the standardized school registration workbook."""
import hashlib
import io
import itertools
import json
import re
import unicodedata
import uuid
import zipfile
from collections import Counter
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

import openpyxl
from django.core import signing
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from authentication.models import SystemConfig
from authentication.permissions import IsAuthenticated
from .models import Candidate, CandidateParticipation, ExamRoom, ExamSession, ExaminationBillingRecord, RoundResult, SchoolRegistration
from .sheet_publication import session_academic_year
from .sync import candidate_match_assessment, format_identity, format_phone, format_person_name, merge_contest_codes, next_code, parse_dob, resolve_column_indices, sync_session_candidate_totals, valid_candidate_name


def norm(value):
    text = ''.join(c for c in unicodedata.normalize('NFD', str(value or '').casefold()) if unicodedata.category(c) != 'Mn').replace('đ', 'd')
    return re.sub(r'[^a-z0-9]+', ' ', text).strip()


def cell_text(value):
    if isinstance(value, (datetime, date)):
        return value.date().isoformat() if isinstance(value, datetime) else value.isoformat()
    return unicodedata.normalize('NFC', str(value if value is not None else '')).strip()


SCHOOL_METADATA_LABELS = (
    # (normalised label prefix, field); first match wins.
    ('ten truong', 'school'), ('dia chi nhan chung nhan', ''), ('dia chi', 'address'),
    ('chuc vu', 'position'), ('nguoi phu trach', 'representative'), ('thong tin lien he', 'contact'),
    ('so dien thoai', 'phone'), ('email', 'email'), ('ma so thue', 'taxCode'), ('loai hinh', ''),
)
PLACEHOLDER_VALUES = {'truong tieu hoc thcs trung tam to chuc khac'}


def metadata_field(value):
    label = norm(value)
    return next((field for prefix, field in SCHOOL_METADATA_LABELS if label.startswith(prefix)), None)


def read_school_metadata(row, metadata):
    """Read "label | value" pairs from the school information block.

    Official templates use labels without a colon (``Tên trường học/tổ chức``),
    sometimes put two pairs on one row (``Người phụ trách … Chức vụ …``) or free
    text such as ``Số điện thoại: 0356…`` / ``Email: a@b`` in the value cells.
    """
    cells = [cell_text(value) for value in row]
    for index, label in enumerate(cells):
        field = metadata_field(label) if label else None
        if not field:
            continue
        rest = [cell for cell in cells[index + 1:] if cell]
        inline = label.split(':', 1)[1].strip() if ':' in label else ''
        value = inline or next((cell for cell in rest if metadata_field(cell) is None), '')
        if field in {'contact', 'phone', 'email'}:
            text = ' '.join([inline, *rest]) if field == 'contact' else value
            phone = re.search(r'(?<![\w@])0?\d[\d .]{7,12}\d', text) if field != 'email' else None
            email = re.search(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+', text) if field != 'phone' else None
            if phone:
                metadata.setdefault('phone', re.sub(r'\D', '', phone.group(0)))
            if email:
                metadata.setdefault('email', email.group(0).rstrip('.'))
            continue
        if not value or norm(value) in PLACEHOLDER_VALUES:
            continue
        if field == 'representative' and ':' in value:
            name = re.search(r't[eê]n\s*:\s*([^.;]+)', value, re.IGNORECASE)
            position = re.search(r'ch[uứ]c v[uụ]\s*:\s*([^.;]+)', value, re.IGNORECASE)
            if name:
                metadata.setdefault('representative', name.group(1).strip())
            if position:
                metadata.setdefault('position', position.group(1).strip())
            continue
        metadata.setdefault(field, value)


def parse_fee(value):
    """Read "500.000VNĐ", "250,000 đ" or 500000 as an integer amount in VND."""
    digits = re.sub(r'\D', '', str(value or ''))
    if not digits:
        raise InvalidOperation
    amount = int(digits)
    if not 0 < amount <= 999999999999:
        raise InvalidOperation
    return amount


def split_fee(total, contests, known_fees):
    """Split one fee across several contests of the same row, or return None.

    Uses per-contest fees learnt from the file: an exact match, or all but one
    known with the remainder for the last. Without fee hints an even split is
    used when it divides exactly.
    """
    known = {contest: known_fees[norm(contest)] for contest in contests if norm(contest) in known_fees}
    if len(known) == len(contests):
        return known if sum(known.values()) == total else None
    if len(known) == len(contests) - 1:
        remainder = total - sum(known.values())
        return known | {next(c for c in contests if c not in known): remainder} if remainder > 0 else None
    if not known and total % len(contests) == 0:
        return {contest: total // len(contests) for contest in contests}
    return None


def read_workbook(content, sheet_name=''):
    if len(content) > 10 * 1024 * 1024:
        raise ValueError('File Excel tối đa 10 MB.')
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if sum(item.file_size for item in archive.infolist()) > 50 * 1024 * 1024:
                raise ValueError('File Excel sau giải nén quá lớn.')
        workbook = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except (zipfile.BadZipFile, OSError, KeyError) as exc:
        raise ValueError('Không đọc được file .xlsx.') from exc
    try:
        tables = []
        metadata = {}
        for sheet in workbook:
            # Google Sheets exports omit the dimension record (max_row is None
            # in read-only mode), so count while reading instead.
            grid = list(itertools.islice(sheet.values, 10001))
            if len(grid) > 10000 or any(len(row) > 200 for row in grid):
                raise ValueError('Mỗi tab tối đa 10.000 dòng và 200 cột.')
            for row in grid[:40]:
                mapping = resolve_column_indices([cell_text(v) for v in row], include_defaults=False)
                is_table_header = {'name', 'dob', 'className'}.issubset(mapping)
                if not is_table_header:
                    read_school_metadata(row, metadata)
                if is_table_header:
                    # The school template uses "Cuộc thi đăng ký", absent in old Sheet aliases.
                    for index, value in enumerate(row):
                        label = norm(value)
                        if 'cuoc thi dang ky' in label or label.startswith('ma ky to chuc') or label.startswith('ky to chuc'):
                            mapping['contests'] = index
                    if 'contests' not in mapping:
                        continue
                    tables.append((sheet.title, grid.index(row), mapping, grid))
                    break
        if not tables:
            raise ValueError('Không tìm thấy bảng có họ tên, ngày sinh, lớp và cuộc thi đăng ký.')
        selected = next((item for item in tables if item[0] == sheet_name), None) if sheet_name else next((item for item in tables if norm(item[0]) == 'dang ky tham du'), tables[0])
        if not selected:
            raise ValueError('Tab được chọn không có danh sách đăng ký hợp lệ.')
        title, header, mapping, grid = selected
        records = []
        for row_number, values in enumerate(grid[header + 1:], header + 2):
            raw = {field: cell_text(values[index]) if index < len(values) else '' for field, index in mapping.items()}
            if not raw.get('name'):
                # A partially filled numbered row is an error, rather than silently dropped.
                if str(raw.get('stt') or '').isdigit() and any(raw.get(k) for k in ('dob', 'cccd', 'className', 'contests', 'phone', 'email')):
                    records.append(raw | {'row': row_number})
                continue
            if norm(raw['name']).startswith(('tong cong', 'tong so', 'ghi chu', 'xac nhan', 'dai dien')):
                continue
            if not raw.get('contests') and not raw.get('dob') and not str(raw.get('stt') or '').isdigit():
                continue
            records.append(raw | {'row': row_number})
        if not records or len(records) > 1000:
            raise ValueError('Cần từ 1 đến 1.000 dòng đăng ký trong tab đã chọn.')
        return records, metadata, title, [item[0] for item in tables]
    finally:
        workbook.close()


def partner_rows():
    from .views import PARTNER_CONFIG_KEY, normalize_partners
    config = SystemConfig.objects.filter(key=PARTNER_CONFIG_KEY).first()
    return normalize_partners((config.data or {}).get('partners', [])) if config else []


def fingerprint(plan):
    return hashlib.sha256(json.dumps(plan, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


def school_match(existing, incoming):
    existing = dict(existing) | {'identity': format_identity(existing.get('identity')), 'phone': format_phone(existing.get('phone'))}
    incoming = dict(incoming) | {'identity': format_identity(incoming.get('identity')), 'phone': format_phone(incoming.get('phone'))}
    assessment = candidate_match_assessment(existing, incoming)
    if assessment and assessment['status'] == 'confirmed':
        conflicting = any(existing.get(field) and incoming.get(field) and norm(existing[field]) != norm(incoming[field]) for field in ('identity', 'birth_date'))
        if conflicting:
            return {'status': 'possible', 'reason': 'Thông tin liên hệ trùng nhưng ngày sinh/giấy tờ khác, cần xác nhận'}
    return assessment


def registered_contests(value, sessions):
    """Expand combined codes while preserving an exact session name or ID."""
    value = cell_text(value)
    if not value:
        return []
    if any(norm(value) in {norm(s.pk), norm(s.code), norm(s.name)} for s in sessions):
        return [value]
    result, seen = [], set()
    # "FIMO & FIEO & SIAIO", "FIMO, FIEO và SIAIO", "FIMO - FIEO", "FIMO | FIEO"…
    for part in re.split(r'[,;&/+|\n]+|\s+[-–—]\s+|\s+(?:và|and|hoặc)\s+', value, flags=re.IGNORECASE):
        part = part.strip()
        key = norm(part)
        if key and key not in seen:
            seen.add(key)
            result.append(part)
    return result


def _build_plan(content, options, skip_rows=frozenset()):
    raw_rows, metadata, sheet, sheets = read_workbook(content, str(options.get('sheet') or ''))
    issues = []
    def issue(level, message, row=None):
        issues.append({'level': level, 'message': message, 'row': row})
    partners = partner_rows()
    incoming_partner = options.get('partner') or {}
    if not isinstance(incoming_partner, dict):
        raise ValueError('Thông tin trường không hợp lệ.')
    partner = next((p for p in partners if p['id'] == str(options.get('partnerId') or '')), None)
    if options.get('partnerId') and not partner:
        issue('error', 'Đối tác đã chọn không còn tồn tại. Hãy chọn lại trường.')
    if not partner:
        school = cell_text(incoming_partner['school'] if 'school' in incoming_partner else metadata.get('school'))
        matched = [p for p in partners if norm(p['school']) == norm(school) and school]
        if len(matched) > 1:
            issue('error', 'Có nhiều đối tác cùng tên trường. Hãy chọn đối tác cụ thể.')
        elif len(matched) == 1:
            partner = matched[0]
    new_partner = partner is None
    partner = dict(partner or (metadata | {k: cell_text(v) for k, v in incoming_partner.items()}))
    partner['phone'] = format_phone(partner.get('phone'))
    for field, label in [('school', 'tên trường'), ('representative', 'người liên lạc'), ('phone', 'số điện thoại'), ('email', 'email')]:
        if not partner.get(field):
            issue('error' if field == 'school' else 'warning', f'Thiếu {label} của trường; có thể bổ sung sau.' if field != 'school' else 'Cần nhập tên trường.')
    if partner.get('email'):
        try:
            validate_email(partner['email'])
        except ValidationError:
            issue('error', 'Email người liên lạc của trường không hợp lệ.')
    sessions = list(ExamSession.objects.all().order_by('sort_key', 'id'))
    year = str(options.get('academicYear') or '')
    session_mapping = options.get('sessionMapping') or {}
    confirmations = options.get('candidateMatches') or {}
    if not isinstance(session_mapping, dict) or not isinstance(confirmations, dict):
        raise ValueError('Ánh xạ kỳ tổ chức hoặc hồ sơ không hợp lệ.')
    existing = list(Candidate.objects.all().order_by('id'))
    profiles, rows, registrations, routes = [], [], {}, {}
    missing_fee_rows = []
    # Fees per contest learnt from single-contest rows of this same file; they
    # split a combined fee such as "FIMO & FIEO & SIAIO · 800.000" correctly
    # when the contests cost different amounts.
    known_fees = {}
    for raw in raw_rows:
        single = registered_contests(raw.get('contests', ''), sessions)
        if len(single) == 1 and raw.get('amount'):
            try:
                known_fees.setdefault(norm(single[0]), Counter())[parse_fee(raw['amount'])] += 1
            except InvalidOperation:
                pass
    known_fees = {contest: counts.most_common(1)[0][0] for contest, counts in known_fees.items()}
    for raw in raw_rows:
        row = raw['row']
        if row in skip_rows:
            continue
        profile = {
            'name': format_person_name(raw.get('name', '')), 'birth_date': parse_dob(raw.get('dob', '')),
            'identity': format_identity(raw.get('cccd', '')), 'class_name': raw.get('className', ''), 'school': partner.get('school', ''),
            'parent': format_person_name(raw.get('parent', '')), 'phone': format_phone(raw.get('phone', '')), 'email': raw.get('email', ''),
            'city': raw.get('city') or partner.get('province', ''), 'ward': raw.get('ward') or partner.get('ward', ''),
            'address': raw.get('fullAddress', ''), 'nationality': raw.get('nationality', ''),
            'grade': raw.get('grade') or (re.search(r'\d+', raw.get('className', '')) or [''])[0],
        }
        if not valid_candidate_name(profile['name']):
            issue('error', 'Họ tên thí sinh không hợp lệ.', row)
        if raw.get('dob') and not re.fullmatch(r'\d{4}(?:-\d{2}-\d{2})?', profile['birth_date']):
            issue('error', 'Ngày sinh cần đầy đủ DD/MM/YYYY.', row)
        elif not re.fullmatch(r'\d{4}-\d{2}-\d{2}', profile['birth_date']):
            issue('warning', 'Thiếu ngày sinh đầy đủ; giữ nguyên thông tin hiện có và bổ sung sau.', row)
        if not profile['class_name']:
            issue('warning', 'Thiếu lớp đang học; để trống và bổ sung sau.', row)
        for field, label in (('identity', 'CCCD/Hộ chiếu'), ('phone', 'số điện thoại'), ('email', 'email'), ('parent', 'họ tên phụ huynh')):
            if not profile[field]:
                issue('warning', f'Thiếu {label} trong file gốc; không tự tạo thông tin.', row)
        if profile['email']:
            # Typing slips such as "name 0801@gmail.com" lose the space; an
            # email that is still invalid is left empty instead of blocking.
            profile['email'] = re.sub(r'\s+', '', profile['email'])
            try:
                validate_email(profile['email'])
            except ValidationError:
                issue('warning', f'Email "{profile["email"]}" không hợp lệ; để trống để bổ sung sau.', row)
                profile['email'] = ''
        if len(norm(profile['identity'])) >= 6 and any(
            norm(p['profile']['identity']) == norm(profile['identity']) and
            (norm(p['profile']['name']) != norm(profile['name']) or (p['profile']['birth_date'] and profile['birth_date'] and p['profile']['birth_date'] != profile['birth_date']))
            for p in profiles
        ):
            issue('error', 'Cùng giấy tờ định danh nhưng họ tên/ngày sinh khác nhau giữa các dòng. Cần sửa file trước khi nhập.', row)
        for field, limit in [('name', 255), ('birth_date', 100), ('identity', 100), ('class_name', 100), ('school', 255), ('city', 100), ('grade', 50), ('phone', 255), ('email', 255), ('parent', 255), ('ward', 255), ('address', 1000)]:
            if len(profile.get(field, '')) > limit:
                issue('error', f'Trường {field} vượt quá {limit} ký tự.', row)
        matches = []
        for candidate in existing:
            assessment = school_match(candidate.__dict__, profile)
            if assessment:
                matches.append((candidate, assessment))
        coded = [c for c in existing if raw.get('code') and c.code.casefold() == raw['code'].casefold()]
        if coded and not any(c.pk == coded[0].pk for c, _ in matches):
            issue('error', 'Mã hồ sơ không khớp danh tính trong file.', row)
        confirmed = [c for c, a in matches if a['status'] == 'confirmed']
        forced = str(confirmations.get(str(row)) or '')
        candidate = next((c for c, _ in matches if c.code == forced), None) if forced else (confirmed[0] if len(confirmed) == 1 else None)
        if forced and forced != '__new__' and not candidate:
            issue('error', 'Hồ sơ được xác nhận không thuộc các kết quả đối chiếu.', row)
        elif matches and not candidate and forced != '__new__':
            issue('error', 'Cần xác nhận hồ sơ có khả năng trùng.', row)
        needs_decision = bool(matches) and not candidate and forced != '__new__'
        resolved_code = candidate.code if candidate else ('__new__' if forced == '__new__' or not matches else '')
        same_profiles = [(i, p) for i, p in enumerate(profiles) if (candidate and p['candidateId'] == candidate.pk) or (school_match(p['profile'], profile) or {}).get('status') == 'confirmed']
        if len(same_profiles) > 1:
            issue('error', 'Danh tính khớp nhiều học sinh trong file.', row)
        if same_profiles:
            profile_index, earlier = same_profiles[0]
            for field, value in profile.items():
                previous = earlier['profile'].get(field, '')
                if previous and value and norm(previous) != norm(value):
                    issue('error', f'Thông tin {field} khác nhau giữa các dòng của cùng thí sinh.', row)
                elif value:
                    earlier['profile'][field] = value
        else:
            # Conflicting identifiers for otherwise identical school pupils must be resolved.
            if any(norm(p['profile']['name']) == norm(profile['name']) and p['profile']['birth_date'] == profile['birth_date'] and norm(p['profile']['class_name']) == norm(profile['class_name']) for p in profiles):
                issue('error', 'Các dòng cùng họ tên/ngày sinh/lớp có giấy tờ định danh mâu thuẫn.', row)
            profile_index = len(profiles)
            profiles.append({'profile': profile, 'candidateId': candidate.pk if candidate else '', 'candidateVersion': candidate.updated_at.isoformat() if candidate else ''})
        contests = registered_contests(raw.get('contests', ''), sessions)
        if not contests:
            issue('error', 'Thiếu cuộc thi đăng ký.', row)
        amount = None
        if raw.get('amount'):
            try:
                amount = parse_fee(raw['amount'])
            except InvalidOperation:
                issue('error', 'Lệ phí cần là số tiền, ví dụ 250.000.', row)
        else:
            missing_fee_rows.append(row)
        contest_fees = {contest: amount for contest in contests}
        if len(contests) > 1 and amount is not None:
            contest_fees = split_fee(amount, contests, known_fees)
            if contest_fees is None:
                issue('error', 'Lệ phí chung của dòng nhiều cuộc thi không chia được theo giá từng cuộc thi. Tách thành từng dòng với lệ phí riêng.', row)
                contest_fees = {contest: None for contest in contests}
        for contest in contests or ['']:
            possible = [s for s in sessions if norm(contest) in {norm(s.pk), norm(s.code), norm(s.name)} or norm(contest).startswith(norm(s.code) + ' ')] if contest else []
            if year:
                possible = [s for s in possible if (session_academic_year(s) or '-'.join(re.findall(r'20\d{2}', s.time)[:2])) == year]
            mapped = session_mapping.get(contest)
            target = next((s for s in possible if s.pk == mapped), None) if mapped else (possible[0] if len(possible) == 1 else None)
            if not target and contest not in routes:
                issue('error', 'Không xác định được duy nhất kỳ tổ chức. Chọn kỳ cho ' + (contest or 'dòng này') + '.', row)
            routes[contest] = {'contest': contest, 'sessionId': target.pk if target else '', 'options': [{'id': s.pk, 'label': f'{s.code} · {s.name} · {s.time}'} for s in possible]}
            entry = {'row': row, 'name': profile['name'], 'contest': contest, 'profileIndex': profile_index, 'sessionId': target.pk if target else '', 'amount': contest_fees.get(contest, amount), 'note': raw.get('generalNote') or raw.get('note', ''), 'subject': raw.get('subject', ''), 'category': raw.get('category', ''), 'examLanguage': raw.get('examLanguage', ''), 'needsDecision': needs_decision, 'resolvedCode': resolved_code, 'matches': [{'code': c.code, 'name': c.name, 'birthDate': c.birth_date, 'school': c.school, 'reason': a['reason']} for c, a in matches]}
            rows.append(entry)
            if target:
                key = f'{profile_index}:{target.pk}'
                previous = registrations.get(key)
                if previous:
                    if any(previous.get(field) != entry.get(field) for field in ('amount', 'subject', 'category', 'examLanguage', 'note')):
                        issue('error', 'Dòng lặp trong cùng kỳ có thông tin đăng ký khác nhau.', row)
                    else:
                        issue('warning', 'Dòng đăng ký lặp cùng kỳ được tính một lần.', row)
                else:
                    participation = CandidateParticipation.objects.filter(candidate=candidate, session=target).select_related('school_registration').first() if candidate else None
                    entry['participationVersion'] = participation.updated_at.isoformat() if participation else ''
                    entry['preserveIndividual'] = bool(participation and not participation.school_registration_id)
                    if participation:
                        if not participation.school_registration_id:
                            issue('warning', 'Giữ nguyên lượt đăng ký cá nhân và dữ liệu thanh toán đã có; không tính lại vào khoản thu của trường.', row)
                        if participation.school_registration_id and participation.school_registration.partner_id != partner.get('id'):
                            issue('error', 'Lượt đăng ký đã thuộc nhóm đối soát của trường khác.', row)
                        prior_fee = (participation.registration_data or {}).get('schoolFee')
                        if participation.school_registration_id and prior_fee != entry['amount']:
                            issue('error', 'Lệ phí khác lượt đăng ký đã nhập. Sửa ở đối soát trước khi nhập lại.', row)
                    registrations[key] = entry
    if missing_fee_rows:
        issue('warning', f'{len(missing_fee_rows)} dòng chưa có lệ phí trong file. Kế toán cần nhập số tiền phải thu.')
    groups = []
    room_state = []
    for session_id in sorted({entry['sessionId'] for entry in registrations.values()}):
        session = next(s for s in sessions if s.pk == session_id)
        entries = [entry for entry in registrations.values() if entry['sessionId'] == session_id]
        school_entries = [entry for entry in entries if not entry['preserveIndividual']]
        group = SchoolRegistration.objects.filter(partner_id=partner.get('id', ''), session=session).first()
        billing = ExaminationBillingRecord.objects.filter(school_registration=group).first() if group else None
        additions = sum(not e['participationVersion'] for e in entries)
        if billing and additions and (billing.transfer_status != 'pending' or billing.invoice_status != 'pending' or billing.seen_by_accountant):
            issue('error', f'{session.code}: nhóm trường đã được kế toán xử lý. Cần xử lý khoản bổ sung trước khi nhập thêm.')
        first_round = next((r for r in session.rounds if isinstance(r, dict) and r.get('name')), {})
        slots = [s for s in first_round.get('slots', []) if isinstance(s, dict)]
        occurrence = str(slots[0].get('id') or '') if len(slots) == 1 else ''
        rooms = list(ExamRoom.objects.filter(session=session, round_id=str(first_round.get('id') or ''), occurrence_id=occurrence).order_by('position', 'room_number', 'id')) if len(slots) <= 1 else []
        counts = {str(room.pk): room.assignments.count() for room in rooms}
        for room in rooms:
            room_state.append([str(room.pk), room.updated_at.isoformat(), counts[str(room.pk)]])
        assigned, waiting, already_assigned = 0, 0, 0
        for entry in entries:
            candidate_id = profiles[entry['profileIndex']]['candidateId']
            existing_result = RoundResult.objects.filter(participation__candidate_id=candidate_id, participation__session_id=session_id, round_id=str(first_round.get('id') or ''), occurrence_id=occurrence).first() if candidate_id else None
            if entry['preserveIndividual']:
                already_assigned += bool(existing_result and existing_result.exam_room_id)
                entry['roomId'] = ''
                continue
            if existing_result and (existing_result.exam_room_id or existing_result.eligibility != 'Đủ điều kiện'):
                if existing_result.exam_room_id:
                    already_assigned += 1
                entry['roomId'] = ''
                continue
            available = [room for room in rooms if room.capacity is None or counts[str(room.pk)] < room.capacity]
            if available:
                room = min(available, key=lambda r: counts[str(r.pk)]) if available[0].allocation_strategy == ExamRoom.STRATEGY_BALANCED else available[0]
                entry['roomId'] = str(room.pk)
                counts[str(room.pk)] += 1
                assigned += 1
            else:
                entry['roomId'] = ''
                waiting += 1
        if waiting:
            issue('warning', f'{session.code}: {waiting} lượt chờ phân phòng (chưa cấu hình phòng/đợt hoặc hết sức chứa).')
        groups.append({'sessionId': session_id, 'competitionCode': session.code, 'competitionName': session.name, 'label': f'{session.code} · {session.name} · {session.time}', 'registrations': len(entries), 'newCandidates': sum(not profiles[e['profileIndex']]['candidateId'] for e in entries), 'existingCandidates': sum(bool(profiles[e['profileIndex']]['candidateId']) for e in entries), 'newRegistrations': additions, 'existingRegistrations': len(entries) - additions, 'schoolRegistrations': len(school_entries), 'preservedIndividualRegistrations': len(entries) - len(school_entries), 'amount': sum(e['amount'] or 0 for e in school_entries) if all(e['amount'] is not None for e in school_entries) else None, 'assigned': assigned, 'alreadyAssigned': already_assigned, 'waiting': waiting, 'round': first_round, 'occurrenceId': occurrence, 'billingVersion': billing.updated_at.isoformat() if billing else '', 'sessionVersion': session.updated_at.isoformat()})
    plan = {'partner': partner, 'newPartner': new_partner, 'sheet': sheet, 'sheets': sheets, 'rows': rows, 'profiles': profiles, 'registrations': list(registrations.values()), 'routes': list(routes.values()), 'groups': groups, 'issues': issues, 'roomState': room_state, 'fileHash': hashlib.sha256(content).hexdigest(), 'candidateState': fingerprint([(c.pk, c.updated_at.isoformat()) for c in existing])}
    plan['summary'] = {'rows': len(raw_rows), 'candidates': len(profiles), 'newCandidates': sum(not p['candidateId'] for p in profiles), 'existingCandidates': sum(bool(p['candidateId']) for p in profiles), 'registrations': len(registrations), 'newRegistrations': sum(g['newRegistrations'] for g in groups), 'existingRegistrations': sum(g['existingRegistrations'] for g in groups), 'sessions': len(groups)}
    plan['summary']['preservedIndividualRegistrations'] = sum(g['preservedIndividualRegistrations'] for g in groups)
    return plan


def build_plan(content, options):
    """Plan an import in which a faulty row only drops that row.

    Errors tied to a row (invalid name, ambiguous profile, unknown contest…)
    remove the row and are reported; the other pupils import normally. Only
    file-level errors (school, accounting state) block the import.
    """
    skipped, carried_issues, carried_rows = set(), [], []
    for _ in range(5):
        plan = _build_plan(content, options, frozenset(skipped))
        row_errors = [i for i in plan['issues'] if i['level'] == 'error' and i.get('row')]
        if not row_errors:
            break
        new_rows = {i['row'] for i in row_errors}
        carried_issues += row_errors
        carried_rows += [row | {'skipped': True} for row in plan['rows'] if row['row'] in new_rows]
        skipped |= new_rows
    plan['issues'] = carried_issues + [i for i in plan['issues'] if not (i.get('row') in skipped)]
    plan['rows'] = sorted(plan['rows'] + carried_rows, key=lambda row: row['row'])
    plan['skippedRows'] = sorted(skipped)
    plan['summary']['skippedRows'] = len(skipped)
    plan['canCommit'] = bool(plan['registrations']) and not any(i['level'] == 'error' and not i.get('row') for i in plan['issues'])
    return plan


def commit_plan(plan, request, filename):
    from .views import PARTNER_CONFIG_KEY, append_audit, serialize_candidate, serialize_session, upsert_participation_history
    partner = dict(plan['partner'])
    partners = partner_rows()
    if plan['newPartner']:
        partner['id'] = str(uuid.uuid4())
        partner.setdefault('contests', [])
        partner.setdefault('studentCounts', [])
        partners.append(partner)
        append_audit('partner-' + partner['id'], 'Tạo đối tác từ file đăng ký trường: ' + partner['school'], request)
    group_map = {}
    for item in plan['groups']:
        if not item['schoolRegistrations']:
            continue
        group, _ = SchoolRegistration.objects.get_or_create(partner_id=partner['id'], session_id=item['sessionId'], defaults={'school': partner['school'], 'contact': partner})
        group_map[item['sessionId']] = group
    codes = set(Candidate.objects.values_list('code', flat=True))
    candidates = []
    for item in plan['profiles']:
        profile = item['profile']
        if item['candidateId']:
            candidate = Candidate.objects.get(pk=item['candidateId'])
            candidate.identity = format_identity(candidate.identity)
            candidate.phone = format_phone(candidate.phone)
            for field, value in profile.items():
                if value and not getattr(candidate, field):
                    setattr(candidate, field, value)
        else:
            code = next_code(codes)
            codes.add(code)
            candidate = Candidate(id=code, code=code, **profile, sort_key=norm(profile['name']) + '_' + code)
        candidate.updated = timezone.localtime().strftime('%d/%m/%Y %H:%M')
        candidate.save()
        candidates.append(candidate)
    for entry in plan['registrations']:
        candidate = candidates[entry['profileIndex']]
        session = ExamSession.objects.get(pk=entry['sessionId'])
        candidate.session_ids = list(dict.fromkeys([*(candidate.session_ids or []), session.pk]))
        candidate.contests = merge_contest_codes(candidate.contests, session.code)
        candidate.save()
        if entry['preserveIndividual']:
            continue
        group = group_map[entry['sessionId']]
        participation = CandidateParticipation.objects.filter(candidate=candidate, session=session).first()
        if not participation:
            # Attach the school before the creation signal can generate individual accounting alerts.
            participation = CandidateParticipation.objects.create(candidate=candidate, session=session, school_registration=group)
        participation.school_registration = group
        participation.registration_data = dict(participation.registration_data or {}) | {'schoolFee': entry['amount'], 'schoolPartnerId': partner['id']}
        participation.save()
        registration = {'registrationMethod': 'Trường học', 'registrationUnit': partner['school'], 'generalNote': entry['note'], 'subject': entry['subject'], 'category': entry['category'], 'examLanguage': entry['examLanguage']}
        participation = upsert_participation_history(candidate, session.pk, [], f'Excel trường: {filename}', registration, 'fill-empty')
        configured = next(g for g in plan['groups'] if g['sessionId'] == session.pk)
        initial_result = participation.round_results.filter(round_id=str(configured['round'].get('id') or '')).first()
        if initial_result:
            initial_result.exam_date = initial_result.exam_date or configured['round'].get('date', '')
            initial_result.save(update_fields=['exam_date', 'updated_at'])
        if entry.get('roomId'):
            room = ExamRoom.objects.get(pk=entry['roomId'])
            result = participation.round_results.filter(round_id=room.round_id).first()
            if result and not result.exam_room_id:
                result.exam_room = room
                result.occurrence_id = room.occurrence_id
                result.room_name = room.label
                result.mode = 'Trực tiếp' if room.mode == ExamRoom.MODE_IN_PERSON else 'Trực tuyến'
                result.location = f'{room.label}:\n{room.link}' if room.mode == ExamRoom.MODE_ONLINE else ' · '.join(v for v in (room.label, room.location) if v)
                config = next((g for g in plan['groups'] if g['sessionId'] == session.pk), {})
                slot = next((s for s in config.get('round', {}).get('slots', []) if s.get('id') == room.occurrence_id), {})
                result.exam_date = result.exam_date or slot.get('date') or config.get('round', {}).get('date', '')
                result.time_slot = result.time_slot or slot.get('time', '')
                if room.exam_link:
                    result.link = room.exam_link
                result.save()
    for session_id, group in group_map.items():
        fees = [(p.registration_data or {}).get('schoolFee') for p in group.participations.all()]
        billing, created = ExaminationBillingRecord.objects.get_or_create(school_registration=group)
        if created or next(g for g in plan['groups'] if g['sessionId'] == session_id)['newRegistrations']:
            billing.amount = sum(fees) if all(fee is not None for fee in fees) else None
            billing.seen_by_accountant = False
            billing.save()
            from authentication.notifications import notify_workspace
            transaction.on_commit(lambda group=group: notify_workspace(
                event_key=f'examination:school-registration:{group.pk}:{group.participations.count()}',
                title='Trường đăng ký cần đối soát', message=f'{group.school} · {group.session.code} · {group.participations.count()} học sinh',
                category='examination', action_url='/finance-report/examination-billing', target_modules=['finance-report'],
            ))
        partner['contests'] = list(dict.fromkeys([*partner.get('contests', []), group.session.code]))
        counts = [c for c in partner.get('studentCounts', []) if c.get('session') != session_id]
        partner['studentCounts'] = [*counts, {'session': session_id, 'count': group.participations.count()}]
    for report in plan['groups']:
        append_audit('session-' + report['sessionId'], f'Báo cáo nhập Excel {filename} · trường {partner["school"]}: {report["registrations"]} học sinh đăng ký {report["competitionCode"]}; {report["newCandidates"]} hồ sơ mới, {report["existingCandidates"]} hồ sơ đã có; {report["newRegistrations"]} lượt đăng ký bổ sung, {report["existingRegistrations"]} lượt đã thuộc kỳ. Giữ nguyên {report["preservedIndividualRegistrations"]} lượt cá nhân; {report["schoolRegistrations"]} lượt đối soát theo trường. Phân phòng: {report["assigned"]} bổ sung, {report["alreadyAssigned"]} đã phân, {report["waiting"]} chờ.', request, system=True)
    config, _ = SystemConfig.objects.get_or_create(key=PARTNER_CONFIG_KEY)
    config.data = dict(config.data or {}) | {'partners': [partner if p['id'] == partner['id'] else p for p in partners]}
    config.save(update_fields=['data'])
    from .partner_contact_sync import launch_partner_contact_sync
    transaction.on_commit(launch_partner_contact_sync, robust=True)
    sync_session_candidate_totals()
    report = [{key: group[key] for key in ('sessionId', 'competitionCode', 'competitionName', 'label', 'registrations', 'newCandidates', 'existingCandidates', 'newRegistrations', 'existingRegistrations', 'schoolRegistrations', 'preservedIndividualRegistrations', 'amount', 'assigned', 'alreadyAssigned', 'waiting')} for group in plan['groups']]
    return {'items': [serialize_candidate(c) for c in candidates], 'partners': config.data['partners'], 'sessions': [serialize_session(s) for s in ExamSession.objects.filter(pk__in=[g['sessionId'] for g in plan['groups']])], 'summary': plan['summary'], 'report': report, 'issues': plan['issues']}


@api_view(['POST'])
@parser_classes([MultiPartParser])
@permission_classes([IsAuthenticated])
def school_import(request):
    upload = request.FILES.get('file')
    if not upload or not upload.name.lower().endswith('.xlsx'):
        return Response({'error': 'Chọn file .xlsx theo mẫu trường học.'}, status=400)
    try:
        options = json.loads(request.data.get('options', '{}'))
        if not isinstance(options, dict):
            raise ValueError('Tùy chọn nhập không hợp lệ.')
        content = upload.read(10 * 1024 * 1024 + 1)
        action = str(options.get('action') or 'preview')
        if action not in {'preview', 'commit'}:
            raise ValueError('Thao tác nhập không hợp lệ.')
        if action == 'preview':
            plan = build_plan(content, options)
            plan['previewToken'] = signing.dumps(fingerprint(plan), salt='school-import')
            return Response(plan)
        with transaction.atomic():
            # Serialize concurrent imports and room allocation against the same source records.
            list(SystemConfig.objects.select_for_update().filter(key='examination_partners'))
            list(ExamSession.objects.select_for_update().all())
            list(Candidate.objects.select_for_update().all())
            list(CandidateParticipation.objects.select_for_update().all())
            list(ExamRoom.objects.select_for_update().all())
            list(ExaminationBillingRecord.objects.select_for_update().all())
            plan = build_plan(content, options)
            try:
                expected = signing.loads(options.get('previewToken', ''), salt='school-import', max_age=1800)
            except signing.BadSignature:
                return Response({'error': 'Bản xem trước hết hạn hoặc không hợp lệ. Hãy kiểm tra lại file.'}, status=409)
            if expected != fingerprint(plan):
                return Response({'error': 'Dữ liệu đã thay đổi. Hãy xem trước lại để xác nhận đúng các lượt đăng ký.'}, status=409)
            if not plan['canCommit']:
                return Response({'error': 'Cần xử lý các lỗi trong popup trước khi nhập.', 'issues': plan['issues']}, status=400)
            result = commit_plan(plan, request, upload.name)
        return Response(result, status=201)
    except (ValueError, InvalidOperation, ValidationError) as exc:
        return Response({'error': str(exc)}, status=400)
