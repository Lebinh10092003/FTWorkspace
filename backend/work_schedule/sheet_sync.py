import json
import logging
import re
import unicodedata
import uuid
from calendar import monthrange
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timedelta

from django.db import models, transaction
from django.utils import timezone

from authentication.models import SystemConfig, UserProfile
from authentication.monthly_sheets import get_monthly_sheet_links
from attendance.models import TimesheetEntry
from attendance.sheet_sync import push_groups_to_attendance_sheet
from integrations.google_sheets import build_sheets_service, extract_spreadsheet_id

from .models import WorkItem, WorkScheduleSheetChange, WorkScheduleSheetSyncLease
from .retention import purge_expired_work_schedule, retained_from
from .sheet_parser import is_personal_task, without_task_tags, leader_assessment_notes, parse_leader_review, assessment_notes, parse_sheet_tasks, status_from_note, training_end
from .signals import suppress_sheet_queue


logger = logging.getLogger(__name__)


DEFAULT_SPREADSHEET_ID = "1kWiJdTSM_6ZDeLTGCWvDA3num5n0DmRH2Tv-6AwuBYc"
SHEET_NAME = "Lịch công tác"
DEFAULT_SHEET_ID = 1443841670
EMPLOYEE_EMAILS = {
    "EMP-E6557326": "thuanld@fermat.edu.vn",
    "EMP-0FA847B0": "dungpv@fermat.edu.vn",
    "EMP-198EA04B": "liennt@fermat.edu.vn",
    "EMP-AECADFA4": "hanh@fermat.edu.vn",
    "EMP-9864ED57": "binhlv@fermat.edu.vn",
    "EMP-AA0FCF6E": "phongnt@fermat.edu.vn",
    "EMP-564CB158": "phuongnt@fermat.edu.vn",
    "EMP-000A3BD2": "tienthm@fermat.edu.vn",
    "EMP-ABD98A8B": "sondc@fermat.edu.vn",
    "EMP-9EC1EEB6": "hadk1@fermat.edu.vn",
}
EMAIL_EMPLOYEES = {email: employee_id for employee_id, email in EMPLOYEE_EMAILS.items()}
SHEET_STAFF_EMAILS = {
    "thuận": "thuanld@fermat.edu.vn",
    "dũng": "dungpv@fermat.edu.vn",
    "liên": "liennt@fermat.edu.vn",
    "hà": "hanh@fermat.edu.vn",
    "bình": "binhlv@fermat.edu.vn",
    "phong": "phongnt@fermat.edu.vn",
    "phương": "phuongnt@fermat.edu.vn",
    "tiến": "tienthm@fermat.edu.vn",
    "sơn": "sondc@fermat.edu.vn",
    "khánh hà": "hadk1@fermat.edu.vn",
}
WEEKDAYS = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ Nhật"]
INCREMENTAL_SYNC_LEASE_SECONDS = 300
TWO_WAY_SYNC_LEASE_SECONDS = 1800
SHEET_COLUMN_ALIASES = {
    "weekday": ("thứ",),
    "date": ("ngày",),
    "week": ("tuần",),
    "staff": ("chủ trì", "nhân sự"),
    "content": ("nội dung công việc",),
    "self_notes": ("tự đánh giá",),
    "attendance": ("chấm công",),
    "leader_notes": ("lãnh đạo đánh giá", "lđ đánh giá", "ld đánh giá"),
    "employee_id": ("employeeid", "employee id"),
    "record_id": ("web_record_id",),
    "task_ids": ("web_task_ids",),
    "sync_hash": ("web_sync_hash",),
}
CANONICAL_COLUMNS = (
    "weekday", "date", "week", "staff", "content", "self_notes",
    "leader_notes", "employee_id", "record_id", "task_ids", "sync_hash",
)
LEGACY_COLUMNS = {name: index for index, name in enumerate(CANONICAL_COLUMNS)}


def deterministic_sheet_uid(row_number, task_index):
    return uuid.UUID(f"6ae71379-0000-5000-8000-{row_number:06x}{task_index:06x}")


def _service(google_token=None):
    main = SystemConfig.objects.filter(key="main").first()
    config_data = main.data if main and isinstance(main.data, dict) else {}
    token = google_token or (main.last_google_access_token if main else None)
    return build_sheets_service(token, config_data)


def _spreadsheet_id():
    month = timezone.localdate().strftime("%Y-%m")
    configured = get_monthly_sheet_links(month).get("work_schedule", "")
    return extract_spreadsheet_id(configured) or DEFAULT_SPREADSHEET_ID


def _sheet_properties(service):
    metadata = service.spreadsheets().get(
        spreadsheetId=_spreadsheet_id(), fields="sheets.properties"
    ).execute()
    target = next(
        (sheet.get("properties", {}) for sheet in metadata.get("sheets", [])
         if sheet.get("properties", {}).get("title") == SHEET_NAME
         or sheet.get("properties", {}).get("sheetId") == DEFAULT_SHEET_ID),
        None,
    )
    if not target:
        raise RuntimeError("Không tìm thấy tab Lịch công tác.")
    return target


def _header_key(value):
    return _normalise_staff_name(value).replace(" ", "")


def _column_letter(index):
    """Convert a zero-based column index to its A1 letter."""
    result = ""
    value = index + 1
    while value:
        value, remainder = divmod(value - 1, 26)
        result = chr(65 + remainder) + result
    return result


def _sheet_columns(service):
    spreadsheet_id = _spreadsheet_id()
    cached = getattr(service, "_work_schedule_columns", None)
    if isinstance(cached, dict) and cached.get("spreadsheet_id") == spreadsheet_id:
        return dict(cached["columns"]), list(cached["headers"])
    result = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"'{SHEET_NAME}'!A2:ZZ2",
        valueRenderOption="FORMATTED_VALUE",
    ).execute()
    headers = (result.get("values") or [[]])[0]
    positions = {}
    for index, header in enumerate(headers):
        positions.setdefault(_header_key(header), index)
    columns = {}
    for name, aliases in SHEET_COLUMN_ALIASES.items():
        match = next((positions.get(_header_key(alias)) for alias in aliases if _header_key(alias) in positions), None)
        if match is not None:
            columns[name] = match
    required = {"weekday", "date", "week", "staff", "content", "self_notes", "leader_notes"}
    missing = sorted(required - columns.keys())
    if missing:
        raise RuntimeError(f"Sheet thiếu cột bắt buộc: {', '.join(missing)}")
    service._work_schedule_columns = {"spreadsheet_id": spreadsheet_id, "columns": dict(columns), "headers": list(headers)}
    return columns, headers


def _canonical_row(row, columns):
    return [_cell(row, columns.get(name, -1)) if name in columns else "" for name in CANONICAL_COLUMNS]


def _retained_sheet_start_row(service, start_date):
    """Resolve the earliest physical row in the rolling retention window.

    Row positions are deliberately not cached: inserting, deleting, sorting, or
    moving Sheet rows invalidates a cached offset. Reading the date column is a
    small, bounded lookup and also finds a recent row moved above the usual
    chronological block.
    """
    columns, _ = _sheet_columns(service)
    date_column = _column_letter(columns["date"])
    result = service.spreadsheets().values().get(
        spreadsheetId=_spreadsheet_id(),
        range=f"'{SHEET_NAME}'!{date_column}3:{date_column}",
        valueRenderOption="FORMATTED_VALUE",
    ).execute()
    values = result.get("values", [])
    matching_rows = []
    for offset, row in enumerate(values, start=3):
        row_date = _parse_date(_cell(row, 0))
        if row_date and row_date >= start_date:
            matching_rows.append(offset)
    return min(matching_rows, default=len(values) + 3)


