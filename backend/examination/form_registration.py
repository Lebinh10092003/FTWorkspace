"""Import the private 2026–2027 registration form pushed by its bound Apps Script."""

import datetime
import hashlib
import hmac
import os
import re
from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Candidate, CandidateParticipation, ExamSession, FormRegistrationLink
from .registration_batch import place_new_registration
from .sync import clean_profile_text
from .sync import form_grade_and_class, format_identity, format_phone, format_person_name, merge_contest_codes, next_code, parse_dob, sync_session_candidate_totals, valid_candidate_name


SPREADSHEET_ID = '1gqO1Tp4YSBp0UVBgXjJgvL8CuqftVKGNd74PPRX9i8E'
TAB_CODES = {
    'SIAIO': ('SIAIO',),
    'SIPhO, SIChO, SIBO, SILSO': ('SIPHO', 'SICHO', 'SIBO', 'SILSO'),
    'FIMO, FIEO': ('FIMO', 'FIEO'),
}
SESSION_IDS = {
    'SIAIO': 'iaio-2026-2027', 'SIPHO': 'ipho-2026-2027',
    'SICHO': 'icho-2026-2027', 'SIBO': 'ibo-2026-2027',
    'SILSO': 'ilso-2026-2027', 'FIMO': 'fimo-2026-2027',
    'FIEO': 'fieo-2026-2027',
}
SHEET_URL = f'https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit'


# Vị trí cột chuẩn của Form gốc (đúng thứ tự tab SIPhO…). Staff có thể chèn cột
# như "Hóa đơn" vào giữa tab; Apps Script gửi kèm dòng tiêu đề để web đọc theo
# tên cột thay vì vị trí. Một mẫu lặp lại (chọn cuộc thi, xác nhận thanh toán)
# lấy lần xuất hiện thứ n theo thứ tự cột.
FORM_COLUMNS = (
    (0, r'^dấu thời gian'), (1, r'^địa chỉ email'), (2, r'họ và tên thí sinh'), (3, r'ngày sinh'),
    (4, r'cccd|hộ chiếu'), (5, r'email liên hệ'), (6, r'tỉnh'), (7, r'^xã|xã/'), (8, r'địa chỉ hiện tại'),
    (9, r'số điện thoại'), (10, r'^trường'), (11, r'^khối'), (12, r'^chọn cuộc thi'),
    (13, r'thanh toán|nộp lệ phí'), (14, r'^chọn cuộc thi'), (15, r'thanh toán|nộp lệ phí'),
    (16, r'họ tên phụ huynh'), (17, r'mã đăng ký workspace'),
)


def header_key(value):
    """'9. Trường:' -> 'trường:'"""
    return re.sub(r'^\s*\d+\s*[.)]\s*', '', clean(value)).casefold()


def form_layout(headers):
    """{vị trí chuẩn: cột thật trên Sheet (0-based)} theo tiêu đề cột."""
    keys = [header_key(value) for value in headers]
    used = set()
    layout = {}
    for index, pattern in FORM_COLUMNS:
        column = next((position for position, key in enumerate(keys)
                       if position not in used and key and re.search(pattern, key)), None)
        if column is not None:
            used.add(column)
            layout[index] = column
    return layout


def canonical_form_row(headers, row):
    """Sắp lại một dòng Sheet về thứ tự cột chuẩn theo tiêu đề cột."""
    result = [''] * len(FORM_COLUMNS)
    for index, column in form_layout(headers).items():
        result[index] = row[column] if column < len(row) else ''
    return result


def selected_codes(tab, row):
    allowed = TAB_CODES[tab]
    if len(allowed) == 1:
        return list(allowed)
    # Both grouped form tabs have duplicate "Chọn cuộc thi" fields after form edits.
    # Only choice cells may decide membership; a blank choice never means all contests.
    text = ' '.join(str(row[i] or '') for i in (12, 14) if i < len(row)).upper()
    return [code for code in allowed if re.search(r'(?<![A-Z])' + code + r'(?![A-Z])', text)]


def clean(value):
    return clean_profile_text(value)


def submitted_on(row):
    """Ngày gửi Form từ ô "Dấu thời gian" (dd/mm/yyyy …); không đọc được thì None (= hôm nay)."""
    match = re.match(r'\s*(\d{1,2})/(\d{1,2})/(\d{4})', clean(row[0]) if row else '')
    if not match:
        return None
    try:
        return datetime.date(int(match.group(3)), int(match.group(2)), int(match.group(1)))
    except ValueError:
        return None


def submitted_at(row):
    """ISO giờ Việt Nam từ ô "Dấu thời gian" (dd/mm/yyyy hh:mm[:ss]); không đọc được thì ''."""
    match = re.match(r'\s*(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?', clean(row[0]) if row else '')
    if not match:
        return ''
    day, month, year, hour, minute, second = (int(value or 0) for value in match.groups())
    try:
        value = datetime.datetime(year, month, day, hour, minute, second)
    except ValueError:
        return ''
    return timezone.make_aware(value).isoformat()


