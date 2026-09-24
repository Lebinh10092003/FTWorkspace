"""Read-only change hints from the 2026–2027 examination Google Sheet.

This endpoint deliberately accepts no Sheet data and imports no candidates. It
only re-reads the configured Google tabs and compares their fingerprints with
the stored baseline. A short throttle limits unauthenticated recheck traffic;
the scheduled scan remains the fallback for missed trigger events.
"""

import hashlib

from django.core.cache import cache
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import ExaminationSheet
from .sheet_scheduler import scan_sheet_changes
from .sync import extract_spreadsheet_id


SPREADSHEET_ID = '11h9E1WPewoUzoMK8UToIC2oJqRyFrvrw5oZfl81NZM8'
WATCHED_TABS = frozenset({
    'SCO - SIAIO', 'SCO - SIBO', 'SCO - SIChO', 'SCO - SIPhO',
    'SCO - SILSO', 'FT - FIMO', 'FT - FIEO',
})


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def examination_sheet_change_webhook(request):
    """Check the changed tab; report only verified differences to staff."""
    data = request.data
    if not isinstance(data, dict):
        return Response({'error': 'Payload không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)
    spreadsheet_id = str(data.get('spreadsheetId') or '')
    tab_name = str(data.get('sheetTab') or '')
    if spreadsheet_id != SPREADSHEET_ID or tab_name not in WATCHED_TABS | {'*'}:
        return Response({'error': 'Nguồn Sheet không được theo dõi.'}, status=status.HTTP_400_BAD_REQUEST)

    sources = [
        sheet for sheet in ExaminationSheet.objects.filter(sheet_tab__in=WATCHED_TABS).exclude(url='')
        if extract_spreadsheet_id(sheet.url) == SPREADSHEET_ID
        and (tab_name == '*' or sheet.sheet_tab == tab_name)
    ]
    if not sources:
        return Response({'error': 'Không có tab khảo thí tương ứng trên web.'}, status=status.HTTP_404_NOT_FOUND)

    throttle_key = 'examination-sheet-hint:' + hashlib.sha256(
        f'{spreadsheet_id}:{tab_name}'.encode('utf-8')
    ).hexdigest()
    if not cache.add(throttle_key, True, timeout=3):
        return Response({'status': 'recently_checked'}, status=status.HTTP_202_ACCEPTED)

    summary = scan_sheet_changes(sheets=sources)
    if summary['failed']:
        # Permit an immediate retry when Google has not yet made the edit
        # visible through its CSV export / Sheets API.
        cache.delete(throttle_key)
        return Response(summary, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response(summary)
