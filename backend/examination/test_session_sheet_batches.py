"""Một vòng thi nhiều đợt: mỗi đợt một khối 15 cột trên tab khảo thí (chốt 25/11/2026)."""
import csv
import hashlib
import io
from io import StringIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from .models import (Candidate, CandidateParticipation, ExamSession, ExaminationSheet, LogNote, RoundResult,
                     SessionSheetOutbox)
from .sync import (EXPORT_GROUP_HEADERS, EXPORT_HEADERS, PROFILE_EXPORT_HEADERS, ROUND_EXPORT_HEADERS,
                   build_sheet_preview, export_session_to_google_sheet, history_from_sheet_row, merged_headers,
                   resolve_column_indices, score_value, session_export_rows, session_sheet_headers,
                   sheet_values_fingerprint)

SESSION_ID = 'fimo-2026-2027'
V1, V1D2, V1D3, V2, V3, SUMMARY = 21, 36, 51, 66, 81, 96
DATE, ATTENDANCE, SCORE, RATE, RESULT = 2, 9, 10, 11, 13


def batched_rounds():
    return [
        {'id': 'qualifying', 'name': 'Vòng loại Quốc gia', 'slots': [
            {'id': 'day-1', 'date': '2026-10-11'}, {'id': 'day-2', 'date': '2026-11-08'},
            {'id': 'day-3', 'date': '2027-01-10'}]},
        {'id': 'national', 'name': 'Chung kết Quốc gia', 'slots': [{'id': 'final', 'date': '2027-03-07'}]},
        {'id': 'international', 'name': 'Vòng Quốc tế'},
    ]


class BatchSheetBase(TestCase):
    def setUp(self):
        # The FIMO 2026-2027 session may already be seeded by a data migration.
        self.session, _ = ExamSession.objects.update_or_create(id=SESSION_ID, defaults=dict(competition_id='FIMO', code='FIMO',
            name='FIMO 2026-2027', parent='FT', organizer='FT', time='2026-2027', phase='', sort_key='fimo', rounds=batched_rounds()))
        CandidateParticipation.objects.filter(session=self.session).delete()
        ExaminationSheet.objects.all().delete()
        self.candidate = Candidate.objects.create(id='FT-90100', code='FT-90100', name='Nguyễn Thử Nghiệm', sort_key='1')
        self.participation = CandidateParticipation.objects.create(candidate=self.candidate, session=self.session)
        self.first = RoundResult.objects.create(participation=self.participation, round_id='qualifying',
            round_name='Vòng loại Quốc gia', occurrence_id='day-1', exam_date='2026-10-11', score='40')

    def results(self):
        return RoundResult.objects.filter(participation=self.participation, round_id='qualifying')


