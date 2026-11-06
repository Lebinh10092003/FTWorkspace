from datetime import date
from unittest.mock import MagicMock, patch

from django.test import TestCase

from .sheet_routing import ANNUAL_WORKBOOKS, calendar_workbook, workbook_for_date, workbook_ranges
from .sheet_sync import _spreadsheet_id, push_groups_to_sheet, pull_from_sheet


class AnnualCalendarTests(TestCase):
    def test_year_boundary_routes_each_group_to_its_own_file(self):
        calls = []
        def capture(service, groups, *args):
            calls.append((_spreadsheet_id(), groups))
            return {'groups': len(groups), 'tasks': len(groups), 'conflicts': []}
        old = ('staff@example.com', date(2026, 12, 31))
        new = ('staff@example.com', date(2027, 1, 1))
        with patch('work_schedule.sheet_sync._push_groups_to_sheet', side_effect=capture):
            result = push_groups_to_sheet(MagicMock(), {old, new})
        self.assertCountEqual(calls, [(ANNUAL_WORKBOOKS[2026], {old}), (ANNUAL_WORKBOOKS[2027], {new})])
        self.assertEqual(result['groups'], 2)

    def test_full_pull_partitions_ranges_and_combines_results(self):
        calls = []
        def capture(service, start, end):
            calls.append((_spreadsheet_id(), start, end))
            return {'created': 1, 'groups': {('staff@example.com', start)}}
        with patch('work_schedule.sheet_sync._pull_from_sheet', side_effect=capture):
            result = pull_from_sheet(MagicMock(), date(2026, 12, 30), date(2027, 1, 2))
        self.assertEqual(calls, [
            (ANNUAL_WORKBOOKS[2026], date(2026, 12, 30), date(2026, 12, 31)),
            (ANNUAL_WORKBOOKS[2027], date(2027, 1, 1), date(2027, 1, 2)),
        ])
        self.assertEqual(result['created'], 2)
        self.assertEqual(len(result['groups']), 2)

    def test_webhook_context_does_not_export_other_year_groups(self):
        groups = {('staff@example.com', date(2026, 12, 31)), ('staff@example.com', date(2027, 1, 1))}
        with calendar_workbook(ANNUAL_WORKBOOKS[2027]), patch('work_schedule.sheet_sync._push_groups_to_sheet') as push:
            push.return_value = {'groups': 1, 'tasks': 1}
            push_groups_to_sheet(MagicMock(), groups)
            self.assertEqual(push.call_args.args[1], {('staff@example.com', date(2027, 1, 1))})

    def test_unconfigured_year_never_falls_back_to_previous_year(self):
        with self.assertRaises(ValueError):
            workbook_for_date(date(2028, 1, 1))

    def test_full_range_only_reads_configured_years(self):
        spans = list(workbook_ranges(date(2026, 11, 1), date(9999, 12, 31)))
        self.assertEqual(len(spans), 2)
        self.assertEqual(spans[-1][2], date(2027, 12, 31))
