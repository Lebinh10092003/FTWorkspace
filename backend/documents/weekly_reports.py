"""Server-side pipeline for the Fermat weekly work reports."""

from __future__ import annotations

import re
import unicodedata
from hashlib import sha256
import json
from collections import defaultdict
from datetime import date, timedelta

from django.conf import settings
from django.utils import timezone

from authentication.models import SystemConfig, UserProfile
from authentication.notifications import notify_workspace
from integrations.google_sheets import build_docs_service, build_sheets_service
from work_schedule.models import WorkItem

from .models import WeeklyReport


DEFAULT_REPORT_SHEET_ID = "1yF78pcry1Pls6M-8f373eVLnsSCVX_QOvvfpD5SYYkM"
DEFAULT_REPORT_DOCUMENT_ID = "1TxSOV4atjOgNcRbW6h3Z_KFBoO7Rr8R3vbIzaXiOij8"
DONE_STATUSES = {WorkItem.STATUS_COMPLETED, WorkItem.STATUS_REVIEWED}


def _main_config():
    config, _ = SystemConfig.objects.get_or_create(key="main")
    return config


def report_sheet_id():
    return str(getattr(settings, "WEEKLY_REPORT_SHEET_ID", "") or DEFAULT_REPORT_SHEET_ID).strip()


def report_document_id():
    return str(getattr(settings, "WEEKLY_REPORT_DOCUMENT_ID", "") or DEFAULT_REPORT_DOCUMENT_ID).strip()


def week_start(value):
    return value - timedelta(days=value.weekday())


def report_generation_options(*, today=None):
    """Choices shown by the web dialog for a manually created report packet.

    A user may make the current week or at most three completed weeks before
    it.  Monday through Thursday defaults to the previous, already-finished
    week; Friday through Sunday defaults to the week that is ending.
    """
    today = today or timezone.localdate()
    current_start = week_start(today)
    default_start = current_start - timedelta(days=7) if today.weekday() <= 3 else current_start
    options = []
    for offset in range(4):
        completed_start = current_start - timedelta(days=7 * offset)
        planned_start = completed_start + timedelta(days=7)
        completed_iso = completed_start.isocalendar()
        planned_iso = planned_start.isocalendar()
        options.append({
            "weekStart": completed_start.isoformat(),
            "completedWeek": completed_iso.week,
            "completedYear": completed_iso.year,
            "plannedWeek": planned_iso.week,
            "plannedYear": planned_iso.year,
            "label": f"Tuần {completed_iso.week} ({completed_start.strftime('%d/%m')} – {(planned_start - timedelta(days=1)).strftime('%d/%m/%Y')})",
            "isDefault": completed_start == default_start,
        })
    return options


def resolve_report_week_start(value, *, today=None):
    """Validate an ISO Monday supplied by the manual-create dialog."""
    try:
        target = date.fromisoformat(str(value or ""))
    except ValueError as exc:
        raise ValueError("Tuần báo cáo không hợp lệ.") from exc
    if target != week_start(target):
        raise ValueError("Tuần báo cáo phải bắt đầu vào thứ Hai.")
    permitted = {item["weekStart"] for item in report_generation_options(today=today)}
    if target.isoformat() not in permitted:
        raise ValueError("Chỉ được tạo báo cáo tuần hiện tại hoặc tối đa ba tuần trước đó.")
    return target


def _identity(value):
    value = unicodedata.normalize("NFD", str(value or "").casefold())
    value = "".join(char for char in value if unicodedata.category(char) != "Mn").replace("đ", "d")
    value = re.sub(r"\b(?:mr|ms)\.?\s+", "", value)
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def _report_key(email, completed_week, planned_week, fallback=""):
    identity = _identity(email or fallback).replace(" ", "-") or "unknown"
    return f"{completed_week}-{planned_week}-{identity}"[:180]


def _task_text(item):
    text = str(item.title or "").strip()
    if item.start_time:
        text = f"{item.start_time.strftime('%H:%M')} · {text}"
    return text


