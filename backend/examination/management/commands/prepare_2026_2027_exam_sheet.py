"""Create empty, import-compatible tabs for the seven scheduled Olympiads."""

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from authentication.models import SystemConfig
from examination.models import ExamSession, ExaminationSheet
from examination.sync import EXPORT_GROUP_HEADERS, EXPORT_HEADERS
from integrations.google_sheets import build_sheets_service, extract_spreadsheet_id


SHEET_URL = 'https://docs.google.com/spreadsheets/d/11h9E1WPewoUzoMK8UToIC2oJqRyFrvrw5oZfl81NZM8/edit'
TABS = (
    ('iaio-2026-2027', 'SCO - SIAIO'),
    ('ibo-2026-2027', 'SCO - SIBO'),
    ('icho-2026-2027', 'SCO - SIChO'),
    ('ipho-2026-2027', 'SCO - SIPhO'),
    ('ilso-2026-2027', 'SCO - SILSO'),
    ('fimo-2026-2027', 'FT - FIMO'),
    ('fieo-2026-2027', 'FT - FIEO'),
)


def quoted(title):
    return "'" + title.replace("'", "''") + "'"


def _same_headers(actual):
    return len(actual) == len(EXPORT_HEADERS) and all(
        ' '.join(str(value).split()) == ' '.join(expected.split())
        for value, expected in zip(actual, EXPORT_HEADERS)
    )


def provision_tab(service, spreadsheet_id, title):
    metadata = service.spreadsheets().get(
        spreadsheetId=spreadsheet_id, fields='sheets(properties(sheetId,title,gridProperties(columnCount)))',
    ).execute()
    existing = {
        item['properties']['title']: item['properties']
        for item in metadata.get('sheets', []) if item.get('properties', {}).get('title')
    }
    created = title not in existing
    if created:
        response = service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={'requests': [{'addSheet': {'properties': {'title': title, 'gridProperties': {'columnCount': len(EXPORT_HEADERS), 'rowCount': 1000}}}}]},
        ).execute()
        sheet_id = response['replies'][0]['addSheet']['properties']['sheetId']
    else:
        sheet_id = existing[title]['sheetId']
        current = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=f'{quoted(title)}!A1:BR2',
        ).execute().get('values', [])
        if any(any(str(cell).strip() for cell in row) for row in current):
            if len(current) < 2 or not _same_headers(current[1]):
                raise CommandError(f'Tab {title} đã có dữ liệu khác mẫu 70 cột; cần kiểm tra thủ công.')
            return False
        if existing[title].get('gridProperties', {}).get('columnCount', 0) < len(EXPORT_HEADERS):
            service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={'requests': [{'updateSheetProperties': {'properties': {'sheetId': sheet_id, 'gridProperties': {'columnCount': len(EXPORT_HEADERS)}}, 'fields': 'gridProperties.columnCount'}}]},
            ).execute()
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id, range=f'{quoted(title)}!A1',
        valueInputOption='RAW',
        body={'values': [EXPORT_GROUP_HEADERS, EXPORT_HEADERS]},
    ).execute()
    service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={'requests': [
            {'updateSheetProperties': {'properties': {'sheetId': sheet_id, 'gridProperties': {'frozenRowCount': 2}}, 'fields': 'gridProperties.frozenRowCount'}},
            {'repeatCell': {'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 2, 'startColumnIndex': 0, 'endColumnIndex': len(EXPORT_HEADERS)}, 'cell': {'userEnteredFormat': {'textFormat': {'bold': True}, 'backgroundColor': {'red': 0.89, 'green': 0.94, 'blue': 1.0}, 'wrapStrategy': 'WRAP'}}, 'fields': 'userEnteredFormat'}},
        ]},
    ).execute()
    return created


def link_session(session_id, tab_name):
    session = ExamSession.objects.get(pk=session_id)
    session.registration_sheet_url = SHEET_URL
    session.registration_sheet_tab = tab_name
    session.save(update_fields=['registration_sheet_url', 'registration_sheet_tab', 'updated_at'])
    sheet, created = ExaminationSheet.objects.get_or_create(
        session_id=session_id, stage='registration-source',
        defaults={
            'id': f'2026-2027-{session_id}', 'name': tab_name,
            'url': SHEET_URL, 'sheet_tab': tab_name,
            'created_at': timezone.now(), 'updated_at': timezone.now(),
        },
    )
    source_changed = (sheet.url, sheet.sheet_tab) != (SHEET_URL, tab_name)
    sheet.name = tab_name
    sheet.url = SHEET_URL
    sheet.sheet_tab = tab_name
    if created or source_changed:
        sheet.status = 'idle'
        sheet.automation_enabled = False
        sheet.last_observed_fingerprint = ''
        sheet.pending_manual_import = False
        sheet.change_detected_at = None
        sheet.last_error = ''
    sheet.updated_at = timezone.now()
    sheet.save()


class Command(BaseCommand):
    help = 'Prepare the 2026–2027 Google Sheet tabs and link them to examination sessions.'

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument('--apply', action='store_true', help='Create tabs and link sheet sources.')
        mode.add_argument('--link-existing', action='store_true', help='Link tabs already created in Google Sheets without editing them.')

    def handle(self, *args, **options):
        for session_id, tab_name in TABS:
            self.stdout.write(f'{session_id} -> {tab_name}')
        if not options['apply'] and not options['link_existing']:
            self.stdout.write('Chạy thử; thêm --apply để tạo tab hoặc --link-existing để gắn các tab đã tạo.')
            return
        missing = [session_id for session_id, _ in TABS if not ExamSession.objects.filter(pk=session_id).exists()]
        if missing:
            raise CommandError(f'Chưa có kỳ tổ chức: {", ".join(missing)}')
        try:
            service = None
            spreadsheet_id = None
            if options['apply']:
                config = SystemConfig.objects.filter(key='main').first()
                service = build_sheets_service(
                    config.last_google_access_token if config else None,
                    (config.data if config else {}) or {},
                )
                spreadsheet_id = extract_spreadsheet_id(SHEET_URL)
            for session_id, tab_name in TABS:
                if service:
                    created = provision_tab(service, spreadsheet_id, tab_name)
                    action = 'Tạo' if created else 'Giữ'
                else:
                    action = 'Gắn tab hiện có'
                link_session(session_id, tab_name)
                self.stdout.write(f'{action} {tab_name}; đã gắn nguồn cho {session_id}.')
        except Exception as exc:
            raise CommandError(str(exc)) from exc