class BatchLayoutExportTests(BatchSheetBase):
    def test_three_batch_session_exports_100_columns_with_batch_labels(self):
        groups, headers = session_sheet_headers(self.session)
        self.assertEqual(len(headers), 100)
        self.assertEqual([groups[index] for index in (V1, V1D2, V1D3, V2, V3, SUMMARY)],
                         ['VÒNG 1 · ĐỢT 1 (11/10/2026)', 'VÒNG 1 · ĐỢT 2 (08/11/2026)', 'VÒNG 1 · ĐỢT 3 (10/01/2027)', 'VÒNG 2', 'VÒNG 3', 'TỔNG HỢP'])
        self.assertEqual(headers[V1D2:V1D2 + 15], ROUND_EXPORT_HEADERS)
        rows = session_export_rows(self.session.pk)
        self.assertEqual([len(row) for row in rows], [100, 100, 100])
        # One batch only: exactly the 70-column template, unchanged.
        self.session.rounds = [{'id': 'qualifying', 'name': 'Vòng loại', 'slots': [{'id': 'day-1', 'date': '2026-10-11'}]}]
        self.session.save()
        self.assertEqual(session_export_rows(self.session.pk)[:2], [EXPORT_GROUP_HEADERS, EXPORT_HEADERS])

    def test_each_batch_result_lands_in_its_own_block(self):
        RoundResult.objects.create(participation=self.participation, round_id='qualifying', round_name='Vòng loại Quốc gia',
            occurrence_id='', exam_date='2026-11-08', score='45')
        RoundResult.objects.create(participation=self.participation, round_id='national', round_name='Chung kết Quốc gia',
            occurrence_id='final', sbd='N-01')
        row = session_export_rows(self.session.pk)[2]
        self.assertEqual((row[V1 + DATE], row[V1 + SCORE]), ('11/10/2026', '40'))
        self.assertEqual((row[V1D2 + DATE], row[V1D2 + SCORE]), ('08/11/2026', '45'))
        self.assertEqual(row[V1D3:V1D3 + 15], [''] * 15)
        self.assertEqual(row[V2 + 1], 'N-01')

    def test_unplaced_result_goes_to_first_batch_block(self):
        self.first.occurrence_id, self.first.exam_date = '', ''
        self.first.save()
        row = session_export_rows(self.session.pk)[2]
        self.assertEqual(row[V1 + SCORE], '40')
        self.assertEqual(row[V1D2:V1D3 + 15], [''] * 30)

    def test_counted_batch_is_the_highest_score(self):
        RoundResult.objects.create(participation=self.participation, round_id='qualifying', round_name='Vòng loại Quốc gia',
            occurrence_id='day-2', exam_date='2026-11-08', score_rate='86,7%')
        self.first.score_rate = '80%'
        self.first.save()
        compact = session_export_rows(self.session.pk, compact=True)[2]
        self.assertEqual(len(compact), 70)
        self.assertEqual(compact[V1 + RATE], '86,7%')

    def test_score_value_parsing(self):
        def value(score='', rate=''):
            return score_value(SimpleNamespace(score=score, score_rate=rate))
        self.assertEqual(value(rate='86,7%'), 86.7)
        self.assertEqual(value(score='12', rate='97.5 %'), 97.5)
        self.assertEqual(value(score='34/50'), 68.0)
        self.assertEqual(value(score='45,5 điểm'), 45.5)
        self.assertEqual(value(score='45đ'), 45.0)
        self.assertIsNone(value(score='Vắng'))
        self.assertIsNone(value(score='3/0'))
        self.assertIsNone(value())