def _rows(service, start_row=2):
    columns, _ = _sheet_columns(service)
    last_column = _column_letter(max(columns.values()))
    result = service.spreadsheets().values().get(
        spreadsheetId=_spreadsheet_id(),
        # Open-ended so rows appended after the original 6109-row grid are also
        # part of future full-sync scans.
        range=f"'{SHEET_NAME}'!A{start_row}:{last_column}",
        valueRenderOption="FORMATTED_VALUE",
    ).execute()
    return [_canonical_row(row, columns) for row in result.get("values", [])]


def _cell(row, index):
    return str(row[index] if index < len(row) else "").strip()


def _normalise_staff_name(value):
    plain = "".join(
        char for char in unicodedata.normalize("NFD", str(value or "").casefold())
        if unicodedata.category(char) != "Mn"
    ).replace("đ", "d")
    return re.sub(r"[^a-z0-9]+", " ", plain).strip()


def _active_profile_by_sheet_identity(identity):
    """Resolve a future employee without requiring a code release.

    New staff can be identified by their employee_code (preferred), email, full
    name, or a unique trailing name used by the numbered Sheet roster. Ambiguous
    short names deliberately return None instead of assigning work to the wrong
    person.
    """
    raw = str(identity or "").strip()
    if not raw:
        return None
    profiles = UserProfile.objects.filter(employment_status="ACTIVE")
    if "@" in raw:
        return profiles.filter(email__iexact=raw).first()
    by_code = profiles.filter(employee_code__iexact=raw).first()
    if by_code:
        return by_code
    target = _normalise_staff_name(raw)
    if not target:
        return None
    exact = [profile for profile in profiles if _normalise_staff_name(profile.name) == target]
    if len(exact) == 1:
        return exact[0]
    suffix = [
        profile for profile in profiles
        if _normalise_staff_name(profile.name).split()[-len(target.split()):] == target.split()
    ]
    return suffix[0] if len(suffix) == 1 else None


def _sheet_name_email_map():
    """Build one ambiguity-safe name resolver per sync instead of querying per row."""
    candidates = defaultdict(set)
    for profile in UserProfile.objects.filter(employment_status="ACTIVE").only("email", "name"):
        parts = _normalise_staff_name(profile.name).split()
        for length in range(1, len(parts) + 1):
            candidates[" ".join(parts[-length:])].add(profile.email)
    resolved = {name: next(iter(emails)) for name, emails in candidates.items() if len(emails) == 1}
    for name, email in SHEET_STAFF_EMAILS.items():
        normalized_name = _normalise_staff_name(name)
        matching_emails = candidates.get(normalized_name, set())
        # Keep historical short-name aliases only while they remain unique.
        # Once another active employee shares that suffix, the Sheet must use
        # the disambiguated full/middle name instead of silently choosing one.
        if len(matching_emails) <= 1 and (not matching_emails or email in matching_emails):
            resolved[normalized_name] = email
    return resolved


def _sheet_employee_code(email, profile=None):
    if email in EMAIL_EMPLOYEES:
        return EMAIL_EMPLOYEES[email]
    profile = profile or UserProfile.objects.filter(email=email, employment_status="ACTIVE").first()
    # Email is a stable, already-supported identity when HR has not assigned an
    # employee code yet; never write a blank hidden identity for a new person.
    return str(profile.employee_code or profile.email) if profile else email


def _row_employee_email(row, name_email_map=None):
    # Staff name + work date is the row identity. EmployeeID remains only as a
    # compatibility fallback for historical rows and may be removed later.
    staff_name = re.sub(r"^\s*\d+\s*[.)-]?\s*", "", _cell(row, 3)).strip()
    normalized_name = _normalise_staff_name(staff_name)
    resolver = name_email_map if name_email_map is not None else _sheet_name_email_map()
    email = resolver.get(normalized_name)
    if email:
        return email
    sheet_identity = _cell(row, 7)
    email = EMPLOYEE_EMAILS.get(sheet_identity)
    if email:
        return email
    profile = _active_profile_by_sheet_identity(sheet_identity)
    return profile.email if profile else None


def _row_hidden_employee_email(row):
    """Resolve only the hidden EmployeeID, without falling back to the visible name."""
    sheet_identity = _cell(row, 7)
    if not sheet_identity:
        return None
    email = EMPLOYEE_EMAILS.get(sheet_identity)
    if email:
        return email
    profile = _active_profile_by_sheet_identity(sheet_identity)
    return profile.email if profile else None


def _parse_date(value):
    raw = str(value or "").strip()
    for pattern in ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, pattern).date()
        except (TypeError, ValueError):
            pass
    # Apps Script getValues() serializes a Sheet Date as an ISO UTC instant.
    # Convert it back through Django's local timezone before taking the date;
    # e.g. 09/09 in Vietnam arrives as 2026-09-08T17:00:00.000Z.
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if timezone.is_aware(parsed):
            parsed = timezone.localtime(parsed)
        return parsed.date()
    except (TypeError, ValueError):
        pass
    return None


def _task_uids(value):
    result = []
    for line in str(value or "").splitlines():
        match = re.match(r"^\s*\d+\s*[.)]\s*([0-9a-fA-F-]{32,36})\s*$", line)
        if not match:
            result.append(None)
            continue
        try:
            result.append(uuid.UUID(match.group(1)))
        except ValueError:
            result.append(None)
    return result


def _row_preference_score(row):
    """Choose the canonical row when the same staff name/date appears twice."""
    valid_ids = sum(uid is not None for uid in _task_uids(_cell(row, 9)))
    web_record = int(_cell(row, 8).upper().startswith("REC-WEB-"))
    parsed_count = len(_unique_sheet_tasks(parse_sheet_tasks(_cell(row, 4))))
    return valid_ids, web_record, parsed_count, len(_cell(row, 4))


def _numbered(values):
    return "\n".join(f"{index}. {value}" for index, value in enumerate(values, 1))


def _group_values(items):
    # The editable web grid and the Sheet cell share the same title text. Times
    # are separate metadata and must not be reconstructed into user content.
    content = _numbered([item.title for item in items])
    all_completed = bool(items) and all(
        item.status in {WorkItem.STATUS_COMPLETED, WorkItem.STATUS_REVIEWED}
        for item in items
    )
    self_notes = "Hoàn thành" if all_completed else "\n".join(
        f"{index}. {item.progress_note or 'Hoàn thành'}"
        for index, item in enumerate(items, 1)
        if item.progress_note or item.status in {WorkItem.STATUS_COMPLETED, WorkItem.STATUS_REVIEWED}
    )
    all_reviewed = bool(items) and all(item.status == WorkItem.STATUS_REVIEWED for item in items)
    leader_notes = "Hoàn thành" if all_reviewed and all(item.review_percent in {None, 100} and (not item.review_note or item.review_note.casefold() == "hoàn thành") for item in items) else "\n".join(
        f"{index}. " +
        (item.review_note if item.review_percent in {None, 100} and item.review_note else
         (f"{item.review_percent}%" if item.review_percent is not None else "Hoàn thành") +
         (f" · {item.review_note}" if item.review_note else ""))
        for index, item in enumerate(items, 1)
        if item.status == WorkItem.STATUS_REVIEWED
    )
    task_ids = _numbered([str(item.sync_uid) for item in items])
    return content, self_notes, leader_notes, task_ids


