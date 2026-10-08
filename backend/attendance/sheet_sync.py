import math
import re
from collections import defaultdict

from authentication.models import UserProfile
from authentication.monthly_sheets import get_monthly_sheet_links, normalize_label
from digital_training.models import TrainingSession
from django.utils import timezone
from integrations.google_sheets import extract_spreadsheet_id

from .models import TimesheetEntry


FIRST_DATA_ROW = 9
MAX_SCAN_ROW = 160
SHIFT_COLUMNS_PER_ROW = 3
YELLOW = {"red": 1, "green": 1, "blue": 0}
WEEKDAY_LABELS = {"hai", "ba", "tu", "nam", "sau", "bay", "cn"}


def _quote_sheet_name(value):
    return "'" + str(value).replace("'", "''") + "'"


def _staff_tokens(value):
    return {
        normalize_label(part)
        for part in re.split(r"[,;+\n/]|\s+và\s+|\s+and\s+", str(value or ""), flags=re.IGNORECASE)
        if normalize_label(part)
    }


def _training_subject(value):
    title = str(value or "").strip()
    return re.sub(r"^(?:Hỗ\s+trợ\s+)?Tập\s+huấn\s*[:\-–]?\s*", "", title, flags=re.IGNORECASE).strip()


def _training_notes(profiles, dates):
    result = defaultdict(list)
    if not profiles or not dates:
        return result
    identities = {
        profile.email: {normalize_label(profile.name), normalize_label(profile.email)} - {""}
        for profile in profiles.values()
    }
    sessions = TrainingSession.objects.filter(
        session_date__in=dates,
        session_date__lte=timezone.localdate(),
    ).exclude(
        status__in=["cancelled", "unscheduled"]
    ).order_by("session_date", "start_time", "pk")
    for session in sessions:
        instructors = _staff_tokens(session.instructor_name)
        supporters = _staff_tokens(session.support_staff_name)
        title = _training_subject(session.title)
        for email, profile_identities in identities.items():
            if profile_identities.intersection(instructors):
                result[(email, session.session_date)].append(f"Tập huấn {title}".strip())
            if profile_identities.intersection(supporters):
                result[(email, session.session_date)].append(f"Hỗ trợ tập huấn {title}".strip())
    return result


def _day_number(value):
    text = str(value or "").strip()
    if not text:
        return None
    if "/" in text:
        text = text.split("/", 1)[0]
    try:
        day = int(float(text.replace(",", ".")))
    except ValueError:
        return None
    return day if 1 <= day <= 31 else None


def _row_values(entries):
    values = []
    for entry in entries[:SHIFT_COLUMNS_PER_ROW]:
        if entry.is_day_off:
            values.extend(["", "", False])
        else:
            values.extend([
                entry.shift_start.strftime("%H:%M"),
                entry.shift_end.strftime("%H:%M"),
                entry.work_mode == "online",
            ])
    while len(values) < 9:
        values.extend(["", "", False])
    return values


def _sheet_index(metadata, profiles, missing=None):
    sheets = metadata.get("sheets", [])
    by_name = {}
    for sheet in sheets:
        properties = sheet.get("properties", {})
        title = str(properties.get("title") or "")
        key = normalize_label(title)
        if key and key not in {normalize_label("Mẫu"), normalize_label("Tổng hợp")}:
            by_name[key] = properties
    result = {}
    for email, profile in profiles.items():
        target = by_name.get(normalize_label(profile.name))
        if not target:
            if missing is None:
                raise RuntimeError(f"Không tìm thấy tab chấm công của {profile.name or email}.")
            missing[email] = f"Không tìm thấy tab chấm công của {profile.name or email}."
            continue
        result[email] = target
    return result


def _read_tab(service, spreadsheet_id, title):
    quoted = _quote_sheet_name(title)
    response = service.spreadsheets().values().batchGet(
        spreadsheetId=spreadsheet_id,
        ranges=[f"{quoted}!M4:N4", f"{quoted}!A{FIRST_DATA_ROW}:B{MAX_SCAN_ROW}"],
        valueRenderOption="FORMATTED_VALUE",
    ).execute()
    ranges = response.get("valueRanges", [])
    month_year = (ranges[0].get("values") or [[]])[0] if ranges else []
    rows = ranges[1].get("values", []) if len(ranges) > 1 else []
    return month_year, rows