def _difficulty_text(item):
    note = str(item.progress_note or item.review_note or "").strip()
    suffix = f" — {note}" if note else " — Chưa hoàn thành theo lịch công tác."
    return f"{_task_text(item)}{suffix}"


def build_schedule_reports(*, today=None, report_week_start=None, employee_email=None):
    """Create/refresh draft reports from the already-synchronised work schedule."""
    current_start = week_start(report_week_start) if report_week_start else week_start(today or timezone.localdate())
    next_start = current_start + timedelta(days=7)
    next_end = next_start + timedelta(days=7)
    current_week = current_start.isocalendar().week
    planned_week = next_start.isocalendar().week

    items = (
        WorkItem.objects.select_related("executor")
        .filter(work_date__gte=current_start, work_date__lt=next_end)
        .order_by("executor__name", "work_date", "daily_order", "start_time", "id")
    )
    grouped = defaultdict(list)
    for item in items:
        if item.executor and item.executor.employment_status == "ACTIVE":
            grouped[item.executor].append(item)

    reports = []
    # A report tab is useful even for someone who has no row this fortnight: it
    # gives the AI a stable employee surface and makes the "no scheduled work"
    # state explicit instead of silently omitting that employee.
    employees = UserProfile.objects.filter(employment_status="ACTIVE")
    if employee_email:
        employees = employees.filter(email=str(employee_email).strip().lower())
    employees = employees.order_by("name", "email")
    for employee in employees:
        employee_items = grouped.get(employee, [])
        current_items = [item for item in employee_items if current_start <= item.work_date < next_start]
        future_items = [item for item in employee_items if next_start <= item.work_date < next_end]
        key = _report_key(employee.email, current_week, planned_week)
        report, created = WeeklyReport.objects.get_or_create(
            report_key=key,
            defaults={
                "employee_email": employee.email,
                "employee_name": employee.name or employee.email,
                "completed_week": current_week,
                "planned_week": planned_week,
            },
        )
        # A retry must never overwrite prose that the AI has already published
        # in the Google Doc for this employee and reporting period.
        if created or report.status != WeeklyReport.STATUS_PUBLISHED:
            report.employee_email = employee.email
            report.employee_name = employee.name or employee.email
            report.completed_week = current_week
            report.planned_week = planned_week
            report.completed_items = [_task_text(item) for item in current_items if item.status in DONE_STATUSES]
            report.difficulties = [_difficulty_text(item) for item in current_items if item.status not in DONE_STATUSES]
            report.planned_items = [_task_text(item) for item in future_items]
            report.status = WeeklyReport.STATUS_SNAPSHOT
            report.save()
        reports.append(report)
    return reports


def _sheet_tab_title(report, used):
    base = re.sub(r"[\\/:?*\[\]]", " ", report.employee_name).strip() or report.employee_email
    base = re.sub(r"\s+", " ", base)
    email_label = re.sub(r"[^A-Za-z0-9._-]+", "-", report.employee_email.split("@", 1)[0]).strip("-") or str(report.pk)
    candidate = f"{base[:82 - len(email_label)]} · {email_label}".strip()[:100]
    if candidate.casefold() in used:
        candidate = f"{candidate[:94]}-{report.pk}"[:100]
    used.add(candidate.casefold())
    return candidate


def _sheet_rows(report):
    rows = [
        [f"BÁO CÁO TUẦN {report.completed_week} VÀ KẾ HOẠCH TUẦN {report.planned_week}"],
        ["Nhân viên", report.employee_name],
        ["Email", report.employee_email],
        [],
        ["Kỳ", "Nhóm", "Trạng thái", "Nội dung"],
    ]
    for item in report.completed_items:
        rows.append([f"Tuần {report.completed_week}", "Kết quả", "Hoàn thành", item])
    for item in report.difficulties:
        rows.append([f"Tuần {report.completed_week}", "Tồn tại", "Chưa hoàn thành", item])
    for item in report.planned_items:
        rows.append([f"Tuần {report.planned_week}", "Kế hoạch", "Dự kiến", item])
    if len(rows) == 5:
        rows.append([f"Tuần {report.completed_week}", "Lịch công tác", "Chưa có", "Chưa có công việc trong hai tuần."])
    return rows