class BatchSheetWriterTests(BatchSheetBase):
    def setUp(self):
        super().setUp()
        self.sheet = ExaminationSheet.objects.create(id='fimo-batches', name='FT - FIMO',
            url='https://docs.google.com/spreadsheets/d/fake-batches/edit', sheet_tab='FT - FIMO',
            session_id=self.session.pk, stage='session-output', created_at=timezone.now(), updated_at=timezone.now())
        RoundResult.objects.create(participation=self.participation, round_id='qualifying', round_name='Vòng loại Quốc gia',
            occurrence_id='day-2', exam_date='2026-11-08', score='45')

    def run_refresh(self, header_rows, current, column_count):
        service = MagicMock()
        service.spreadsheets().get().execute.return_value = {'sheets': [{'properties': {
            'sheetId': 8, 'title': 'FT - FIMO', 'gridProperties': {'columnCount': column_count}}}]}

        def reads():
            yield {'values': header_rows}
            yield {'values': [PROFILE_EXPORT_HEADERS]}
            yield {'values': current}
            written = service.spreadsheets().values().batchUpdate.call_args.kwargs['body']['data']
            yield {'values': [['1', *item['values'][0]] for item in written]}
        service.spreadsheets().values().get().execute.side_effect = reads()
        with patch('examination.sync.build_sheets_service', return_value=service):
            result = export_session_to_google_sheet(self.sheet, export_mode='refresh-selected',
                append_candidate_codes=[self.candidate.code], validate_template=True)
        return result, service.spreadsheets().values().batchUpdate.call_args.kwargs['body']['data'], service

    def test_refresh_writes_every_batch_block_and_keeps_sheet_only_cells(self):
        groups, headers = session_sheet_headers(self.session)
        current = session_export_rows(self.session.pk)[2]
        current[0] = '1'
        current[V1D2 + SCORE] = ''
        current[V1D2 + ATTENDANCE] = 'Đã dự thi'  # kept by invigilators on the Sheet
        current[V1D3 + 5] = 'Phòng gõ trên Sheet'
        result, data, service = self.run_refresh([groups, headers], [current], 100)
        self.assertEqual(result['updated'], 1)
        self.assertEqual(data[0]['range'], "'FT - FIMO'!B3:CV3")
        written = ['1', *data[0]['values'][0]]
        self.assertEqual(len(written), 100)
        self.assertEqual((written[V1 + SCORE], written[V1D2 + SCORE]), ('40', '45'))
        self.assertEqual(written[V1D2 + ATTENDANCE], 'Đã dự thi')
        self.assertEqual(written[V1D3 + 5], 'Phòng gõ trên Sheet')
        service.spreadsheets().values().clear.assert_not_called()

    def test_refresh_follows_columns_inserted_on_the_sheet(self):
        groups, headers = session_sheet_headers(self.session)
        # Khảo thí inserted a private column after the third batch block.
        groups = groups[:V2] + [''] + groups[V2:]
        headers = headers[:V2] + ['Ghi chú Khảo thí'] + headers[V2:]
        RoundResult.objects.create(participation=self.participation, round_id='national', round_name='Chung kết Quốc gia',
            occurrence_id='final', sbd='N-01')
        current = session_export_rows(self.session.pk)[2]
        current = current[:V2] + ['Chỉ có trên Sheet'] + [''] * 34
        current[0] = '1'
        _, data, _ = self.run_refresh([groups, headers], [current], 101)
        self.assertEqual(data[0]['range'], "'FT - FIMO'!B3:CW3")
        written = ['1', *data[0]['values'][0]]
        self.assertEqual(written[V2], 'Chỉ có trên Sheet')
        self.assertEqual(written[V2 + 1 + 1], 'N-01')

    def test_export_preview_reads_batch_columns_and_ignores_sheet_only_cells(self):
        from .sync import output_sheet_export_preview
        groups, headers = session_sheet_headers(self.session)
        current = session_export_rows(self.session.pk)[2]
        current[0] = '1'
        current[V1D2 + ATTENDANCE] = 'Đã dự thi'
        current[V1D2 + SCORE] = '44'
        service = MagicMock()
        service.spreadsheets().get().execute.return_value = {'sheets': [{'properties': {
            'sheetId': 8, 'title': 'FT - FIMO', 'gridProperties': {'columnCount': 100}}}]}
        service.spreadsheets().values().get().execute.side_effect = [{'values': [groups, headers]}, {'values': [current]}, {}]
        with patch('examination.sync.build_sheets_service', return_value=service):
            preview = output_sheet_export_preview(self.sheet)
        self.assertEqual([(change['cell'], change['field'], change['next']) for change in preview['changes']],
                         [('AU3', 'Điểm', '45')])

    def test_writer_skips_a_block_labelled_for_another_date(self):
        groups, headers = session_sheet_headers(self.session)
        groups[V1D2] = 'VÒNG 1 · ĐỢT 2 (06/12/2026)'
        current = session_export_rows(self.session.pk)[2]
        current[0] = '1'
        current[V1D2:V1D2 + 15] = [''] * 15
        current[V1 + SCORE] = ''
        with self.assertLogs('examination.sync', level='WARNING') as logs:
            _, data, _ = self.run_refresh([groups, headers], [current], 100)
        self.assertIn('06/12/2026', logs.output[0])
        written = ['1', *data[0]['values'][0]]
        self.assertEqual(written[V1 + SCORE], '40')
        self.assertEqual(written[V1D2:V1D2 + 15], [''] * 15)

    def test_old_70_column_tab_of_batched_session_keeps_old_layout(self):
        current = session_export_rows(self.session.pk, compact=True)[2]
        current[0] = '1'
        current[V1 + SCORE] = ''
        with self.assertLogs('examination.sync', level='WARNING') as logs:
            _, data, _ = self.run_refresh([EXPORT_GROUP_HEADERS, EXPORT_HEADERS], [current], 70)
        self.assertIn('chưa có cột theo đợt', logs.output[0])
        self.assertEqual(data[0]['range'], "'FT - FIMO'!B3:BR3")
        written = ['1', *data[0]['values'][0]]
        self.assertEqual(len(written), 70)
        # One block per round: the batch with the highest score.
        self.assertEqual((written[V1 + DATE], written[V1 + SCORE]), ('08/11/2026', '45'))