def _attendance_value(entries):
    """Render the compact attendance format used in the work-schedule Sheet."""
    if not entries:
        return ""
    if any(entry.is_day_off for entry in entries):
        return ""
    return "\n".join(
        f"{'Onl' if entry.work_mode == 'online' else 'Off'}: "
        f"{entry.shift_start.strftime('%Hh%M')}-{entry.shift_end.strftime('%Hh%M')}."
        for entry in entries
    )


def _row_hash(content, self_notes, leader_notes, task_ids):
    raw = json.dumps([content, self_notes, leader_notes, task_ids], ensure_ascii=False, separators=(",", ":"))
    value = 2166136261
    for character in raw:
        value ^= ord(character)
        value = (value * 16777619) & 0xFFFFFFFF
    return f"{value:08x}"


def _duplicate_title_key(value):
    """Treat visually identical task titles as the same task within one day."""
    normalized = re.sub(r"\s+", " ", str(value or "")).strip()
    from .sheet_parser import LEADING_TIME, LEADING_TIME_RANGE
    match = LEADING_TIME_RANGE.match(normalized) or LEADING_TIME.match(normalized)
    if match:
        normalized = match.group(7 if match.re is LEADING_TIME_RANGE else 4)
    return normalized.strip().casefold()


def _unique_sheet_tasks(tasks):
    """Remove repeated numbered lines inside one Sheet cell.

    Prefer the occurrence carrying a start time, while retaining the first visual
    position. This targets the duplicated-line source without merging unrelated
    records that happen to share a title elsewhere in the application.
    """
    return [task for task, _ in _unique_sheet_task_entries(tasks)]


def _unique_sheet_task_entries(tasks, emphasis=None):
    """Deduplicate parsed tasks while keeping the matching rich-text state."""
    unique = []
    positions = {}
    for index, task in enumerate(tasks):
        key = _duplicate_title_key(task.title)
        if not key:
            continue
        emphasized = None
        if emphasis is not None and index < len(emphasis):
            emphasized = bool(emphasis[index]) if emphasis[index] is not None else None
        if key not in positions:
            positions[key] = len(unique)
            unique.append((task, emphasized))
        elif task.start_time and not unique[positions[key]][0].start_time:
            unique[positions[key]] = (task, emphasized)
    return unique


def ensure_sync_columns(service):
    target = _sheet_properties(service)
    sheet_id = target["sheetId"]
    columns, headers = _sheet_columns(service)
    internal_headers = {
        "employee_id": "EmployeeID",
        "record_id": "WEB_RECORD_ID",
        "task_ids": "WEB_TASK_IDS",
        "sync_hash": "WEB_SYNC_HASH",
    }
    header_updates = []
    next_index = max([index for index, value in enumerate(headers) if str(value).strip()] or [-1]) + 1
    for name, header in internal_headers.items():
        if name not in columns:
            columns[name] = next_index
            header_updates.append({"range": f"'{SHEET_NAME}'!{_column_letter(next_index)}2", "values": [[header]]})
            next_index += 1
    required_count = max(columns.values()) + 1
    requests = []
    if target.get("gridProperties", {}).get("columnCount", 0) < required_count:
        requests.append({"updateSheetProperties": {"properties": {"sheetId": sheet_id, "gridProperties": {"columnCount": required_count}}, "fields": "gridProperties.columnCount"}})
    for index in sorted({columns[name] for name in internal_headers}):
        requests.append({"updateDimensionProperties": {"range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": index, "endIndex": index + 1}, "properties": {"hiddenByUser": True}, "fields": "hiddenByUser"}})
    if requests:
        service.spreadsheets().batchUpdate(spreadsheetId=_spreadsheet_id(), body={"requests": requests}).execute()
    if header_updates:
        service.spreadsheets().values().batchUpdate(
            spreadsheetId=_spreadsheet_id(),
            body={"valueInputOption": "RAW", "data": header_updates},
        ).execute()
        service._work_schedule_columns = None
    return columns


def ensure_sheet_row_capacity(service, required_row):
    """Grow the tab before values.batchUpdate targets a row beyond its grid."""
    metadata = service.spreadsheets().get(
        spreadsheetId=_spreadsheet_id(),
        fields="sheets.properties(sheetId,title,gridProperties(rowCount))",
    ).execute()
    target = next(
        (sheet.get("properties", {}) for sheet in metadata.get("sheets", [])
         if sheet.get("properties", {}).get("title") == SHEET_NAME
         or sheet.get("properties", {}).get("sheetId") == DEFAULT_SHEET_ID),
        None,
    )
    if not target:
        raise RuntimeError("Không tìm thấy tab Lịch công tác.")
    current_rows = int(target.get("gridProperties", {}).get("rowCount", 0))
    if required_row <= current_rows:
        return current_rows
    rows_to_add = max(required_row - current_rows, 500)
    service.spreadsheets().batchUpdate(
        spreadsheetId=_spreadsheet_id(),
        body={"requests": [{
            "appendDimension": {
                "sheetId": target["sheetId"],
                "dimension": "ROWS",
                "length": rows_to_add,
            }
        }]},
    ).execute()
    return current_rows + rows_to_add


def _legacy_group_match(group_items, parsed_task, index, retained_ids):
    """Conservatively match a task that has no usable Sheet UUID.

    Name/date identify the row group; title identifies a task during the legacy
    backfill only. A physical row number is intentionally never used as task
    identity because it changes after sort/insert/delete operations.
    """
    available = [item for item in group_items if item.pk not in retained_ids]
    title_key = _duplicate_title_key(parsed_task.title)
    title_matches = [item for item in available if _duplicate_title_key(item.title) == title_key]
    if len(title_matches) == 1:
        return title_matches[0]
    order_matches = [item for item in available if item.daily_order == index]
    return order_matches[0] if len(order_matches) == 1 else None