def sync_reports_to_staging_sheet(reports, *, google_token=None):
    """Refresh one compact current-report tab per employee in the shared Sheet."""
    reports = list(reports)
    config = _main_config()
    service = build_sheets_service(google_token or config.last_google_access_token, config.data or {})
    spreadsheet_id = report_sheet_id()
    metadata = service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields="sheets(properties(sheetId,title))",
    ).execute()
    existing = {
        sheet.get("properties", {}).get("title"): sheet.get("properties", {}).get("sheetId")
        for sheet in metadata.get("sheets", [])
        if sheet.get("properties", {}).get("title")
    }
    # The name-plus-email title remains stable on later runs, including manual
    # one-person runs; the set protects the rare case of duplicate labels.
    used = set()
    report_tabs = [(report, _sheet_tab_title(report, used)) for report in reports]
    additions = [
        {"addSheet": {"properties": {"title": title, "gridProperties": {"rowCount": 200, "columnCount": 8}}}}
        for _, title in report_tabs if title not in existing
    ]
    if additions:
        service.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body={"requests": additions}).execute()
        metadata = service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            fields="sheets(properties(sheetId,title))",
        ).execute()
        existing = {
            sheet.get("properties", {}).get("title"): sheet.get("properties", {}).get("sheetId")
            for sheet in metadata.get("sheets", [])
            if sheet.get("properties", {}).get("title")
        }

    format_requests = []
    for report, title in report_tabs:
        rows = _sheet_rows(report)
        # This is a staging surface for the next AI pass. Historical snapshots
        # remain in WeeklyReport; the sheet deliberately shows only the newest
        # two-week packet for each employee.
        service.spreadsheets().values().clear(
            spreadsheetId=spreadsheet_id,
            range=f"'{title}'!A:Z",
            body={},
        ).execute()
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"'{title}'!A1",
            valueInputOption="RAW",
            body={"values": rows},
        ).execute()
        sheet_id = existing[title]
        format_requests.extend([
            {"unmergeCells": {"range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 4}}},
            {"mergeCells": {"range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 4}, "mergeType": "MERGE_ALL"}},
            {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 4}, "cell": {"userEnteredFormat": {"textFormat": {"bold": True}, "horizontalAlignment": "CENTER", "backgroundColor": {"red": 0.88, "green": 0.93, "blue": 1}}}, "fields": "userEnteredFormat(textFormat,horizontalAlignment,backgroundColor)"}},
            {"repeatCell": {"range": {"sheetId": sheet_id, "startRowIndex": 4, "endRowIndex": 5, "startColumnIndex": 0, "endColumnIndex": 4}, "cell": {"userEnteredFormat": {"textFormat": {"bold": True}, "backgroundColor": {"red": 0.94, "green": 0.94, "blue": 0.94}}}, "fields": "userEnteredFormat(textFormat,backgroundColor)"}},
            {"updateSheetProperties": {"properties": {"sheetId": sheet_id, "gridProperties": {"frozenRowCount": 5}}, "fields": "gridProperties.frozenRowCount"}},
            {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": 1}, "properties": {"pixelSize": 110}, "fields": "pixelSize"}},
            {"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 1, "endIndex": 4}, "properties": {"pixelSize": 160}, "fields": "pixelSize"}},
        ])
    if format_requests:
        service.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body={"requests": format_requests}).execute()
    return {"spreadsheetId": spreadsheet_id, "updatedTabs": len(report_tabs)}


def notify_staged_reports(reports):
    """Put the completed Sheet-stage event into the Workspace bell inbox."""
    created = 0
    for report in reports:
        if not report.employee_email:
            continue
        _, was_created = notify_workspace(
            event_key=f"weekly-report-staged-{report.report_key}"[:255],
            title="Gói báo cáo tuần đã sẵn sàng",
            message=(
                f"Dữ liệu tuần {report.completed_week} và kế hoạch tuần "
                f"{report.planned_week} của bạn đã được chuyển vào Google Sheets."
            ),
            severity="success",
            category="weekly-report",
            action_url="/communication-tools/weekly-report",
            target_emails=[report.employee_email],
        )
        created += int(was_created)
    return created


def _tab_body(tab):
    return (tab.get("documentTab") or tab).get("body") or {}


def _tab_properties(tab):
    return tab.get("tabProperties") or (tab.get("documentTab") or {}).get("tabProperties") or {}


def _paragraphs(body):
    values = []
    for block in body.get("content") or []:
        paragraph = block.get("paragraph") or {}
        text = "".join(
            element.get("textRun", {}).get("content", "")
            for element in paragraph.get("elements") or []
        ).strip()
        if text:
            values.extend(line.strip() for line in text.splitlines() if line.strip())
    return values


def parse_weekly_report_tab(tab):
    """Parse the stable three-section report format written by the AI."""
    lines = _paragraphs(_tab_body(tab))
    text = "\n".join(lines)
    heading_map = {
        1: "completed_items",
        2: "difficulties",
        3: "planned_items",
    }
    buckets = {value: [] for value in heading_map.values()}
    current = None
    completed_week = None
    planned_week = None
    for line in lines:
        heading = re.match(r"^\s*([123])\.\s*(.*)$", line, flags=re.IGNORECASE)
        if heading:
            current = heading_map[int(heading.group(1))]
            week_match = re.search(r"tuần\s+(\d{1,2})", heading.group(2), flags=re.IGNORECASE)
            if week_match:
                if current == "completed_items":
                    completed_week = int(week_match.group(1))
                elif current == "planned_items":
                    planned_week = int(week_match.group(1))
            continue
        if current:
            value = re.sub(r"^\s*[-•–]\s*", "", line).strip()
            if value:
                buckets[current].append(value)

    title_weeks = re.search(r"kết quả\s+tuần\s+(\d{1,2}).*?tuần\s+(\d{1,2})", text, flags=re.IGNORECASE | re.DOTALL)
    if title_weeks:
        completed_week = completed_week or int(title_weeks.group(1))
        planned_week = planned_week or int(title_weeks.group(2))
    employee = re.search(r"\(([^()]+)\)", text)
    properties = _tab_properties(tab)
    employee_name = (employee.group(1).strip() if employee else str(properties.get("title") or "").strip())
    if not employee_name or not completed_week or not planned_week:
        return None
    return {
        "employee_name": employee_name,
        "completed_week": completed_week,
        "planned_week": planned_week,
        "google_tab_id": str(properties.get("tabId") or ""),
        **buckets,
    }


def _profile_for_report_name(name):
    target = _identity(name)
    if not target:
        return None
    profiles = list(UserProfile.objects.filter(employment_status="ACTIVE").only("email", "name"))
    exact = [profile for profile in profiles if _identity(profile.name) == target]
    if len(exact) == 1:
        return exact[0]
    target_parts = target.split()
    suffix = [
        profile for profile in profiles
        if _identity(profile.name).split()[-len(target_parts):] == target_parts
    ]
    return suffix[0] if len(suffix) == 1 else None


def sync_reports_from_google_doc(*, google_token=None):
    """Pull AI-authored tabs from the source Doc into the web report store."""
    config = _main_config()
    document_id = report_document_id()
    service = build_docs_service(google_token or config.last_google_access_token, config.data or {})
    document = service.documents().get(documentId=document_id, includeTabsContent=True).execute()
    revision = str(document.get("revisionId") or "")
    created = updated = skipped = 0
    now = timezone.now()
    for tab in document.get("tabs") or []:
        parsed = parse_weekly_report_tab(tab)
        if not parsed:
            skipped += 1
            continue
        profile = _profile_for_report_name(parsed["employee_name"])
        email = profile.email if profile else ""
        key = _report_key(email, parsed["completed_week"], parsed["planned_week"], parsed["google_tab_id"] or parsed["employee_name"])
        # Google Docs exposes one revision for the complete multi-tab document.
        # Store a content fingerprint instead so changing Ms A's tab does not
        # re-notify everyone whose untouched tab belongs to the same document.
        content_fingerprint = sha256(json.dumps({
            "employee_name": parsed["employee_name"],
            "completed_week": parsed["completed_week"],
            "planned_week": parsed["planned_week"],
            "completed_items": parsed["completed_items"],
            "difficulties": parsed["difficulties"],
            "planned_items": parsed["planned_items"],
        }, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        report, is_created = WeeklyReport.objects.get_or_create(
            report_key=key,
            defaults={
                "employee_email": email,
                "employee_name": profile.name if profile else parsed["employee_name"],
                "completed_week": parsed["completed_week"],
                "planned_week": parsed["planned_week"],
            },
        )
        changed = is_created or any([
            report.completed_items != parsed["completed_items"],
            report.difficulties != parsed["difficulties"],
            report.planned_items != parsed["planned_items"],
            report.source_revision != content_fingerprint,
            report.status != WeeklyReport.STATUS_PUBLISHED,
        ])
        if not changed:
            continue
        report.employee_email = email or report.employee_email
        report.employee_name = profile.name if profile else parsed["employee_name"]
        report.completed_week = parsed["completed_week"]
        report.planned_week = parsed["planned_week"]
        report.completed_items = parsed["completed_items"]
        report.difficulties = parsed["difficulties"]
        report.planned_items = parsed["planned_items"]
        report.status = WeeklyReport.STATUS_PUBLISHED
        report.google_document_id = document_id
        report.google_tab_id = parsed["google_tab_id"]
        report.source_revision = content_fingerprint
        report.document_synced_at = now
        report.save()
        if is_created:
            created += 1
        else:
            updated += 1
        notify_workspace(
            event_key=f"weekly-report-{report.report_key}-{content_fingerprint}"[:255],
            title="Báo cáo tuần mới đã sẵn sàng",
            message=f"Đã đồng bộ báo cáo tuần {report.completed_week} và kế hoạch tuần {report.planned_week} của {report.employee_name}.",
            severity="success",
            category="weekly-report",
            action_url="/communication-tools/weekly-report",
            target_roles=["ADMIN", "MANAGER"],
            target_emails=[report.employee_email] if report.employee_email else [],
        )
    return {"documentId": document_id, "revision": revision, "created": created, "updated": updated, "skipped": skipped}


def run_weekly_report_pipeline(*, today=None, report_week_start=None, employee_email=None, google_token=None, sync_source=True, sync_document=False):
    """Create the Sheet packet, either by the server timer or a web request.

    Docs/AI processing is intentionally opt-in; the current release stops once
    the selected period has been staged into the reporting Sheet.
    """
    source_result = None
    if sync_source:
        from work_schedule.sheet_sync import initial_two_way_sync
        source_result = initial_two_way_sync(google_token=google_token)
    current_start = week_start(report_week_start) if report_week_start else week_start(today or timezone.localdate())
    reports = build_schedule_reports(
        report_week_start=current_start,
        employee_email=employee_email,
    )
    sheet_result = sync_reports_to_staging_sheet(reports, google_token=google_token)
    notification_count = notify_staged_reports(reports)
    document_result = sync_reports_from_google_doc(google_token=google_token) if sync_document else None
    return {
        "source": source_result,
        "weekStart": current_start.isoformat(),
        "completedWeek": current_start.isocalendar().week,
        "plannedWeek": (current_start + timedelta(days=7)).isocalendar().week,
        "reports": len(reports),
        "sheet": sheet_result,
        "notificationsCreated": notification_count,
        "document": document_result,
    }