class BatchSheetImportTests(BatchSheetBase):
    def setUp(self):
        super().setUp()
        self.source = ExaminationSheet.objects.create(id='fimo-batch-watch', name='FT - FIMO',
            url='https://docs.google.com/spreadsheets/d/fake-watch/edit', session_id=self.session.pk, sheet_tab='FT - FIMO',
            stage='registration-source', automation_enabled=True, created_at=timezone.now(), updated_at=timezone.now())

    def csv_of(self, rows):
        buffer = io.StringIO()
        csv.writer(buffer, lineterminator='\n').writerows([[str(value) for value in row] for row in rows])
        return buffer.getvalue()

    def sheet_row(self):
        row = session_export_rows(self.session.pk)[2]
        row[0] = '1'
        return row

    def scan(self, raw):
        from .sheet_scheduler import scan_sheet_changes
        SessionSheetOutbox.objects.all().delete()
        response = MagicMock(status_code=200, text=raw, url='https://docs.google.com/spreadsheets/d/fake-watch/export')
        fingerprint = 'csv:' + hashlib.sha256(raw.encode('utf-8')).hexdigest()
        with patch('examination.sheet_scheduler.tab_content_fingerprint', return_value=fingerprint), \
             patch('examination.sync.requests.get', return_value=response):
            return scan_sheet_changes()

    def test_reader_returns_round_and_batch_of_each_block(self):
        grid = [*session_sheet_headers(self.session), self.sheet_row()]
        grid[2][V1D2 + SCORE] = '45'
        history = history_from_sheet_row(merged_headers(grid, 1), grid[2])
        self.assertEqual([(item['round'], item['templateSlot'], item.get('templateBatch')) for item in history],
                         [('Vòng 1', 1, 1), ('Vòng 1', 1, 2)])
        self.assertEqual(history[1]['templateColumns'], {'score': 'AU'})

    def test_batch_two_imports_into_its_own_result_and_leaves_batch_one(self):
        # ĐỢT 2 is added on the web ("Thêm đợt"); its scores then come from the Sheet.
        from datetime import date
        from .registration_batch import add_batch
        add_batch(self.participation, self.session.rounds[0], date(2026, 11, 8))
        row = self.sheet_row()
        row[V1D2 + DATE], row[V1D2 + SCORE] = '08/11/2026', '45'
        raw = self.csv_of([*session_sheet_headers(self.session), row])
        self.assertEqual(self.scan(raw)['autoImported'], 1)
        self.first.refresh_from_db()
        self.assertEqual((self.first.occurrence_id, self.first.score), ('day-1', '40'))
        second = self.results().get(occurrence_id='day-2')
        self.assertEqual((second.score, second.exam_date, second.round_name), ('45', '2026-11-08', 'Vòng loại Quốc gia'))
        # The same tab again changes nothing; a re-read finds no changed row.
        self.assertEqual(self.scan(raw)['changed'], 0)
        from .sync import sync_single_sheet
        SessionSheetOutbox.objects.all().delete()
        with patch('examination.sync.requests.get', return_value=MagicMock(status_code=200, text=raw, url='https://docs.google.com/x')):
            again = sync_single_sheet(self.source.url, 'now', session_id=self.session.pk, sheet_tab='FT - FIMO', automatic=True)
        self.assertEqual((again['total'], again['unchanged']), (0, True))
        self.assertEqual(self.results().count(), 2)

    def test_date_of_another_batch_skips_only_that_block_and_is_logged(self):
        row = self.sheet_row()
        row[V1D2 + DATE], row[V1D2 + SCORE] = '11/10/2026', '50'
        row[V2 + 1] = 'N-77'
        self.scan(self.csv_of([*session_sheet_headers(self.session), row]))
        self.first.refresh_from_db()
        self.assertEqual(self.first.score, '40')
        self.assertEqual(self.results().count(), 1)
        self.assertEqual(RoundResult.objects.get(participation=self.participation, round_id='national').sbd, 'N-77')
        note = LogNote.objects.get(entity_key=f'session-{self.session.pk}', content__contains='Đợt 2')
        self.assertIn('thuộc đợt 1', note.content)

    def test_stale_block_after_web_moved_the_batch_creates_no_second_result(self):
        # Khảo thí moves the candidate from ĐỢT 1 to ĐỢT 2 on the web (same result).
        old = self.sheet_row()
        self.first.occurrence_id, self.first.exam_date = 'day-2', '2026-11-08'
        self.first.save()
        row = self.sheet_row()
        # The writer never blanks a cell: the old ĐỢT 1 values stay on the Sheet.
        row[V1:V1 + 15] = old[V1:V1 + 15]
        raw = self.csv_of([*session_sheet_headers(self.session), row])
        self.scan(raw)
        self.assertEqual(list(self.results().values_list('occurrence_id', 'score')), [('day-2', '40')])
        notes = LogNote.objects.filter(entity_key=f'session-{self.session.pk}', content__contains='Thêm đợt')
        self.assertEqual(notes.count(), 1)
        # The same stale block is not logged again on the next scans.
        self.scan(raw + '\n')
        self.assertEqual(notes.count(), 1)
        self.assertEqual(self.results().count(), 1)

    def test_first_result_of_a_round_may_still_come_from_a_batch_block(self):
        RoundResult.objects.filter(participation=self.participation).delete()
        row = self.sheet_row()
        row[V1D3 + DATE], row[V1D3 + SCORE] = '10/01/2027', '30'
        self.scan(self.csv_of([*session_sheet_headers(self.session), row]))
        self.assertEqual(list(self.results().values_list('occurrence_id', 'score')), [('day-3', '30')])

    def test_block_labelled_for_another_date_is_skipped(self):
        groups, headers = session_sheet_headers(self.session)
        groups[V1D2] = 'VÒNG 1 · ĐỢT 2 (06/12/2026)'  # labelled before the batch dates changed
        row = self.sheet_row()
        row[V1D2 + SCORE] = '45'
        self.scan(self.csv_of([groups, headers, row]))
        self.assertEqual(self.results().count(), 1)
        self.assertTrue(LogNote.objects.filter(entity_key=f'session-{self.session.pk}', content__contains='06/12/2026').exists())
        # Old labels without a date still parse.
        groups[V1D2] = 'VÒNG 1 · ĐỢT 2'
        history = history_from_sheet_row(merged_headers([groups, headers, row], 1), row)
        self.assertEqual([item.get('templateBatch') for item in history], [1, 2])
        self.assertNotIn('templateBatchDay', history[1])

    def test_eligibility_only_batch_block_creates_no_result(self):
        row = self.sheet_row()
        row[V1D3] = 'Đủ điều kiện'
        row[12] = 'Trường mới'
        self.assertEqual(self.scan(self.csv_of([*session_sheet_headers(self.session), row]))['autoImported'], 1)
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.school, 'Trường mới')
        self.assertEqual(self.results().count(), 1)

    def test_preview_marks_a_migrated_row_unchanged(self):
        RoundResult.objects.create(participation=self.participation, round_id='qualifying', round_name='Vòng loại Quốc gia',
            occurrence_id='day-2', exam_date='2026-11-08', score='45', sbd='B2-01')
        old = session_export_rows(self.session.pk, compact=True)[2]
        # What expand_session_sheet_batches leaves: the old VÒNG 1 values moved to ĐỢT 2.
        migrated = old[:V1] + [''] * 15 + old[V1:V1 + 15] + [''] * 15 + old[V1 + 15:]
        grid = [*session_sheet_headers(self.session), migrated]
        headers = merged_headers(grid, 1)
        incoming = [{'code': migrated[1], 'name': migrated[2], 'exam_history': history_from_sheet_row(headers, migrated)}]
        preview = build_sheet_preview(incoming, headers, resolve_column_indices(headers), '', self.session.pk, self.source.url)
        record = preview['records'][0]['_preview']
        self.assertEqual(record['status'], 'unchanged', record['changes'])
        self.assertEqual(record['skippedBlocks'], [])