def _ingest_row(offset, row, today, *, delete_missing=True, retained_by_group=None, task_emphasis=None):
    """Parse one sheet row (A:K, same shape as `_rows()` yields) and upsert its WorkItems.

    Shared by `pull_from_sheet` (bulk, one row per iteration) and the realtime
    webhook (exactly one row, no date-range filter). Caller is responsible for
    wrapping this in `suppress_sheet_queue()`.
    """
    created = updated = deleted = 0
    touched = set()
    work_date = _parse_date(_cell(row, 1))
    email = _row_employee_email(row)
    if not email or not work_date:
        return created, updated, deleted, touched
    executor = UserProfile.objects.filter(email=email, employment_status="ACTIVE").first()
    if not executor:
        return created, updated, deleted, touched
    hidden_email = _row_hidden_employee_email(row)
    if hidden_email and hidden_email != email:
        logger.warning(
            "Ignored Sheet row %s because visible and hidden employee identities differ.",
            offset,
        )
        return created, updated, deleted, touched
    ids = _task_uids(_cell(row, 9))
    supplied_uids = [sync_uid for sync_uid in ids if sync_uid]
    existing_by_uid = {
        item.sync_uid: item
        for item in WorkItem.objects.filter(sync_uid__in=supplied_uids).only(
            "id", "sync_uid", "executor_id", "work_date"
        )
    }
    identity_conflicts = [
        item for item in existing_by_uid.values()
        if item.executor_id != email or item.work_date != work_date
    ]
    if identity_conflicts:
        # Hidden task UUIDs are identity, not a move instruction. Reject the
        # whole row before mutating anything: accepting part of a row used to
        # clone another employee's/future work under the visible person/date.
        logger.warning(
            "Ignored Sheet row %s because task identity conflicts with employee/date.",
            offset,
        )
        return created, updated, deleted, touched
    group_items = list(WorkItem.objects.filter(executor=executor, work_date=work_date))
    touched.add((email, work_date))
    # An unchanged Sheet row is an old snapshot while a web edit is queued.
    # Do not recreate deleted tasks or overwrite unsent titles during a full pull.
    live_hash = _row_hash(_cell(row, 4), _cell(row, 5), _cell(row, 6), _cell(row, 9))
    if _cell(row, 10) == live_hash and WorkScheduleSheetChange.objects.filter(
        executor_email=email, work_date=work_date,
        status__in=[WorkScheduleSheetChange.STATUS_PENDING, WorkScheduleSheetChange.STATUS_PROCESSING, WorkScheduleSheetChange.STATUS_FAILED, WorkScheduleSheetChange.STATUS_CONFLICT],
    ).exists():
        if retained_by_group is not None:
            retained_by_group[(email, work_date)].update(item.pk for item in group_items)
        return created, updated, deleted, touched
    raw_tasks = parse_sheet_tasks(_cell(row, 4))
    if task_emphasis is None:
        parsed = _unique_sheet_tasks(raw_tasks)
        parsed_emphasis = None
    else:
        task_entries = _unique_sheet_task_entries(raw_tasks, task_emphasis)
        parsed = [task for task, _ in task_entries]
        parsed_emphasis = [emphasis for _, emphasis in task_entries]
    notes = assessment_notes(_cell(row, 5), len(parsed))
    leader_notes = leader_assessment_notes(_cell(row, 6), len(parsed))
    group_uids = {item.sync_uid for item in group_items}
    has_group_uid = any(sync_uid in group_uids for sync_uid in ids if sync_uid)
    has_same_source_row = any(item.source_sheet_row == offset for item in group_items)
    same_complete_title_set = (
        len(parsed) == len(group_items)
        and sorted(_duplicate_title_key(task.title) for task in parsed)
        == sorted(_duplicate_title_key(item.title) for item in group_items)
    )
    if group_items and not has_same_source_row and not has_group_uid and not same_complete_title_set:
        # A second row with the same employee/date but without this group's
        # UUIDs is a competing duplicate, not a trustworthy row move. Do not
        # let a partial legacy/copy-pasted row overwrite or delete the
        # canonical group's tasks. The push phase will refresh the canonical
        # row selected from the Sheet index.
        return created, updated, deleted, touched
    retained_ids = set()
    for index, parsed_task in enumerate(parsed, 1):
        supplied_uid = ids[index - 1] if index <= len(ids) else None
        item = existing_by_uid.get(supplied_uid) if supplied_uid else None
        if not item:
            item = _legacy_group_match(group_items, parsed_task, index, retained_ids)
        sync_uid = supplied_uid or (item.sync_uid if item else uuid.uuid4())
        note = notes[index - 1] if index <= len(notes) else ""
        task_status = status_from_note(note, work_date > today)
        leader_note = leader_notes[index - 1] if index <= len(leader_notes) else ""
        if leader_note and leader_note.strip().lower() not in {"chưa đánh giá", "chua danh gia"}:
            task_status = WorkItem.STATUS_REVIEWED
        custom_note = "" if note.strip().lower() in {"cần làm", "đang thực hiện", "hoàn thành", "đã hoàn thành", "xong"} else note
        source_record_id = _cell(row, 8) or (item.source_record_id if item else "")
        is_web_origin = source_record_id.upper().startswith("REC-WEB-")
        explicit_time = parsed_task.has_time_prefix
        sheet_emphasized = (
            parsed_emphasis[index - 1]
            if parsed_emphasis is not None and index <= len(parsed_emphasis)
            else None
        )
        # Web-origin tasks store raw user text as title (no time stripping). If the
        # sheet cell was generated from such a task, the parser may have extracted a
        # time prefix that was just part of the user's text (e.g. "7:30 - 12:30").
        # Honour the existing web title and start_time rather than overwriting them.
        preserve_web_title = is_web_origin and item and not item.time_prefix_in_title and explicit_time
        if preserve_web_title:
            explicit_time = False
        is_sheet_training = explicit_time and "tập huấn" in parsed_task.title.lower()
        is_web_training = bool(is_web_origin and item and item.label == "Tập huấn")
        is_training = is_sheet_training or is_web_training
        personal_task = is_personal_task(parsed_task.title)
        if item and personal_task and getattr(item, "sheet_emphasis", None) is not None:
            item.sheet_emphasis = False
        if sheet_emphasized is not None:
            effective_sheet_emphasis = bool(sheet_emphasized) and not personal_task
        else:
            effective_sheet_emphasis = getattr(item, "sheet_emphasis", None) if item else None
        if item and sheet_emphasized is not None:
            item.sheet_emphasis = effective_sheet_emphasis
        if item:
            previous_group = (item.executor_id, item.work_date)
            touched.add(previous_group)
            item.executor = executor
            item.title = item.title if preserve_web_title else parsed_task.title[:1000]
            item.progress_note = custom_note[:1000]
            item.work_date = work_date
            item.start_time = item.start_time if preserve_web_title else parsed_task.start_time
            item.end_time = parsed_task.end_time or (training_end(parsed_task.start_time) if is_training else None)
            item.status = task_status
            item.daily_order = index
            item.source_sheet_row = offset
            item.source_task_index = index
            item.source_record_id = source_record_id
            had_time_prefix = item.time_prefix_in_title
            item.time_prefix_in_title = explicit_time
            if effective_sheet_emphasis is not None:
                item.priority = "high" if effective_sheet_emphasis else "medium"
                item.priority_before_time = (
                    item.priority if explicit_time else None
                )
            elif explicit_time:
                if not had_time_prefix:
                    item.priority_before_time = item.priority
                item.priority = "high"
            elif had_time_prefix:
                item.priority = item.priority_before_time or "medium"
                item.priority_before_time = None
            item.label = "Tập huấn" if is_training else "Công việc"
            item.sync_uid = sync_uid
            item.save()
            updated += 1
        else:
            item = WorkItem.objects.create(
                creator=executor, executor=executor, title=parsed_task.title[:1000],
                description="Nhập từ Lịch công tác FT 2026 mới.", progress_note=custom_note[:1000],
                work_date=work_date, start_time=parsed_task.start_time,
                end_time=parsed_task.end_time or (training_end(parsed_task.start_time) if is_training else None),
                status=task_status,
                priority=(
                    "high" if effective_sheet_emphasis else "medium"
                ) if effective_sheet_emphasis is not None else ("high" if explicit_time else "medium"),
                priority_before_time=(
                    ("high" if effective_sheet_emphasis else "medium") if explicit_time else None
                ) if effective_sheet_emphasis is not None else ("medium" if explicit_time else None),
                label="Tập huấn" if is_training else "Công việc",
                daily_order=index, source_sheet_row=offset, source_task_index=index,
                source_record_id=source_record_id,
                time_prefix_in_title=explicit_time,
                sheet_emphasis=effective_sheet_emphasis,
                sync_uid=sync_uid,
            )
            created += 1
        if task_status == WorkItem.STATUS_REVIEWED:
            item.review_percent, item.review_note = parse_leader_review(leader_note)
            item.review_note = item.review_note[:1000]
            item.reviewed_at = item.reviewed_at or timezone.now()
            item.needs_revision = False
        else:
            item.review_percent = None
            item.review_note = ""
            item.reviewed_at = None
            item.reviewed_by = None
        item.save(update_fields=["review_percent", "review_note", "reviewed_at", "reviewed_by", "needs_revision"])
        # Reconcile the calendar projection immediately. In particular this
        # removes old 09:00-12:00 sessions that were generated merely because
        # an untimed task happened to mention "tập huấn".
        from .training_sync import sync_training_from_work_item
        sync_training_from_work_item(item)
        retained_ids.add(item.pk)
    if retained_by_group is not None:
        retained_by_group[(email, work_date)].update(retained_ids)
    stale_items = [item for item in group_items if item.pk not in retained_ids and item.source_sheet_row]
    if delete_missing and stale_items:
        from .training_sync import delete_training_for_work_item

        for item in stale_items:
            delete_training_for_work_item(item)
            item.delete()
            deleted += 1
    return created, updated, deleted, touched