def _validate_month(title, month_year, work_date):
    month = _day_number(month_year[0] if month_year else None)
    if month != work_date.month:
        raise RuntimeError(
            f"Không ghi tab {title}: M4 đang là tháng {month or 'trống'}, không phải tháng {work_date.month}."
        )
    year = None
    if len(month_year) > 1 and str(month_year[1] or "").strip():
        try:
            year = int(float(str(month_year[1]).replace(",", ".")))
        except ValueError:
            year = None
    if year is not None and year != work_date.year:
        raise RuntimeError(
            f"Không ghi tab {title}: N4 đang là năm {year}, không phải năm {work_date.year}."
        )


def _date_rows(rows):
    result = defaultdict(list)
    for offset, row in enumerate(rows):
        weekday = normalize_label(row[0] if row else "")
        if weekday not in WEEKDAY_LABELS:
            continue
        day = _day_number(row[1] if len(row) > 1 else None)
        if day is not None:
            result[day].append(FIRST_DATA_ROW + offset)
    return result


def _insert_overflow_rows(service, spreadsheet_id, sheet_id, source_row, count):
    if count <= 0:
        return
    requests = []
    current_source = source_row
    for _ in range(count):
        inserted_row = current_source + 1
        requests.append({
            "insertDimension": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": inserted_row - 1,
                    "endIndex": inserted_row,
                },
                "inheritFromBefore": True,
            }
        })
        # Copy only the structural pieces an overflow row needs. Hidden notes
        # and unrelated cells to the right are intentionally left untouched.
        for start_column, end_column, paste_type in (
            (0, 2, "PASTE_VALUES"),
            (0, 18, "PASTE_FORMAT"),
            (2, 11, "PASTE_DATA_VALIDATION"),
            (11, 17, "PASTE_FORMULA"),
        ):
            requests.append({
                "copyPaste": {
                    "source": {
                        "sheetId": sheet_id,
                        "startRowIndex": current_source - 1,
                        "endRowIndex": current_source,
                        "startColumnIndex": start_column,
                        "endColumnIndex": end_column,
                    },
                    "destination": {
                        "sheetId": sheet_id,
                        "startRowIndex": inserted_row - 1,
                        "endRowIndex": inserted_row,
                        "startColumnIndex": start_column,
                        "endColumnIndex": end_column,
                    },
                    "pasteType": paste_type,
                    "pasteOrientation": "NORMAL",
                }
            })
        current_source = inserted_row
    service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={"requests": requests},
    ).execute()