class ExpandSessionSheetBatchesCommandTests(BatchSheetBase):
    def setUp(self):
        super().setUp()
        self.sheet = ExaminationSheet.objects.create(id='fimo-expand', name='FT - FIMO',
            url='https://docs.google.com/spreadsheets/d/fake-expand/edit', sheet_tab='FT - FIMO',
            session_id=self.session.pk, stage='session-output', last_content_fingerprint='old', last_observed_fingerprint='csv:old',
            created_at=timezone.now(), updated_at=timezone.now())
        other = Candidate.objects.create(id='FT-90101', code='FT-90101', name='Trần Thử Hai', sort_key='2')
        other_participation = CandidateParticipation.objects.create(candidate=other, session=self.session)
        RoundResult.objects.create(participation=other_participation, round_id='qualifying', round_name='Vòng loại Quốc gia',
            occurrence_id='day-3', exam_date='2027-01-10')
        self.rows = []
        for code, date, score in (('FT-90100', '11/10/2026', '40'), ('FT-90102', '08/11/2026', '45'), ('FT-90101', '', '')):
            row = [''] * 70
            row[0], row[1], row[V1 + 1], row[V1 + DATE], row[V1 + SCORE] = '1', code, 'SBD-' + code, date, score
            self.rows.append(row)
        self.rows[1].append('Cột riêng của Sheet')

    def service(self, grid, after=None):
        service = MagicMock()
        service.spreadsheets().get().execute.return_value = {'sheets': [{
            'properties': {'sheetId': 8, 'title': 'FT - FIMO'},
            'merges': [{'sheetId': 8, 'startRowIndex': 0, 'endRowIndex': 1, 'startColumnIndex': V1, 'endColumnIndex': V1 + 15}]}]}
        service.spreadsheets().values().get().execute.side_effect = [{'values': grid}, {'values': after or []}]
        return service

    def call(self, service, *args):
        out = StringIO()
        with patch('examination.management.commands.expand_session_sheet_batches.build_sheets_service', return_value=service), \
             patch('examination.management.commands.expand_session_sheet_batches.tab_content_fingerprint', return_value='csv:new'):
            call_command('expand_session_sheet_batches', '--session', SESSION_ID, *args, stdout=out)
        return out.getvalue()

    def test_dry_run_lists_moves_without_writing(self):
        service = self.service([EXPORT_GROUP_HEADERS, EXPORT_HEADERS, *self.rows])
        output = self.call(service)
        service.spreadsheets().batchUpdate.assert_not_called()
        self.assertIn('chèn 30 cột', output)
        self.assertIn('Dòng 4 FT-90102: VÒNG 1 → VÒNG 1 · ĐỢT 2 (08/11/2026) (Ngày thi 08/11/2026)', output)
        self.assertIn('Dòng 5 FT-90101: VÒNG 1 → VÒNG 1 · ĐỢT 3 (10/01/2027) (đợt của kết quả trên web)', output)
        self.assertNotIn('Dòng 3 ', output)
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.last_content_fingerprint, 'old')

    def test_apply_inserts_blocks_moves_rows_and_records_fingerprints(self):
        after = [['1', 'FT-90100'], ['2', 'FT-90102'], ['3', 'FT-90101']]
        service = self.service([EXPORT_GROUP_HEADERS, EXPORT_HEADERS, *self.rows], after)
        self.call(service, '--apply')
        requests = service.spreadsheets().batchUpdate.call_args.kwargs['body']['requests']
        self.assertEqual(requests[0], {'insertDimension': {'range': {'sheetId': 8, 'dimension': 'COLUMNS',
            'startIndex': V1D2, 'endIndex': V2}, 'inheritFromBefore': True}})
        kinds = [next(iter(item)) for item in requests]
        # Unmerge row 1 of the round before any format copy, re-merge each block after.
        self.assertLess(kinds.index('unmergeCells'), kinds.index('copyPaste'))
        self.assertEqual(requests[kinds.index('unmergeCells')]['unmergeCells']['range'],
                         {'sheetId': 8, 'startRowIndex': 0, 'endRowIndex': 1, 'startColumnIndex': V1, 'endColumnIndex': V2})
        merges = [item['mergeCells']['range']['startColumnIndex'] for item in requests if 'mergeCells' in item]
        self.assertEqual(merges, [V1, V1D2, V1D3])
        first_merge = kinds.index('mergeCells')
        format_copies = [index for index, item in enumerate(requests)
                         if item.get('copyPaste', {}).get('pasteType') in ('PASTE_FORMAT', 'PASTE_DATA_VALIDATION')]
        self.assertLess(max(format_copies), first_merge)
        # Data rows of a new block take format and validation from the same ĐỢT 1 column.
        data_copies = {(item['copyPaste']['pasteType'], item['copyPaste']['destination']['startColumnIndex'])
                       for item in requests if item.get('copyPaste', {}).get('source', {}).get('startRowIndex') == 2
                       and 'endRowIndex' not in item['copyPaste']['source']}
        self.assertEqual(data_copies, {(kind, start) for kind in ('PASTE_FORMAT', 'PASTE_DATA_VALIDATION') for start in (V1D2, V1D3)})
        self.assertTrue(all(requests[index]['copyPaste']['source']['startColumnIndex'] == V1 for index in format_copies))
        moves = [(item['copyPaste']['source']['startRowIndex'], item['copyPaste']['destination']['startColumnIndex'])
                 for item in requests if item.get('copyPaste', {}).get('pasteType') == 'PASTE_NORMAL']
        self.assertEqual(moves, [(3, V1D2), (4, V1D3)])
        cleared = [(item['updateCells']['range']['startRowIndex'], item['updateCells']['range']['startColumnIndex'])
                   for item in requests if 'updateCells' in item and 'rows' not in item['updateCells']]
        self.assertEqual(cleared, [(3, V1 + 1), (3, V1 + DATE), (3, V1 + SCORE), (4, V1 + 1)])
        labels = {(item['updateCells']['range']['startRowIndex'], item['updateCells']['range']['startColumnIndex']):
                  item['updateCells']['rows'][0]['values'][0]['userEnteredValue']['stringValue']
                  for item in requests if 'rows' in item.get('updateCells', {})}
        self.assertEqual((labels[(0, V1)], labels[(0, V1D2)], labels[(0, V1D3)]), ('VÒNG 1 · ĐỢT 1 (11/10/2026)', 'VÒNG 1 · ĐỢT 2 (08/11/2026)', 'VÒNG 1 · ĐỢT 3 (10/01/2027)'))
        self.assertEqual(labels[(1, V1D2 + DATE)], 'Ngày thi')
        self.assertNotIn((0, V2), labels)  # VÒNG 2 and later cells are only shifted, never rewritten
        service.spreadsheets().values().clear.assert_not_called()
        self.sheet.refresh_from_db()
        self.assertEqual(self.sheet.last_content_fingerprint, sheet_values_fingerprint(after))
        self.assertEqual(self.sheet.last_observed_fingerprint, 'csv:new')

    def test_apply_fails_at_once_when_the_sheet_writer_holds_the_lock(self):
        from contextlib import contextmanager
        from django.core.management.base import CommandError
        calls = []

        @contextmanager
        def busy(blocking=True):
            calls.append(blocking)
            raise BlockingIOError
            yield
        service = self.service([EXPORT_GROUP_HEADERS, EXPORT_HEADERS, *self.rows])
        with patch('examination.management.commands.expand_session_sheet_batches._single_worker', busy):
            with self.assertRaisesMessage(CommandError, 'đang chạy'):
                self.call(service, '--apply')
            self.call(self.service([EXPORT_GROUP_HEADERS, EXPORT_HEADERS, *self.rows]))  # a dry run needs no lock
        self.assertEqual(calls, [False])
        service.spreadsheets().batchUpdate.assert_not_called()

    def test_renumbered_batches_are_refused(self):
        from django.core.management.base import CommandError
        groups, headers = session_sheet_headers(self.session)
        # A batch was inserted before 08/11: the tab's ĐỢT 2 holds another date's data.
        rounds = batched_rounds()
        rounds[0]['slots'].insert(1, {'id': 'day-1b', 'date': '2026-10-25'})
        self.session.rounds = rounds
        self.session.save()
        service = self.service([groups, headers, ['1', 'FT-90100']])
        with self.assertRaisesMessage(CommandError, 'không tự đánh số lại'):
            self.call(service, '--apply')
        service.spreadsheets().batchUpdate.assert_not_called()

    def test_a_later_batch_is_appended_after_the_existing_blocks(self):
        groups, headers = session_sheet_headers(self.session)
        rounds = batched_rounds()
        rounds[0]['slots'].append({'id': 'day-4', 'date': '2027-02-07'})
        self.session.rounds = rounds
        self.session.save()
        service = self.service([groups, headers, ['1', 'FT-90100']], [['1', 'FT-90100']])
        self.call(service, '--apply')
        requests = service.spreadsheets().batchUpdate.call_args.kwargs['body']['requests']
        self.assertEqual(requests[0]['insertDimension']['range'], {'sheetId': 8, 'dimension': 'COLUMNS', 'startIndex': V2, 'endIndex': V2 + 15})
        labels = [item['updateCells']['rows'][0]['values'][0]['userEnteredValue']['stringValue']
                  for item in requests if 'rows' in item.get('updateCells', {}) and item['updateCells']['range']['startRowIndex'] == 0]
        self.assertEqual(labels, ['VÒNG 1 · ĐỢT 4 (07/02/2027)'])

    def test_second_apply_does_nothing(self):
        expanded = [*session_sheet_headers(self.session), ['1', 'FT-90100']]
        service = self.service(expanded)
        output = self.call(service, '--apply')
        service.spreadsheets().batchUpdate.assert_not_called()
        self.assertIn('đã đủ cột theo đợt', output)


