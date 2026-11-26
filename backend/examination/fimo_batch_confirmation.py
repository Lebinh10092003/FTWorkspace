import hmac
import os
import re
from datetime import date

from django.db import transaction
from rest_framework.decorators import api_view, authentication_classes, parser_classes, permission_classes
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import CandidateParticipation, ExamSession
from .registration_batch import add_batch, batch_days
from .registration_window import session_rounds
from .views import append_audit


SESSION_ID = 'fimo-2026-2027'
ROUND_ID = 'round-national'
BATCH_DAY = date(2026, 12, 6)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@parser_classes([JSONParser])
def fimo_batch_2_confirmation(request):
    secret = os.environ.get('FIMO_BATCH_2_WEBHOOK_SECRET', '').strip()
    supplied = request.headers.get('X-Examination-Webhook-Secret', '')
    if len(secret) < 32 or not hmac.compare_digest(secret.encode(), supplied.encode()):
        return Response({'error': 'Khóa webhook không hợp lệ.'}, status=403)

    code = request.data.get('candidateCode') if isinstance(request.data, dict) else None
    if not isinstance(code, str) or not re.fullmatch(r'FT-[0-9]{1,15}', code):
        return Response({'error': 'Mã FT không hợp lệ.'}, status=400)

    session = ExamSession.objects.filter(pk=SESSION_ID, code='FIMO').first()
    rounds = session_rounds(session) if session else []
    entry = rounds[0] if rounds else {}
    if entry.get('id') != ROUND_ID or batch_days(entry)[1:2] != [BATCH_DAY]:
        return Response({'error': 'Lịch FIMO đợt 2 cần được Khảo thí kiểm tra.'}, status=409)

    with transaction.atomic():
        participation = CandidateParticipation.objects.select_for_update(of=('self',)).filter(
            session=session, candidate__code=code,
        ).first()
        if participation is None:
            return Response({'error': 'Mã FT chưa có hồ sơ trong kỳ FIMO.'}, status=404)
        result = add_batch(participation, entry, BATCH_DAY, slot_id='')
        if result is not None:
            message = f'{code} xác nhận dự thi FIMO đợt 2 ngày {BATCH_DAY:%d/%m/%Y} qua nút xác nhận.'
            append_audit(f'candidate-{code}', message, system=True)
            append_audit(f'session-{SESSION_ID}', message, system=True)

    return Response({'status': 'added' if result is not None else 'already_assigned'})