def pull_from_sheet(service, start_date, end_date):
    created = updated = deleted = 0
    touched = set()
    duplicate_groups = []
    today = timezone.localdate()
    with suppress_sheet_queue():
        rows_start = _retained_sheet_start_row(service, max(start_date, retained_from()))
        name_email_map = _sheet_name_email_map()
        candidate_rows = []
        grouped_rows = defaultdict(list)
        for offset, row in enumerate(_rows(service, rows_start), start=rows_start):
            work_date = _parse_date(_cell(row, 1))
            if not work_date or not (start_date <= work_date <= end_date):
                continue
            email = _row_employee_email(row, name_email_map)
            if not email:
                continue
            grouped_rows[(email, work_date)].append((offset, row))
        for group, matches in grouped_rows.items():
            matches.sort(key=lambda value: _row_preference_score(value[1]), reverse=True)
            candidate_rows.append(matches[0])
            if len(matches) > 1:
                duplicate_groups.append({
                    "email": group[0], "date": group[1].isoformat(),
                    "rows": [row_number for row_number, _ in matches],
                    "selectedRow": matches[0][0],
                })
        retained_by_group = defaultdict(set)
        cached_columns = getattr(service, "_work_schedule_columns", {})
        emphasis_columns = (
            cached_columns.get("columns")
            if isinstance(cached_columns, dict)
            else None
        ) or LEGACY_COLUMNS
        emphasis_by_row = _row_task_emphasis_map(
            service,
            [row_number for row_number, _ in candidate_rows],
            emphasis_columns,
        )
        for offset, row in sorted(candidate_rows):
            row_created, row_updated, row_deleted, row_touched = _ingest_row(
                offset,
                row,
                today,
                delete_missing=False,
                retained_by_group=retained_by_group,
                task_emphasis=emphasis_by_row.get(offset),
            )
            created += row_created
            updated += row_updated
            deleted += row_deleted
            touched |= row_touched
        from .training_sync import delete_training_for_work_item
        for (email, work_date), retained_ids in retained_by_group.items():
            stale_items = WorkItem.objects.filter(
                executor_id=email, work_date=work_date, source_sheet_row__isnull=False
            ).exclude(pk__in=retained_ids)
            for item in stale_items:
                delete_training_for_work_item(item)
                item.delete()
                deleted += 1
    return {
        "created": created, "updated": updated, "deleted": deleted,
        "groups": touched, "duplicateGroups": duplicate_groups,
    }


def _find_row(rows, email, work_date, items, row_index=None, rows_start=2, uid_index=None):
    if row_index is not None:
        matched = row_index.get((email, work_date))
        if matched:
            return matched
        uid_matches = {
            uid_index[item.sync_uid][0]: uid_index[item.sync_uid]
            for item in items
            if uid_index is not None and item.sync_uid in uid_index
        }
        if len(uid_matches) == 1:
            return next(iter(uid_matches.values()))
    else:
        for index, row in enumerate(rows, start=rows_start):
            if _parse_date(_cell(row, 1)) == work_date and _row_employee_email(row) == email:
                return index, row
    return None, None


def _sheet_row_indexes(rows, rows_start, name_email_map):
    row_index = {}
    uid_index = {}
    for row_number, row in enumerate(rows, start=rows_start):
        row_email = _row_employee_email(row, name_email_map)
        row_date = _parse_date(_cell(row, 1))
        if row_email and row_date:
            key = (row_email, row_date)
            current_match = row_index.get(key)
            if current_match is None or _row_preference_score(row) > _row_preference_score(current_match[1]):
                row_index[key] = (row_number, row)
        for sync_uid in _task_uids(_cell(row, 9)):
            if sync_uid:
                uid_index[sync_uid] = (row_number, row)
    return row_index, uid_index


def _insert_missing_rows_by_date(service, rows_start, rows, groups):
    """Reserve missing historical rows inside the chronological block."""
    if not groups:
        return {}
    working = list(rows)
    requests = []
    reserved_rows = {}
    sheet_id = _sheet_properties(service)["sheetId"]
    for group in sorted(groups, key=lambda value: (value[1], value[0])):
        _, work_date = group
        destination = next((
            index for index, row in enumerate(working)
            if _parse_date(_cell(row, 1)) and _parse_date(_cell(row, 1)) > work_date
        ), None)
        # A current/future row after the existing schedule can use the normal
        # trailing blank grid; only historical rows need a physical insertion.
        if destination is None:
            continue
        requests.append({
            "insertDimension": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": rows_start + destination - 1,
                    "endIndex": rows_start + destination,
                },
                "inheritFromBefore": rows_start + destination > 1,
            }
        })
        reserved_rows[group] = rows_start + destination
        placeholder = ["", work_date.strftime("%d/%m/%Y")]
        working.insert(destination, placeholder)
    if requests:
        service.spreadsheets().batchUpdate(
            spreadsheetId=_spreadsheet_id(), body={"requests": requests}
        ).execute()
    return reserved_rows


