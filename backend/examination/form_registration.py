"""Import the private 2026–2027 registration form pushed by its bound Apps Script."""

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
from .sync import format_person_name, merge_contest_codes, next_code, parse_dob, sync_session_candidate_totals


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


def selected_codes(tab, row):
    allowed = TAB_CODES[tab]
    if len(allowed) == 1:
        return list(allowed)
    # Both grouped form tabs have duplicate "Chọn cuộc thi" fields after form edits.
    # Only choice cells may decide membership; a blank choice never means all contests.
    text = ' '.join(str(row[i] or '') for i in (12, 14) if i < len(row)).upper()
    return [code for code in allowed if re.search(r'(?<![A-Z])' + code + r'(?![A-Z])', text)]


def clean(value):
    return str(value or '').strip()


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


def import_form_rows(tab, rows):
    if tab not in TAB_CODES:
        raise ValueError('Tab không được theo dõi.')
    if not isinstance(rows, list) or len(rows) > 500:
        raise ValueError('Mỗi yêu cầu chỉ nhận tối đa 500 dòng.')
    sessions = {code: ExamSession.objects.filter(pk=session_id).first() for code, session_id in SESSION_IDS.items() if code in TAB_CODES[tab]}
    if any(session is None for session in sessions.values()):
        raise ValueError('Chưa cấu hình đủ kỳ tổ chức 2026–2027 trên web.')
    summary = {'created': 0, 'linked': 0, 'updated': 0, 'skipped': 0, 'errors': []}
    for entry in rows:
        row_number = entry.get('rowNumber') if isinstance(entry, dict) else None
        row = entry.get('values') if isinstance(entry, dict) else None
        if not isinstance(row_number, int) or row_number < 2 or not isinstance(row, list) or len(row) > 30:
            summary['skipped'] += 1
            continue
        if len(row) < 13 or not clean(row[2]):
            summary['skipped'] += 1
            continue
        name = format_person_name(row[2])
        birth_date = parse_dob(row[3])
        identity = re.sub(r'\s+', '', clean(row[4]))
        email = clean(row[5]) or clean(row[1])
        phone = re.sub(r'[^\d+]', '', clean(row[9]))
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
                    candidate = link.candidate if link else matching_candidate(name, birth_date, identity, email, phone)
                    created = candidate is None
                    if created:
                        candidate_code = next_code(set(Candidate.objects.values_list('code', flat=True)))
                        candidate = Candidate.objects.create(
                            id=candidate_code, code=candidate_code, name=name, birth_date=birth_date,
                            identity=identity, email=email, phone=phone, school=clean(row[10]),
                            grade=clean(row[11]), city=clean(row[6]), ward=clean(row[7]),
                            address=clean(row[8]), contests=code, session_ids=[session.id],
                            sort_key=f'{name.lower()}_{identity or candidate_code}',
                            updated=timezone.localtime().strftime('%d/%m/%Y %H:%M'),
                        )
                        summary['created'] += 1
                    else:
                        candidate.contests = merge_contest_codes(candidate.contests, code)
                        candidate.session_ids = list(dict.fromkeys([*(candidate.session_ids or []), session.id]))
                        # A form may fill missing contact details; web edits remain authoritative.
                        for field, value in {
                            'birth_date': birth_date, 'identity': identity, 'email': email, 'phone': phone,
                            'school': clean(row[10]), 'grade': clean(row[11]), 'city': clean(row[6]),
                            'ward': clean(row[7]), 'address': clean(row[8]),
                        }.items():
                            if value and not getattr(candidate, field):
                                setattr(candidate, field, value)
                        candidate.save()
                    participation, participation_created = CandidateParticipation.objects.get_or_create(
                        candidate=candidate, session=session,
                        defaults={'source': f'{SHEET_URL}#{tab}'},
                    )
                    payment_proof = clean(row[13]) if tab == 'FIMO, FIEO' and len(row) > 13 else ''
                    if tab == 'SIPhO, SIChO, SIBO, SILSO':
                        payment_proof = ' | '.join(clean(row[i]) for i in (13, 15) if i < len(row) and clean(row[i]))
                    if tab == 'SIAIO' and len(row) > 12:
                        payment_proof = clean(row[12])
                    registration = dict(participation.registration_data or {})
                    registration.update({'formTab': tab, 'formRow': row_number, 'paymentProof': payment_proof})
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
        return Response(import_form_rows(data['sheetTab'], data.get('rows')))
    except ValueError as exc:
        return Response({'error': str(exc)}, status=400)
