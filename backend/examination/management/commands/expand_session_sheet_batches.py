"""Give each exam batch ("đợt") of a round its own 15-column block on the session tab.

Chốt 25/11/2026: thí sinh có thể thi nhiều đợt của một vòng. Tab khảo thí của kỳ
có một khối "VÒNG n · ĐỢT k (dd/mm/yyyy)" cho mỗi đợt, liền sau khối ĐỢT 1.

The background writer never restructures a tab; this command does it once:
- inserts the missing batch columns right after the round's blocks, gives the
  new header and data columns the formats and data validation of the ĐỢT 1
  block, re-merges row 1 per block, labels them and relabels VÒNG n to
  "VÒNG n · ĐỢT 1 (date)";
- moves each row's old VÒNG n values into the block of its batch (by its
  "Ngày thi" cell, else by the batch of the candidate's web result), clearing
  only the cells it moved; every other cell, row and Sheet-only column stays;
- stores the new tab fingerprints so the scanner does not treat the change as a
  person's edit.

Labels carry the batch date. If the session's batch dates no longer match the
dated blocks already on the tab (a batch inserted before or between existing
ones), the command refuses instead of renumbering; a later batch is appended.

Dry run by default (prints every insert and move); ``--apply`` writes, in one
atomic batchUpdate, while holding the Sheet writer lock. A second run finds
every block present and does nothing.
"""
from contextlib import nullcontext

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from authentication.models import SystemConfig
from examination.models import CandidateParticipation, ExamSession, ExaminationSheet
from examination.partner_contact_sync import _single_worker
from examination.sync import (ROUND_EXPORT_HEADERS, ROUND_TEMPLATE_FIELD_ORDER, _column_name, _output_sheet_target,
                              _sheet_range_title, clean_txt, exam_day, header_round_blocks, merged_headers,
                              session_sheet_layout, sheet_values_fingerprint, tab_content_fingerprint)
from integrations.google_sheets import build_sheets_service, extract_spreadsheet_id

DEFAULT_SESSIONS = ('fimo-2026-2027', 'fieo-2026-2027')
BLOCK = len(ROUND_EXPORT_HEADERS)
DATE_OFFSET = ROUND_TEMPLATE_FIELD_ORDER.index('date')


def tab_sheets(session):
    """One ExaminationSheet per (spreadsheet, tab) of the session; the output link first."""
    sheets = sorted(ExaminationSheet.objects.filter(session_id=session.pk).exclude(url='').exclude(stage='form-webhook'),
                    key=lambda sheet: (sheet.stage != 'session-output', sheet.pk))
    chosen, seen = [], set()
    for sheet in sheets:
        key = (extract_spreadsheet_id(sheet.url), clean_txt(sheet.sheet_tab))
        if key[0] and key not in seen:
            seen.add(key)
            chosen.append(sheet)
    return chosen


def block_starts(grid):
    """{(round, batch): (first column, date in the label or None)} of each complete round block."""
    headers = merged_headers(grid, 1)
    starts = {}
    for number, batch, group, fields, day in header_round_blocks(headers):
        start = fields.get(ROUND_TEMPLATE_FIELD_ORDER[0])
        if start is None or any(fields.get(key) != start + offset for offset, key in enumerate(ROUND_TEMPLATE_FIELD_ORDER)):
            raise CommandError(f'Khối "{group}" không đủ {BLOCK} cột theo đúng thứ tự mẫu; cần kiểm tra thủ công.')
        starts[(number, batch)] = (start, day)
    return starts