def source_uid(row, row_number):
    timestamp = clean(row[0]) if row else ''
    if timestamp:
        key = '|'.join([timestamp, clean(row[2]), clean(row[3])])
        return hashlib.sha256(key.encode('utf-8')).hexdigest()
    return f'row:{row_number}'


def matching_candidate(name, birth_date, identity, email, phone):
    candidates = []
    if identity:
        candidates = list(Candidate.objects.filter(identity=identity))
        if any(c.name.casefold() != name.casefold() for c in candidates):
            raise ValueError('CCCD/Hộ chiếu trùng hồ sơ khác tên; cần kiểm tra thủ công.')
    if not candidates and birth_date and email:
        candidates = list(Candidate.objects.filter(email__iexact=email, birth_date=birth_date, name__iexact=name))
    if not candidates and birth_date and phone:
        candidates = list(Candidate.objects.filter(phone=phone, birth_date=birth_date, name__iexact=name))
    if len(candidates) > 1:
        raise ValueError('Có nhiều hồ sơ cùng thông tin; cần kiểm tra thủ công.')
    return candidates[0] if candidates else None


def import_form_rows(tab, rows, headers=None):
    if tab not in TAB_CODES:
        raise ValueError('Tab không được theo dõi.')
    if not isinstance(rows, list) or len(rows) > 500:
        raise ValueError('Mỗi yêu cầu chỉ nhận tối đa 500 dòng.')
    if headers is not None and (not isinstance(headers, list) or len(headers) > 30):
        raise ValueError('Dòng tiêu đề không hợp lệ.')
    sessions = {code: ExamSession.objects.filter(pk=session_id).first() for code, session_id in SESSION_IDS.items() if code in TAB_CODES[tab]}
    if any(session is None for session in sessions.values()):
        raise ValueError('Chưa cấu hình đủ kỳ tổ chức 2026–2027 trên web.')
    summary = {'created': 0, 'linked': 0, 'updated': 0, 'skipped': 0, 'errors': []}
    existing_codes = None
    for entry in rows:
        row_number = entry.get('rowNumber') if isinstance(entry, dict) else None
        row = entry.get('values') if isinstance(entry, dict) else None
        if not isinstance(row_number, int) or row_number < 2 or not isinstance(row, list) or len(row) > 30:
            summary['skipped'] += 1
            continue
        if headers:
            row = canonical_form_row(headers, row)
        # Rows appended by the Workspace registration page are already in the
        # database. The periodic Apps Script sweep must not import them again.
        if len(row) > 17 and clean(row[17]).startswith('WORKSPACE:'):
            summary['skipped'] += 1
            continue
        if len(row) < 13 or not clean(row[2]):
            summary['skipped'] += 1
            continue
        name = format_person_name(row[2])
        if not valid_candidate_name(name):
            summary['skipped'] += 1
            continue
        birth_date = parse_dob(row[3])
        identity = format_identity(row[4])
        email = clean(row[5]) or clean(row[1])
        phone = format_phone(row[9])
        source_issues = {}
        if phone and not all(re.fullmatch(r'0\d{9}|\+\d{9,15}', part.strip()) for part in phone.split('/')):
            source_issues['phone'] = clean(row[9])
            phone = ''
        if clean(row[4]) and not identity:
            source_issues['identity'] = clean(row[4])
        grade, class_name = form_grade_and_class(row[11])
        parent = clean(row[16]) if len(row) > 16 else ''
        codes = selected_codes(tab, row)
        if not codes:
            summary['skipped'] += 1
            summary['errors'].append({'row': row_number, 'reason': 'Chưa chọn cuộc thi hợp lệ.'})
            continue
        uid = source_uid(row, row_number)
        for code in codes:
            session = sessions[code]
            try:
                with transaction.atomic():
                    link = FormRegistrationLink.objects.select_related('candidate').filter(
                        spreadsheet_id=SPREADSHEET_ID, sheet_tab=tab,
                        source_uid=uid, session=session,
                    ).first()
                    new_form_row = link is None
                    candidate = link.candidate if link else matching_candidate(name, birth_date, identity, email, phone)
                    created = candidate is None
                    if created:
                        # Read every code once per request, not once per new candidate.
                        if existing_codes is None:
                            existing_codes = set(Candidate.objects.values_list('code', flat=True))
                        candidate_code = next_code(existing_codes)
                        existing_codes.add(candidate_code)
                        candidate = Candidate.objects.create(
                            id=candidate_code, code=candidate_code, name=name, birth_date=birth_date,
                            identity=identity, email=email, phone=phone, parent=parent, school=clean(row[10]),
                            grade=grade, class_name=class_name, city=clean(row[6]), ward=clean(row[7]),
                            address=clean(row[8]), contests=code, session_ids=[session.id],
                            sort_key=f'{name.lower()}_{identity or candidate_code}',
                            updated=timezone.localtime().strftime('%d/%m/%Y %H:%M'),
                        )
                        summary['created'] += 1
                    else:
                        new_membership = not CandidateParticipation.objects.filter(candidate=candidate, session=session).exists()
                        grade_changed = bool(grade and form_grade_and_class(candidate.grade)[0] != grade)
                        candidate.contests = merge_contest_codes(candidate.contests, code)
                        candidate.session_ids = list(dict.fromkeys([*(candidate.session_ids or []), session.id]))
                        # A form may fill missing contact details; web edits remain authoritative.
                        for field, value in {
                            'birth_date': birth_date, 'identity': identity, 'email': email, 'phone': phone, 'parent': parent,
                            'school': clean(row[10]), 'grade': grade, 'class_name': class_name, 'city': clean(row[6]),
                            'ward': clean(row[7]), 'address': clean(row[8]),
                        }.items():
                            if value and (new_membership or not getattr(candidate, field)):
                                setattr(candidate, field, value)
                        if new_membership and grade_changed and not class_name:
                            candidate.class_name = ''
                        candidate.save()
                    participation, participation_created = CandidateParticipation.objects.get_or_create(
                        candidate=candidate, session=session,
                        defaults={'source': f'{SHEET_URL}#{tab}'},
                    )
                    if participation_created:
                        place_new_registration(participation, submitted_on(row))
                    elif new_form_row:
                        # Một lượt gửi Form mới của thí sinh đã có lượt tham gia:
                        # thi thêm đợt đang mở lúc gửi, miễn phí (25/11/2026).
                        from .public_registration import record_extra_batch
                        record_extra_batch(participation, source=f'Google Form ({tab}, dòng {row_number})', today=submitted_on(row))
                    payment_proof = clean(row[13]) if tab == 'FIMO, FIEO' and len(row) > 13 else ''
                    if tab == 'SIPhO, SIChO, SIBO, SILSO':
                        payment_proof = ' | '.join(clean(row[i]) for i in (13, 15) if i < len(row) and clean(row[i]))
                    if tab == 'SIAIO':
                        # SIAIO không có câu chọn cuộc thi: theo tiêu đề, ảnh
                        # thanh toán là cột "thanh toán" đầu tiên (13); dòng
                        # gửi không kèm tiêu đề vẫn theo vị trí cũ (12).
                        proof_column = 13 if headers else 12
                        payment_proof = clean(row[proof_column]) if len(row) > proof_column else ''
                    registration = dict(participation.registration_data or {})
                    registration.update({'formTab': tab, 'formRow': row_number, 'paymentProof': payment_proof})
                    # Thời điểm gửi Form (sớm nhất) để đếm đăng ký mới theo ngày;
                    # dòng có thể được nhập vào web muộn hơn nhiều.
                    submitted = submitted_at(row)
                    if submitted and (not registration.get('formSubmittedAt') or submitted < registration['formSubmittedAt']):
                        registration['formSubmittedAt'] = submitted
                    registration.setdefault('registeredAt', participation.created_at.isoformat())
                    registration.setdefault('registrationProfile', {
                        'name': name, 'birth_date': birth_date, 'identity': identity, 'email': email, 'phone': phone, 'parent': parent,
                        'school': clean(row[10]), 'grade': grade, 'class_name': class_name,
                        'city': clean(row[6]), 'ward': clean(row[7]), 'address': clean(row[8]),
                    })
                    if source_issues:
                        registration['sourceIssues'] = source_issues
                    participation.registration_data = registration
                    participation.source = f'{SHEET_URL}#{tab}'
                    participation.save(update_fields=['registration_data', 'source', 'updated_at'])
                    FormRegistrationLink.objects.update_or_create(
                        spreadsheet_id=SPREADSHEET_ID, sheet_tab=tab, source_uid=uid, session=session,
                        defaults={'candidate': candidate, 'source_row': row_number},
                    )
                    if not created:
                        summary['linked' if participation_created else 'updated'] += 1
            except ValueError as exc:
                summary['errors'].append({'row': row_number, 'contest': code, 'reason': str(exc)})
    # Most webhook calls only re-send rows staff edited; counts change only
    # when a candidate joins a session.
    if summary['created'] or summary['linked']:
        sync_session_candidate_totals()
    return summary


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def registration_webhook(request):
    secret = os.environ.get('EXAMINATION_REGISTRATION_WEBHOOK_SECRET', '').strip()
    supplied = request.headers.get('X-Examination-Webhook-Secret', '')
    if not secret or not hmac.compare_digest(secret, supplied):
        return Response({'error': 'Webhook chưa được cấu hình hoặc khóa không hợp lệ.'}, status=403)
    data = request.data
    if not isinstance(data, dict) or data.get('spreadsheetId') != SPREADSHEET_ID or data.get('sheetTab') not in TAB_CODES:
        return Response({'error': 'Nguồn Sheet không hợp lệ.'}, status=400)
    try:
        return Response(import_form_rows(data['sheetTab'], data.get('rows'), data.get('headers')))
    except ValueError as exc:
        return Response({'error': str(exc)}, status=400)
