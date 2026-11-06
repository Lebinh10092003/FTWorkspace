"""Route each calendar date to its annual workbook, including webhooks."""
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date, timedelta
from functools import wraps

from rest_framework.response import Response

from authentication.models import SystemConfig
from authentication.monthly_sheets import get_monthly_sheet_links
from integrations.google_sheets import extract_spreadsheet_id

ANNUAL_WORKBOOKS = {
    2026: '1kWiJdTSM_6ZDeLTGCWvDA3num5n0DmRH2Tv-6AwuBYc',
    2027: '1e1lNQPDV-nr9MF1swK17Y32bWwuYyP2D2FDJbFnEwtw',
}
_selected_workbook = ContextVar('work_schedule_workbook', default=None)


def workbook_for_date(day):
    configured = get_monthly_sheet_links(day.strftime('%Y-%m')).get('work_schedule', '')
    workbook = extract_spreadsheet_id(configured) or ANNUAL_WORKBOOKS.get(day.year)
    if not workbook:
        raise ValueError(f'Chưa cấu hình Lịch công tác cho năm {day.year}.')
    return workbook


def selected_workbook():
    return _selected_workbook.get()


@contextmanager
def calendar_workbook(workbook):
    token = _selected_workbook.set(workbook)
    try:
        yield
    finally:
        _selected_workbook.reset(token)


def workbook_ranges(start, end):
    config = SystemConfig.objects.filter(key='monthly_sheet_links').first()
    links = ((config.data or {}).get('links', {}).get('work_schedule', {}) if config else {})
    years = set(ANNUAL_WORKBOOKS)
    years.update(int(month[:4]) for month in links if len(month) == 7 and month[:4].isdigit())
    for year in sorted(years):
        first, last = max(start, date(year, 1, 1)), min(end, date(year, 12, 31))
        if first > last:
            continue
        spans = []
        for month in range(first.month, last.month + 1):
            month_start = max(first, date(year, month, 1))
            next_month = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
            month_end = min(last, next_month - timedelta(days=1))
            workbook = workbook_for_date(month_start)
            if spans and spans[-1][0] == workbook:
                spans[-1] = (workbook, spans[-1][1], month_end)
            else:
                spans.append((workbook, month_start, month_end))
        yield from spans


def sheet_webhook_workbook(handler):
    @wraps(handler)
    def wrapped(request, *args, **kwargs):
        from .sheet_sync import _parse_date
        supplied = str(request.data.get('spreadsheet_id') or '').strip()
        values = request.data.get('values')
        day = _parse_date(str(values[1])) if isinstance(values, list) and len(values) > 1 else None
        try:
            expected = workbook_for_date(day) if day else ANNUAL_WORKBOOKS[2026]
            allowed = {workbook for workbook, _, _ in workbook_ranges(date(2026, 1, 1), date(9999, 12, 31))}
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        if supplied and (supplied not in allowed or (day and supplied != expected)):
            return Response({'error': 'File lịch công tác không khớp ngày hoặc chưa được cấu hình.'}, status=400)
        with calendar_workbook(supplied or expected):
            return handler(request, *args, **kwargs)
    return wrapped