class LocalScoreRepairSlotTests(TestCase):
    def test_round_is_taken_from_the_block_slot_not_the_list_position(self):
        import os
        import tempfile
        from openpyxl import Workbook
        session = ExamSession.objects.create(id='repair-slots', competition_id='DEMO', code='DEMO', name='Demo',
            parent='FT', organizer='FT', time='2026-2027', sort_key='repair',
            rounds=[{'id': 'r1', 'name': 'Vòng loại'}, {'id': 'r2', 'name': 'Chung kết'}])
        candidate = Candidate.objects.create(id='FT-90200', code='FT-90200', name='Lê Thử Ba', sort_key='1')
        participation = CandidateParticipation.objects.create(candidate=candidate, session=session)
        first = RoundResult.objects.create(participation=participation, round_id='r1', round_name='Vòng loại', score='10')
        final = RoundResult.objects.create(participation=participation, round_id='r2', round_name='Chung kết', score='')
        row = [''] * 70
        row[1], row[2], row[3] = 'FT-90200', 'Lê Thử Ba', '01/01/2014'
        row[V1D2 + SCORE] = '77'  # only the VÒNG 2 block (column 36) has a score
        workbook = Workbook()
        for values in (EXPORT_GROUP_HEADERS, EXPORT_HEADERS, row):
            workbook.active.append(values)
        # The command keeps the read-only workbook open; Windows cannot delete it right away.
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as folder:
            path = os.path.join(folder, 'repair.xlsx')
            workbook.save(path)
            call_command('import_local_score_repairs', file=path, session=session.pk, stdout=StringIO())
        first.refresh_from_db()
        final.refresh_from_db()
        self.assertEqual((first.score, final.score), ('10', '77'))