def plan_inserts(starts, layout):
    """Missing batch blocks per batched round.

    [{round, source, existing, insert_at, count, new: [(batch, offset)], relabel, labels}];
    ``source`` is the round's ĐỢT 1 (old VÒNG n) block, whose formats new blocks take.
    """
    plans = []
    for position in sorted({block['round_pos'] for block in layout if block['batch']}):
        batches = [block for block in layout if block['round_pos'] == position]
        total = len(batches)
        present = sorted(batch for number, batch in starts if number == position and batch)
        single = starts.get((position, None), (None, None))[0]
        for batch in present:
            day = starts[(position, batch)][1]
            if batch > total or (day and day != batches[batch - 1]['day']):
                expected = batches[batch - 1]['day'].strftime('%d/%m/%Y') if batch <= total else 'không còn trong cấu hình'
                shown = day.strftime('%d/%m/%Y') if day else 'không ghi ngày'
                raise CommandError(f'Vòng {position}: khối ĐỢT {batch} trên tab ghi ngày {shown} nhưng đợt {batch} của kỳ là '
                                   f'{expected}. Lịch đợt đã đổi thứ tự; cần sắp lại tab thủ công, lệnh không tự đánh số lại.')
        labels = {block['batch']: block['label'] for block in batches}
        if present == list(range(1, total + 1)) and single is None:
            continue
        if single is not None and not present:
            plans.append({'round': position, 'source': single, 'existing': [single], 'insert_at': single + BLOCK,
                          'count': (total - 1) * BLOCK, 'new': [(batch, (batch - 2) * BLOCK) for batch in range(2, total + 1)],
                          'relabel': single, 'labels': labels})
        elif single is None and present and present == list(range(1, len(present) + 1)) and len(present) < total:
            existing = [starts[(position, batch)][0] for batch in present]
            plans.append({'round': position, 'source': existing[0], 'existing': existing, 'insert_at': existing[-1] + BLOCK,
                          'count': (total - len(present)) * BLOCK,
                          'new': [(batch, (batch - len(present) - 1) * BLOCK) for batch in range(len(present) + 1, total + 1)],
                          'relabel': None, 'labels': labels})
        else:
            raise CommandError(f'Vòng {position}: tab có khối {sorted(present)}{" và VÒNG " + str(position) if single is not None else ""}, '
                               f'không khớp {total} đợt của kỳ; cần kiểm tra thủ công.')
    return plans


def row_batch(row, source, entry, days, results_by_code):
    """(batch number, reason) for one row's old round block."""
    cell = clean_txt(row[source + DATE_OFFSET]) if source + DATE_OFFSET < len(row) else ''
    day = exam_day(cell)
    if day in days:
        return days.index(day) + 1, f'Ngày thi {cell}'
    code = clean_txt(row[1]).upper() if len(row) > 1 else ''
    found = set()
    for result in results_by_code.get(code, []):
        if result.round_id != entry['round_id']:
            continue
        for block in entry['blocks']:
            if (result.occurrence_id and result.occurrence_id in block['slot_ids']) or (exam_day(result.exam_date) == block['day']):
                found.add(block['batch'])
    if len(found) == 1:
        return found.pop(), 'đợt của kết quả trên web'
    return 1, ''


def grid_range(sheet_id, start_column, rows=(0, None)):
    value = {'sheetId': sheet_id, 'startRowIndex': rows[0], 'startColumnIndex': start_column, 'endColumnIndex': start_column + BLOCK}
    if rows[1] is not None:
        value['endRowIndex'] = rows[1]
    return value