def _reorder_misplaced_web_rows(service, rows_start, rows):
    """Move web-created rows back into the chronological Sheet block.

    Older versions appended a missing group after the last populated row. That
    left July/September records below the December block. Only rows carrying a
    WEB record id are moved; hand-maintained legacy rows keep their positions.
    Requests are simulated against a local list so all moves can be sent in one
    quota-friendly batch.
    """
    working = list(rows)
    requests = []
    sheet_id = None
    while len(requests) < 500:
        max_date = None
        misplaced = None
        for index, row in enumerate(working):
            row_date = _parse_date(_cell(row, 1))
            if not row_date:
                continue
            if (
                max_date is not None
                and row_date < max_date
                and _cell(row, 8).upper().startswith("REC-WEB-")
            ):
                misplaced = (index, row_date)
                break
            max_date = max(max_date, row_date) if max_date else row_date
        if misplaced is None:
            break
        source_index, row_date = misplaced
        sheet_id = sheet_id or _sheet_properties(service)["sheetId"]
        destination_index = next(
            index for index, row in enumerate(working[:source_index])
            if (_parse_date(_cell(row, 1)) or datetime.min.date()) > row_date
        )
        requests.append({
            "moveDimension": {
                "source": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": rows_start + source_index - 1,
                    "endIndex": rows_start + source_index,
                },
                "destinationIndex": rows_start + destination_index - 1,
            }
        })
        moved = working.pop(source_index)
        working.insert(destination_index, moved)
    if requests:
        service.spreadsheets().batchUpdate(
            spreadsheetId=_spreadsheet_id(), body={"requests": requests}
        ).execute()
    return len(requests)


_TIME_LINE_RE = re.compile(
    r'^\s*\d+\s*[.,)]\s*\d{1,2}(?:\s*[hH]\s*\d{0,2}|\s*:\s*\d{2})(?=\s|[:;,.\-])'
)


def _sheet_text_length(value):
    """Return the UTF-16 length used by Google Sheets rich-text indexes."""
    return len(str(value or "").encode("utf-16-le")) // 2


def _build_content_format_runs(content, items=None):
    """Build explicit rich-text runs for the Sheet task cell."""
    # Sheets only accepts textFormatRuns for a literal, non-empty string cell.
    # Without this guard an empty schedule generated a run at index 0 and made
    # the entire sync fail with HTTP 400 during the formatting phase.
    if not content:
        return []
    lines = content.split('\n')
    runs = []
    offset = 0
    prev_bold = None
    task_index = -1
    current_bold = False
    ordered_items = list(items or [])
    parsed_items = parse_sheet_tasks(content)
    for line in lines:
        if re.match(r'^\s*\d+\s*[.,)]\s*', line):
            task_index += 1
            is_high_priority = (
                task_index < len(ordered_items)
                and ordered_items[task_index].priority == "high"
            )
            marker = re.match(r"^\s*\d+\s*[.,)]\s*", line)
            time_line = marker.group(0) + without_task_tags(line[marker.end():])
            title = parsed_items[task_index].title if task_index < len(parsed_items) else line[marker.end():]
            item = ordered_items[task_index] if task_index < len(ordered_items) else None
            sheet_emphasis = getattr(item, "sheet_emphasis", None) if item else None
            # A Sheet editor's explicit choice wins over the automatic time or
            # priority rule. Legacy callers without items retain time-based output.
            important = (
                bool(sheet_emphasis)
                if sheet_emphasis is not None
                else (is_high_priority if ordered_items else bool(_TIME_LINE_RE.match(time_line)))
            )
            current_bold = not is_personal_task(title) and important
        is_bold = current_bold
        if is_bold != prev_bold:
            # Explicit false values are required. An empty run inherits the
            # cell-level text style; that made every later line bold/italic in
            # roster cells whose base style was already emphasized.
            fmt = {
                'bold': is_bold,
                'italic': is_bold,
                'foregroundColorStyle': {'rgbColor': {'red': 0.0, 'green': 0.0, 'blue': 0.0}},
            }
            runs.append({'startIndex': offset, 'format': fmt})
            prev_bold = is_bold
        offset += _sheet_text_length(line) + 1  # +1 for newline character
    return runs


def _task_emphasis_from_cell(cell):
    """Read the effective bold state at each numbered task in one Sheet cell."""
    if not isinstance(cell, dict):
        return None
    content = str(cell.get("formattedValue") or "")
    if not content:
        return []
    effective_text_format = cell.get("effectiveFormat", {}).get("textFormat", {})
    entered_text_format = cell.get("userEnteredFormat", {}).get("textFormat", {})
    base_bold = bool(
        effective_text_format.get("bold", entered_text_format.get("bold", False))
    )
    runs = []
    for raw_run in cell.get("textFormatRuns") or []:
        if not isinstance(raw_run, dict):
            continue
        try:
            start_index = int(raw_run.get("startIndex", 0))
        except (TypeError, ValueError):
            continue
        runs.append((start_index, raw_run.get("format") or {}))
    runs.sort(key=lambda run: run[0])

    emphasis = []
    offset = 0
    for line in content.split("\n"):
        marker = re.match(r"^\s*\d+\s*[.,)]\s*", line)
        if marker and line[marker.end():].strip():
            task_offset = offset + _sheet_text_length(marker.group(0))
            bold = base_bold
            for start_index, fmt in runs:
                if start_index > task_offset:
                    break
                # Omitted run fields keep the previous effective value; they
                # do not mean that the property should reset to the cell.
                if isinstance(fmt, dict) and "bold" in fmt:
                    bold = bool(fmt["bold"])
            emphasis.append(bold)
        offset += _sheet_text_length(line) + 1
    return emphasis


def _row_task_emphasis_map(service, row_numbers, columns):
    """Read rich-text emphasis for several Sheet rows in one API request."""
    requested_rows = sorted({int(row_number) for row_number in row_numbers})
    if not requested_rows:
        return {}
    content_column = _column_letter(columns["content"])
    result = service.spreadsheets().get(
        spreadsheetId=_spreadsheet_id(),
        ranges=[f"'{SHEET_NAME}'!{content_column}{requested_rows[0]}:{content_column}{requested_rows[-1]}"],
        includeGridData=True,
        fields=(
            "sheets.data(startRow,rowData.values("
            "formattedValue,effectiveFormat.textFormat.bold,userEnteredFormat.textFormat.bold,"
            "textFormatRuns.startIndex,textFormatRuns.format.bold))"
        ),
    ).execute()
    if not isinstance(result, dict):
        return {}
    sheets = result.get("sheets")
    if not isinstance(sheets, list) or not sheets:
        return {}
    emphasis_by_row = {}
    requested_set = set(requested_rows)
    for sheet in sheets:
        if not isinstance(sheet, dict):
            continue
        data = sheet.get("data")
        if not isinstance(data, list):
            continue
        for block in data:
            if not isinstance(block, dict):
                continue
            try:
                start_row = int(block.get("startRow", 0))
            except (TypeError, ValueError):
                start_row = 0
            row_data = block.get("rowData")
            if not isinstance(row_data, list):
                continue
            for offset, row in enumerate(row_data):
                row_number = start_row + offset + 1
                if row_number not in requested_set or not isinstance(row, dict):
                    continue
                values = row.get("values")
                cell = values[0] if isinstance(values, list) and values else None
                emphasis_by_row[row_number] = _task_emphasis_from_cell(cell)
    return emphasis_by_row


def _row_task_emphasis(service, row_number, columns):
    """Return whether each numbered task is bold in the edited Sheet cell."""
    emphasis_by_row = _row_task_emphasis_map(service, [row_number], columns)
    return emphasis_by_row.get(row_number)