def push_groups_to_attendance_sheet(service, groups):
    """Write web timesheets to the configured monthly attendance workbook.

    Value writes are deliberately restricted to C:K and R. When a day needs
    more than three shifts, a copied structural row is inserted immediately
    below that date so the workbook's formulas and formatting remain intact.
    """
    groups = {(email, work_date) for email, work_date in groups}
    if not groups:
        return {"groups": 0, "spreadsheets": 0, "insertedRows": 0}

    by_spreadsheet = defaultdict(set)
    for email, work_date in groups:
        month = work_date.strftime("%Y-%m")
        spreadsheet_id = extract_spreadsheet_id(get_monthly_sheet_links(month).get("attendance", ""))
        if spreadsheet_id:
            by_spreadsheet[spreadsheet_id].add((email, work_date))

    total_groups = 0
    inserted_rows = 0
    # A group that cannot be placed (missing tab, wrong month, no row for the
    # date) is skipped on its own. One bad date must never block the rest of
    # the attendance writes or the work-schedule sync that calls this.
    skipped = []

    def skip(email, work_date, reason):
        skipped.append({"email": email, "date": work_date.isoformat(), "reason": reason})

    for spreadsheet_id, spreadsheet_groups in by_spreadsheet.items():
        emails = {email for email, _ in spreadsheet_groups}
        profiles = UserProfile.objects.in_bulk(emails, field_name="email")
        metadata = service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            fields="sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))",
        ).execute()
        missing_tabs = {email: "Không tìm thấy hồ sơ nhân sự." for email in emails - set(profiles)}
        sheet_by_email = _sheet_index(metadata, profiles, missing_tabs)
        for group in sorted(spreadsheet_groups):
            if group[0] in missing_tabs:
                skip(group[0], group[1], missing_tabs[group[0]])
        spreadsheet_groups = {group for group in spreadsheet_groups if group[0] not in missing_tabs}
        entries_by_group = defaultdict(list)
        entries = TimesheetEntry.objects.filter(
            employee_id__in=emails,
            work_date__in={work_date for _, work_date in spreadsheet_groups},
        ).order_by("shift_number", "pk")
        for entry in entries:
            entries_by_group[(entry.employee_id, entry.work_date)].append(entry)
        notes_by_group = _training_notes(profiles, {date for _, date in spreadsheet_groups})

        groups_by_tab = defaultdict(list)
        for group in spreadsheet_groups:
            groups_by_tab[sheet_by_email[group[0]]["title"]].append(group)

        spreadsheet_value_updates = []
        spreadsheet_format_requests = []
        for title, tab_groups in groups_by_tab.items():
            properties = sheet_by_email[tab_groups[0][0]]
            month_year, visible_rows = _read_tab(service, spreadsheet_id, title)
            rows_by_day = _date_rows(visible_rows)
            # Insert overflow rows first. When an insertion shifts later dates,
            # update the cached row map before composing the batched writes.
            placeable = []
            for email, work_date in sorted(tab_groups, key=lambda item: item[1], reverse=True):
                try:
                    _validate_month(title, month_year, work_date)
                except RuntimeError as exc:
                    skip(email, work_date, str(exc))
                    continue
                matching_rows = rows_by_day.get(work_date.day, [])
                if not matching_rows:
                    skip(email, work_date, f"Không tìm thấy ngày {work_date.day} trong cột B của tab {title}.")
                    continue
                placeable.append((email, work_date))
                day_entries = entries_by_group[(email, work_date)]
                required_rows = max(1, math.ceil(len(day_entries) / SHIFT_COLUMNS_PER_ROW))
                if len(matching_rows) < required_rows:
                    missing = required_rows - len(matching_rows)
                    insert_after = matching_rows[-1]
                    _insert_overflow_rows(
                        service,
                        spreadsheet_id,
                        properties["sheetId"],
                        insert_after,
                        missing,
                    )
                    for day, row_numbers in rows_by_day.items():
                        rows_by_day[day] = [
                            row_number + missing if row_number > insert_after else row_number
                            for row_number in row_numbers
                        ]
                    rows_by_day[work_date.day].extend(
                        range(insert_after + 1, insert_after + missing + 1)
                    )
                    rows_by_day[work_date.day].sort()
                    inserted_rows += missing

            for email, work_date in sorted(placeable, key=lambda item: item[1]):
                matching_rows = rows_by_day[work_date.day]
                day_entries = entries_by_group[(email, work_date)]
                quoted = _quote_sheet_name(title)
                for index, row_number in enumerate(matching_rows):
                    row_entries = day_entries[index * 3:(index + 1) * 3]
                    spreadsheet_value_updates.append({
                        "range": f"{quoted}!C{row_number}:K{row_number}",
                        "values": [_row_values(row_entries)],
                    })
                    note_lines = notes_by_group[(email, work_date)] if index == 0 else []
                    note = "\n".join(dict.fromkeys(note_lines))
                    spreadsheet_value_updates.append({
                        "range": f"{quoted}!R{row_number}",
                        "values": [[note]],
                    })
                    spreadsheet_format_requests.append({
                        "repeatCell": {
                            "range": {
                                "sheetId": properties["sheetId"],
                                "startRowIndex": row_number - 1,
                                "endRowIndex": row_number,
                                "startColumnIndex": 17,
                                "endColumnIndex": 18,
                            },
                            "cell": {"userEnteredFormat": {"backgroundColor": YELLOW}} if note else {"userEnteredFormat": {}},
                            "fields": "userEnteredFormat.backgroundColor",
                        }
                    })
                total_groups += 1

        # A batch counts as one Sheets write request regardless of the number
        # of ranges, keeping full-sync deployments below per-minute quotas.
        if spreadsheet_value_updates:
            service.spreadsheets().values().batchUpdate(
                    spreadsheetId=spreadsheet_id,
                    body={"valueInputOption": "USER_ENTERED", "data": spreadsheet_value_updates},
            ).execute()
        if spreadsheet_format_requests:
            service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": spreadsheet_format_requests},
            ).execute()

    return {
        "groups": total_groups,
        "spreadsheets": len(by_spreadsheet),
        "insertedRows": inserted_rows,
        "skipped": skipped,
    }