class Command(BaseCommand):
    help = 'Mở rộng tab khảo thí của kỳ thi nhiều đợt: mỗi đợt một khối 15 cột (chạy thử mặc định).'

    def add_arguments(self, parser):
        parser.add_argument('--session', action='append', dest='sessions', help='Mã kỳ tổ chức (lặp lại được).')
        parser.add_argument('--apply', action='store_true', help='Ghi thay đổi lên Google Sheet.')

    def handle(self, *args, **options):
        session_ids = options.get('sessions') or list(DEFAULT_SESSIONS)
        sessions = list(ExamSession.objects.filter(pk__in=session_ids))
        missing = set(session_ids) - {session.pk for session in sessions}
        if missing:
            raise CommandError(f'Chưa có kỳ tổ chức: {", ".join(sorted(missing))}')
        config = SystemConfig.objects.filter(key='main').first()
        service = build_sheets_service(config.last_google_access_token if config else None, (config.data if config else {}) or {})
        # Writing holds the lock of the Sheet writer (drain_session_sheet_queue)
        # so no export runs while columns move; a busy lock fails at once.
        lock = _single_worker(blocking=False) if options['apply'] else nullcontext()
        try:
            with lock:
                for session in sessions:
                    layout = session_sheet_layout(session)
                    if not any(block['batch'] for block in layout):
                        self.stdout.write(f'{session.pk}: không có vòng thi nhiều đợt; giữ nguyên.')
                        continue
                    sheets = tab_sheets(session)
                    if not sheets:
                        raise CommandError(f'{session.pk}: chưa gắn tab Google Sheet.')
                    for sheet in sheets:
                        self.expand(service, session, layout, sheet, options['apply'])
        except BlockingIOError as exc:
            raise CommandError('Hàng đợi ghi Google Sheet khảo thí đang chạy; chưa thay đổi gì, hãy chạy lại sau ít phút.') from exc

    def expand(self, service, session, layout, sheet, apply):
        spreadsheet_id = extract_spreadsheet_id(sheet.url)
        target = _output_sheet_target(sheet, service)
        title = target['title']
        range_title = _sheet_range_title(title)
        grid = service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=f'{range_title}!A1:ZZ').execute(num_retries=6).get('values', [])
        if len(grid) < 2:
            raise CommandError(f'Tab {title} chưa có 2 hàng tiêu đề; cần kiểm tra thủ công.')
        plans = plan_inserts(block_starts(grid), layout)
        if not plans:
            self.stdout.write(f'{session.pk} · {title}: đã đủ cột theo đợt; không thay đổi.')
            return

        def final(column):
            """Column index after every insert."""
            return column + sum(plan['count'] for plan in plans if plan['insert_at'] <= column)

        def new_start(plan, offset):
            return plan['insert_at'] + sum(other['count'] for other in plans if other['insert_at'] < plan['insert_at']) + offset

        sheet_id = target['sheetId']
        metadata = service.spreadsheets().get(spreadsheetId=spreadsheet_id, fields='sheets(properties(sheetId,title),merges)').execute(num_retries=6)
        merges = next((item.get('merges') or [] for item in metadata.get('sheets', []) if item.get('properties', {}).get('sheetId') == sheet_id), [])
        # Request order (one atomic batchUpdate): insert columns, unmerge row 1 of
        # the round, copy formats/validation (no merge travels with them), merge
        # row 1 per block, move row values, write labels.
        inserts, unmerges, formats, block_merges, moves_requests, labels = [], [], [], [], [], []
        for plan in sorted(plans, key=lambda item: item['insert_at'], reverse=True):
            inserts.append({'insertDimension': {'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS',
                'startIndex': plan['insert_at'], 'endIndex': plan['insert_at'] + plan['count']}, 'inheritFromBefore': True}})
            self.stdout.write(f'{session.pk} · {title}: chèn {plan["count"]} cột sau khối vòng {plan["round"]} '
                              f'(từ cột {_column_name(new_start(plan, 0))}).')
        moves = []
        for plan in plans:
            source = final(plan['source'])
            existing = [final(start) for start in plan['existing']]
            new_blocks = [(batch, new_start(plan, offset)) for batch, offset in plan['new']]
            merged = any(item.get('startRowIndex', 0) == 0 and item.get('startColumnIndex', 0) < start + BLOCK
                         and item.get('endColumnIndex', 0) > start for start in plan['existing'] for item in merges)
            if merged:
                area_end = max(start for _, start in new_blocks) + BLOCK
                unmerges.append({'unmergeCells': {'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 1,
                                                            'startColumnIndex': existing[0], 'endColumnIndex': area_end}}})
                block_merges.extend({'mergeCells': {'range': grid_range(sheet_id, start, (0, 1)), 'mergeType': 'MERGE_ALL'}}
                                    for start in existing + [start for _, start in new_blocks])
            if plan['relabel'] is not None:
                labels.append((0, source, plan['labels'][1]))
            for batch, start in new_blocks:
                # Header rows take the ĐỢT 1 header look; data rows take each field's
                # own format and data validation from the same column of ĐỢT 1.
                formats.append({'copyPaste': {'source': grid_range(sheet_id, source, (0, 2)),
                                              'destination': grid_range(sheet_id, start, (0, 2)), 'pasteType': 'PASTE_FORMAT'}})
                for paste_type in ('PASTE_FORMAT', 'PASTE_DATA_VALIDATION'):
                    formats.append({'copyPaste': {'source': grid_range(sheet_id, source, (2, None)),
                                                  'destination': grid_range(sheet_id, start, (2, None)), 'pasteType': paste_type}})
                labels.append((0, start, plan['labels'][batch]))
                labels.extend((1, start + index, label) for index, label in enumerate(ROUND_EXPORT_HEADERS))
                self.stdout.write(f'  Khối {plan["labels"][batch]}: cột {_column_name(start)}:{_column_name(start + BLOCK - 1)}.')
            if plan['relabel'] is None:
                continue
            entry = {'round_id': next(block['round_id'] for block in layout if block['round_pos'] == plan['round']),
                     'blocks': [block for block in layout if block['round_pos'] == plan['round']]}
            days = [block['day'] for block in entry['blocks']]
            codes = {clean_txt(row[1]).upper() for row in grid[2:] if len(row) > 1 and clean_txt(row[1])}
            results_by_code = {}
            for participation in CandidateParticipation.objects.filter(session=session).select_related('candidate').prefetch_related('round_results'):
                if participation.candidate.code.upper() in codes:
                    results_by_code[participation.candidate.code.upper()] = list(participation.round_results.all())
            for row_index, row in enumerate(grid[2:], start=2):
                cells = [clean_txt(row[plan['source'] + offset]) if plan['source'] + offset < len(row) else '' for offset in range(BLOCK)]
                if not any(cells):
                    continue
                batch, reason = row_batch(row, plan['source'], entry, days, results_by_code)
                if batch == 1:
                    continue
                start = dict(new_blocks)[batch]
                moves.append((row_index, source, start, cells))
                code = clean_txt(row[1]) if len(row) > 1 else ''
                self.stdout.write(f'  Dòng {row_index + 1} {code or "(chưa có mã)"}: VÒNG {plan["round"]} → '
                                  f'{plan["labels"][batch]} ({reason}); {_column_name(source)}{row_index + 1}:{_column_name(source + BLOCK - 1)}{row_index + 1} '
                                  f'→ {_column_name(start)}{row_index + 1}:{_column_name(start + BLOCK - 1)}{row_index + 1}.')
        for row_index, source, start, cells in moves:
            # Copy the cells as they are (numbers, dates, formats), then clear only what moved.
            moves_requests.append({'copyPaste': {'source': grid_range(sheet_id, source, (row_index, row_index + 1)),
                                                 'destination': grid_range(sheet_id, start, (row_index, row_index + 1)),
                                                 'pasteType': 'PASTE_NORMAL'}})
            for offset, value in enumerate(cells):
                if value:
                    moves_requests.append({'updateCells': {'range': {'sheetId': sheet_id, 'startRowIndex': row_index, 'endRowIndex': row_index + 1,
                        'startColumnIndex': source + offset, 'endColumnIndex': source + offset + 1}, 'fields': 'userEnteredValue'}})
        label_requests = [{'updateCells': {'range': {'sheetId': sheet_id, 'startRowIndex': row, 'endRowIndex': row + 1,
                                                     'startColumnIndex': column, 'endColumnIndex': column + 1},
                                           'rows': [{'values': [{'userEnteredValue': {'stringValue': label}}]}], 'fields': 'userEnteredValue'}}
                          for row, column, label in labels]
        requests = inserts + unmerges + formats + block_merges + moves_requests + label_requests
        self.stdout.write(f'{session.pk} · {title}: {len(moves)} dòng chuyển sang khối đợt của mình.')
        if not apply:
            self.stdout.write('Chạy thử; thêm --apply để ghi.')
            return
        # One batchUpdate: Google applies all of it or nothing.
        service.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body={'requests': requests}).execute(num_retries=6)
        data_rows = service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=f'{range_title}!A3:ZZ').execute(num_retries=6).get('values', [])
        content = sheet_values_fingerprint(data_rows)
        try:
            observed = tab_content_fingerprint(sheet)
        except Exception as exc:  # the scanner's web-echo check still recognises the content fingerprint
            observed = ''
            self.stdout.write(f'Không đọc được dấu vân tay toàn tab ({exc}); lần quét sau sẽ nhận diện là web tự ghi.')
        for linked in ExaminationSheet.objects.filter(session_id=session.pk).exclude(url=''):
            if (extract_spreadsheet_id(linked.url), clean_txt(linked.sheet_tab)) == (spreadsheet_id, clean_txt(sheet.sheet_tab)):
                linked.last_content_fingerprint = content
                if observed:
                    linked.last_observed_fingerprint = observed
                linked.pending_manual_import = False
                linked.change_detected_at = None
                linked.updated_at = timezone.now()
                linked.save(update_fields=['last_content_fingerprint', 'last_observed_fingerprint', 'pending_manual_import',
                                           'change_detected_at', 'updated_at'])
        self.stdout.write(f'{session.pk} · {title}: đã mở rộng tab.')