def _formula_content_rows(service, columns=None, start_row=2):
    """Return 1-based rows whose column E value is produced by a formula.

    Google rejects textFormatRuns for computed values, even when their displayed
    value is text. Those rows remain fully synchronized but keep formula-owned
    formatting.
    """
    columns = columns or LEGACY_COLUMNS
    content_column = _column_letter(columns["content"])
    result = service.spreadsheets().get(
        spreadsheetId=_spreadsheet_id(),
        ranges=[f"'{SHEET_NAME}'!{content_column}{start_row}:{content_column}"],
        includeGridData=True,
        fields="sheets.data(startRow,rowData.values.userEnteredValue)",
    ).execute()
    rows = set()
    for block in (result.get("sheets") or [{}])[0].get("data", []):
        start_row = int(block.get("startRow", 1))
        for offset, row_data in enumerate(block.get("rowData", [])):
            values = row_data.get("values", [])
            entered = values[0].get("userEnteredValue", {}) if values else {}
            if "formulaValue" in entered:
                rows.add(start_row + offset + 1)
    return rows


def push_groups_to_sheet(service, groups, force=False):
    columns = ensure_sync_columns(service)
    if not isinstance(columns, dict):  # compatibility with isolated test/mocked callers
        columns = LEGACY_COLUMNS
    retention_start = retained_from()
    rows_start = _retained_sheet_start_row(service, retention_start)
    rows = _rows(service, rows_start)
    if _reorder_misplaced_web_rows(service, rows_start, rows):
        # Physical row numbers changed; rebuild every index before writing.
        rows_start = _retained_sheet_start_row(service, retention_start)
        rows = _rows(service, rows_start)
    groups = {(email, work_date) for email, work_date in groups if work_date >= retention_start}
    updates = []
    conflicts = []
    synced = []
    update_rows = []
    name_email_map = _sheet_name_email_map()
    row_index, uid_index = _sheet_row_indexes(rows, rows_start, name_email_map)
    items_by_group = defaultdict(list)
    attendance_by_group = defaultdict(list)
    if groups:
        group_emails = {email for email, _ in groups}
        min_date = min(work_date for _, work_date in groups)
        max_date = max(work_date for _, work_date in groups)
        all_items = WorkItem.objects.filter(
            executor_id__in=group_emails,
            work_date__range=(min_date, max_date),
        ).order_by("daily_order", "start_time", "created_at", "pk")
        for item in all_items:
            key = (item.executor_id, item.work_date)
            if key in groups:
                items_by_group[key].append(item)
        all_attendance = TimesheetEntry.objects.filter(
            employee_id__in=group_emails,
            work_date__range=(min_date, max_date),
        ).order_by("shift_number", "pk")
        for entry in all_attendance:
            key = (entry.employee_id, entry.work_date)
            if key in groups:
                attendance_by_group[key].append(entry)
    missing_groups = []
    for email, work_date in groups:
        items = items_by_group[(email, work_date)]
        attendance = attendance_by_group[(email, work_date)]
        if (items or attendance) and not _find_row(
            rows, email, work_date, items, row_index, rows_start, uid_index
        )[0]:
            missing_groups.append((email, work_date))
    reserved_rows = _insert_missing_rows_by_date(service, rows_start, rows, missing_groups)
    if reserved_rows:
        rows_start = _retained_sheet_start_row(service, retention_start)
        rows = _rows(service, rows_start)
        row_index, uid_index = _sheet_row_indexes(rows, rows_start, name_email_map)
    profiles = UserProfile.objects.in_bulk(
        {email for email, _ in groups}, field_name="email"
    )
    next_row = max((i for i, row in enumerate(rows, start=rows_start) if any(_cell(row, c) for c in range(min(9, len(row))))), default=rows_start - 1) + 1
    for email, work_date in sorted(groups, key=lambda value: (value[1], value[0])):
        items = items_by_group[(email, work_date)]
        attendance = attendance_by_group[(email, work_date)]
        row_number, current = _find_row(rows, email, work_date, items, row_index, rows_start, uid_index)
        if row_number is None:
            if not items and not attendance:
                continue
            row_number = reserved_rows.get((email, work_date))
            if row_number is None:
                row_number = next_row
                next_row += 1
            current = []
        update_rows.append(row_number)
        if "attendance" in columns:
            column = _column_letter(columns["attendance"])
            updates.append({"range": f"'{SHEET_NAME}'!{column}{row_number}", "values": [[_attendance_value(attendance)]]})
        live_values = (_cell(current, 4), _cell(current, 5), _cell(current, 6), _cell(current, 9))
        live_hash = _row_hash(*live_values)
        stored_hash = _cell(current, 10)
        if current and (not stored_hash or stored_hash != live_hash) and not force:
            conflicts.append({"email": email, "date": work_date.isoformat(), "row": row_number})
            continue
        content, self_notes, leader_notes, task_ids = _group_values(items) if items else ("", "", "", "")
        new_hash = _row_hash(content, self_notes, leader_notes, task_ids)
        for name, value in (
            ("content", content), ("self_notes", self_notes),
            ("leader_notes", leader_notes), ("task_ids", task_ids),
            ("sync_hash", new_hash),
        ):
            column = _column_letter(columns[name])
            updates.append({"range": f"'{SHEET_NAME}'!{column}{row_number}", "values": [[value]]})
        if not current:
            profile = profiles.get(email)
            iso_week = work_date.isocalendar().week
            record_id = f"REC-WEB-{uuid.uuid4().hex[:12].upper()}"
            for name, value in (
                ("weekday", WEEKDAYS[work_date.weekday()]),
                ("date", work_date.strftime("%d/%m/%Y")),
                ("week", iso_week),
                ("staff", profile.name if profile else email),
                ("employee_id", _sheet_employee_code(email, profile)),
                ("record_id", record_id),
            ):
                column = _column_letter(columns[name])
                updates.append({"range": f"'{SHEET_NAME}'!{column}{row_number}", "values": [[value]]})
        synced.append((email, work_date, row_number, new_hash, items))
    if updates:
        ensure_sheet_row_capacity(service, max(update_rows))
        for start in range(0, len(updates), 500):
            service.spreadsheets().values().batchUpdate(
                spreadsheetId=_spreadsheet_id(),
                body={"valueInputOption": "USER_ENTERED", "data": updates[start:start + 500]},
            ).execute()
    # Reset the cell-level style as well as each run. Otherwise a previously
    # bold cell can keep making newly written, untimed tasks appear bold.
    format_requests = []
    formula_rows = _formula_content_rows(service, columns, rows_start) if synced else set()
    format_sheet_id = _sheet_properties(service)["sheetId"] if synced else DEFAULT_SHEET_ID
    for email, work_date, row_number, sync_hash, items in synced:
        if row_number in formula_rows:
            continue
        content, _, _, _ = _group_values(items) if items else ("", "", "", "")
        runs = _build_content_format_runs(content, items)
        cell = {
            'userEnteredFormat': {'textFormat': {'bold': False, 'italic': False}},
        }
        fields = 'userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.italic'
        if runs:
            cell['textFormatRuns'] = [
                {'startIndex': run['startIndex'], 'format': run['format']}
                for run in runs
            ]
            fields += ',textFormatRuns'
        format_requests.append({
            'updateCells': {
                'range': {
                    'sheetId': format_sheet_id,
                    'startRowIndex': row_number - 1,
                    'endRowIndex': row_number,
                    'startColumnIndex': columns["content"],
                    'endColumnIndex': columns["content"] + 1,
                },
                'rows': [{'values': [cell]}],
                'fields': fields,
            }
        })
    if format_requests:
        for start in range(0, len(format_requests), 500):
            service.spreadsheets().batchUpdate(
                spreadsheetId=_spreadsheet_id(),
                body={'requests': format_requests[start:start + 500]},
            ).execute()
    with suppress_sheet_queue():
        for email, work_date, row_number, sync_hash, items in synced:
            for index, item in enumerate(items, 1):
                WorkItem.objects.filter(pk=item.pk).update(
                    daily_order=index, source_sheet_row=row_number, source_task_index=index, source_sync_hash=sync_hash
                )
    return {"groups": len(synced), "tasks": sum(len(x[4]) for x in synced), "conflicts": conflicts}


@contextmanager
def sync_lease(seconds=INCREMENTAL_SYNC_LEASE_SECONDS):
    """Acquire the shared Sheet-sync lease.

    ``locked_until`` doubles as a lease generation token. The conditional cleanup
    prevents an expired worker from clearing a lease that a newer worker acquired.
    A dead worker therefore blocks only until its timeout, never indefinitely.
    """
    now = timezone.now()
    acquired_until = now + timedelta(seconds=seconds)
    with transaction.atomic():
        lease, _ = WorkScheduleSheetSyncLease.objects.select_for_update().get_or_create(key="ft-work-schedule")
        if lease.locked_until and lease.locked_until > now:
            yield False
            return
        lease.locked_until = acquired_until
        lease.save(update_fields=["locked_until"])
    try:
        yield True
    finally:
        # Only the owner of this exact lease generation may release it. If this
        # worker outlived its timeout and another worker took over, leave the new
        # owner's lease untouched.
        WorkScheduleSheetSyncLease.objects.filter(
            key="ft-work-schedule", locked_until=acquired_until
        ).update(locked_until=None)


def sync_to_sheet(google_token=None, force=False):
    purge_expired_work_schedule()
    with sync_lease() as acquired:
        if not acquired:
            return {"busy": True, "message": "Một lượt đồng bộ khác đang chạy."}
        retry_before = timezone.now() - timedelta(minutes=1)
        stale_before = timezone.now() - timedelta(seconds=TWO_WAY_SYNC_LEASE_SECONDS)
        pending = list(WorkScheduleSheetChange.objects.filter(
            models.Q(status=WorkScheduleSheetChange.STATUS_PENDING)
            | (models.Q(status=WorkScheduleSheetChange.STATUS_FAILED) & (
                models.Q(processed_at__lte=retry_before) | models.Q(processed_at__isnull=True)
            ))
            | (models.Q(status=WorkScheduleSheetChange.STATUS_PROCESSING) & (
                models.Q(processed_at__lte=stale_before)
                | (models.Q(processed_at__isnull=True) & models.Q(created_at__lte=stale_before))
            ))
        ).order_by("created_at")[:1000])
        groups = {(row.executor_email, row.work_date) for row in pending}
        if not groups:
            return {"groups": 0, "tasks": 0, "conflicts": []}
        ids = [row.pk for row in pending]
        WorkScheduleSheetChange.objects.filter(pk__in=ids).update(status=WorkScheduleSheetChange.STATUS_PROCESSING, processed_at=timezone.now())
        try:
            service = _service(google_token)
            ensure_sync_columns(service)
            result = push_groups_to_sheet(service, groups, force=force)
            result["attendance"] = push_groups_to_attendance_sheet(service, groups)
            conflict_groups = {(row["email"], datetime.fromisoformat(row["date"]).date()) for row in result["conflicts"]}
            for change in pending:
                is_conflict = (change.executor_email, change.work_date) in conflict_groups
                change.status = WorkScheduleSheetChange.STATUS_CONFLICT if is_conflict else WorkScheduleSheetChange.STATUS_DONE
                change.processed_at = timezone.now()
                change.attempts += 1
                change.last_error = "Sheet đã thay đổi sau lần đồng bộ trước." if is_conflict else ""
            WorkScheduleSheetChange.objects.bulk_update(pending, ["status", "processed_at", "attempts", "last_error"])
            return result
        except Exception as exc:
            WorkScheduleSheetChange.objects.filter(pk__in=ids).update(status=WorkScheduleSheetChange.STATUS_FAILED, last_error=str(exc), attempts=models.F("attempts") + 1, processed_at=timezone.now())
            raise


def _two_way_sync(google_token, start, end):
    purge_expired_work_schedule()
    start = max(start, retained_from())
    service = _service(google_token)
    ensure_sync_columns(service)
    pulled = pull_from_sheet(service, start, end)
    groups = set(pulled["groups"])
    groups.update(WorkItem.objects.filter(work_date__range=(start, end)).values_list("executor_id", "work_date"))
    # A deployment/full sync must also backfill attendance that already existed
    # before the dedicated monthly attendance workbook integration was enabled.
    groups.update(
        TimesheetEntry.objects.filter(work_date__range=(start, end)).values_list(
            "employee_id", "work_date"
        )
    )
    pushed = push_groups_to_sheet(service, groups, force=True)
    pushed["attendance"] = push_groups_to_attendance_sheet(service, groups)
    WorkScheduleSheetChange.objects.filter(executor_email__in=[g[0] for g in groups], work_date__range=(start, end), status__in=["pending", "failed", "conflict"]).update(status="done", processed_at=timezone.now(), last_error="")
    result = {"start": start.isoformat(), "end": end.isoformat(), "pulled": pulled, "pushed": pushed}
    result["pulled"]["groups"] = len(result["pulled"]["groups"])
    SystemConfig.objects.update_or_create(key="work_schedule_sheet_sync", defaults={"data": {"lastSuccessAt": timezone.now().isoformat(), **result}})
    return result


def initial_two_way_sync(google_token=None):
    today = timezone.localdate()
    start = retained_from(today)
    month_end = today.replace(day=monthrange(today.year, today.month)[1])
    end = month_end + timedelta(days=14)
    with sync_lease(seconds=TWO_WAY_SYNC_LEASE_SECONDS) as acquired:
        if not acquired:
            return {"busy": True, "message": "Một lượt đồng bộ khác đang chạy."}
        return _two_way_sync(google_token, start, end)


def full_two_way_sync(google_token=None):
    """Re-read only the rolling retained Sheet window and reconcile dated rows."""
    with sync_lease(seconds=TWO_WAY_SYNC_LEASE_SECONDS) as acquired:
        if not acquired:
            return {"busy": True, "message": "Một lượt đồng bộ khác đang chạy."}
        return _two_way_sync(google_token, retained_from(), datetime(9999, 12, 31).date())


def sync_status():
    config = SystemConfig.objects.filter(key="work_schedule_sheet_sync").first()
    counts = {row["status"]: row["count"] for row in WorkScheduleSheetChange.objects.values("status").annotate(count=models.Count("id"))}
    return {"lastSync": config.data if config else {}, "queue": counts}
