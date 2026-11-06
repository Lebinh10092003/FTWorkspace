"""Lưu báo cáo tuần (Word) vào thư mục Google Drive "TUAN NN" của công ty.

Thư mục gốc chứa mỗi tuần một thư mục con "TUAN 45", trong đó mỗi người có một
file dạng "5. BC KQ tuần 45, NV tuần 46 (Mr Bình).docx".  Số thứ tự và cách
gọi tên ("Mr Bình") được học lại từ các file những tuần trước, nên file hệ
thống tạo nằm đúng chỗ quen thuộc của từng người.

Quy tắc:
- File do người tự tải lên không bao giờ bị ghi đè; khi đó hệ thống bỏ qua.
- File do hệ thống tạo được đánh dấu bằng appProperties và được cập nhật tại
  chỗ ở các lần lưu sau, không tạo bản trùng.
- Lượt tự động chỉ lưu cho người đã từng nộp báo cáo trong thư mục này.
"""

from __future__ import annotations

import logging
import os
import re
import unicodedata
from dataclasses import dataclass
from datetime import timedelta
from io import BytesIO

from django.utils import timezone

from authentication.models import SystemConfig, UserProfile
from authentication.notifications import notify_workspace

from .filename_utils import sanitize_docx_filename
from .models import AiReportJob, WeeklyReport
from .weekly_report_docx import build_weekly_report_docx

logger = logging.getLogger(__name__)

DEFAULT_PARENT_FOLDER_ID = "1nJKUfz8A-vpaaNLVqfqlWTSRJGK-KTvS"
DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"
FOLDER_MIME = "application/vnd.google-apps.folder"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
APP_PROPERTY = "ftWeeklyReportKey"
APP_EMAIL_PROPERTY = "ftWeeklyReportEmail"
# Số tuần trước được đọc để học số thứ tự và cách gọi tên của từng người.
HISTORY_WEEKS = 6

REPORT_FILE_RE = re.compile(r"^\s*(\d{1,2})\s*\.\s*BC\b.*\(([^()]+)\)\s*\.docx\s*$", re.IGNORECASE)


class DriveArchiveSkipped(Exception):
    """Không lưu vì đã có file người dùng tự tải lên (không phải lỗi)."""

    def __init__(self, message, *, file_name="", file_url=""):
        super().__init__(message)
        self.file_name = file_name
        self.file_url = file_url


@dataclass
class EmployeeSlot:
    number: int | None
    label: str


def parent_folder_id():
    return os.getenv("WEEKLY_REPORT_DRIVE_FOLDER_ID", "").strip() or DEFAULT_PARENT_FOLDER_ID


def _drive_service():
    from googleapiclient.discovery import build

    from integrations.google_sheets import build_google_credentials

    main = SystemConfig.objects.filter(key="main").first()
    data = main.data if main and isinstance(main.data, dict) else {}
    credentials = build_google_credentials(
        main.last_google_access_token if main else None,
        data,
        scopes=[DRIVE_SCOPE],
    )
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


def _identity(value):
    value = unicodedata.normalize("NFD", str(value or "").casefold())
    value = "".join(char for char in value if unicodedata.category(char) != "Mn").replace("đ", "d")
    value = re.sub(r"\b(?:mr|ms|mrs)\.?\s+", "", value)
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def _quote(value):
    return str(value).replace("\\", "\\\\").replace("'", "\\'")


def _file_url(file_id):
    return f"https://drive.google.com/file/d/{file_id}/view"


def _list(service, query, fields="files(id,name,mimeType,appProperties,webViewLink)"):
    files, token = [], None
    while True:
        response = service.files().list(
            q=query,
            fields=f"nextPageToken,{fields}",
            pageSize=200,
            pageToken=token,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute()
        files.extend(response.get("files", []))
        token = response.get("nextPageToken")
        if not token:
            return files


def _week_folders(service, parent_id):
    """{week_number: folder_id} for every "TUAN NN" child folder."""
    folders = {}
    query = f"'{_quote(parent_id)}' in parents and mimeType = '{FOLDER_MIME}' and trashed = false"
    for folder in _list(service, query, fields="files(id,name)"):
        match = re.fullmatch(r"tuan\s*0*(\d{1,2})", _identity(folder.get("name")))
        if match:
            folders.setdefault(int(match.group(1)), folder["id"])
    return folders


def _folder_files(service, folder_id):
    query = f"'{_quote(folder_id)}' in parents and mimeType != '{FOLDER_MIME}' and trashed = false"
    return _list(service, query)


def _candidates(label, profiles):
    target = _identity(label)
    if not target:
        return []
    exact = [profile for profile in profiles if _identity(profile.name) == target]
    if exact:
        return exact
    parts = target.split()
    return [profile for profile in profiles if _identity(profile.name).split()[-len(parts):] == parts]


def _resolve_labels(labels, profiles):
    """Map file labels ("Ms Hà", "Ms Khánh Hà") to profiles.

    A label that fits several people is settled by elimination once the more
    specific labels have claimed theirs, e.g. "Ms Hà" after "Ms Khánh Hà".
    """
    resolved = {}
    pending = {label: _candidates(label, profiles) for label in labels}
    changed = True
    while changed:
        changed = False
        claimed = {profile.email for profile in resolved.values()}
        for label, options in list(pending.items()):
            remaining = [profile for profile in options if profile.email not in claimed]
            if len(remaining) == 1:
                resolved[label] = remaining[0]
                pending.pop(label)
                changed = True
                break
    return resolved


def _parse_report_files(files):
    parsed = []
    for item in files:
        match = REPORT_FILE_RE.match(str(item.get("name") or ""))
        if match:
            parsed.append((int(match.group(1)), match.group(2).strip(), item))
    return parsed


def learn_employee_slots(service, folders, week, profiles):
    """{email: EmployeeSlot} learned from this week's and recent weeks' files.

    Newer weeks win.  Once a newer week gives a number to a different label
    (e.g. "1. … (FermatTech)" replacing "1. … (Mr Thuận)"), older uses of
    that number are ignored.
    """
    slots = {}
    number_owner = {}  # number -> label identity from the newest week that used it
    by_email = {profile.email: profile for profile in profiles}
    for offset in range(0, HISTORY_WEEKS + 1):
        folder_id = folders.get(week - offset)
        if not folder_id:
            continue
        parsed = _parse_report_files(_folder_files(service, folder_id))
        resolved = _resolve_labels({label for _, label, _ in parsed}, profiles)
        week_owners = {}
        for number, label, item in parsed:
            week_owners.setdefault(number, _identity(label))
            newer_owner = number_owner.get(number)
            if newer_owner is not None and newer_owner != _identity(label):
                continue
            # Files the system made carry the owner's email; others are matched by label.
            own_email = (item.get("appProperties") or {}).get(APP_EMAIL_PROPERTY)
            profile = by_email.get(own_email) if own_email else resolved.get(label)
            if not profile or profile.email in slots:
                continue
            slots[profile.email] = EmployeeSlot(number=number, label=label)
        for number, owner in week_owners.items():
            number_owner.setdefault(number, owner)
    return slots


def drive_file_name(report, slot):
    label = slot.label if slot else (report.employee_name or report.employee_email)
    prefix = f"{slot.number}. " if slot and slot.number else ""
    name = f"{prefix}BC KQ tuần {report.completed_week}, NV tuần {report.planned_week} ({label}).docx"
    return sanitize_docx_filename(name, default_stem=f"BC KQ tuan {report.completed_week}")


def _ensure_week_folder(service, parent_id, folders, week):
    if week in folders:
        return folders[week]
    created = service.files().create(
        body={"name": f"TUAN {week}", "mimeType": FOLDER_MIME, "parents": [parent_id]},
        fields="id",
        supportsAllDrives=True,
    ).execute()
    folders[week] = created["id"]
    return created["id"]


def _human_file_for(report, slot, week_files, profiles):
    """The file this employee uploaded by hand for the week, if any."""
    parsed = [row for row in _parse_report_files(week_files)
              if not (row[2].get("appProperties") or {}).get(APP_PROPERTY)]
    resolved = _resolve_labels({label for _, label, _ in parsed}, profiles)
    for number, label, item in parsed:
        profile = resolved.get(label)
        if profile and profile.email == report.employee_email:
            return item
        if slot and slot.number and number == slot.number and not profile:
            return item
    return None


def save_report_to_drive(report, *, service=None, context=None):
    """Upload (or refresh) the Word file of one report.  Returns the report.

    Raises DriveArchiveSkipped when the employee already uploaded their own
    file for that week.
    """
    service = service or _drive_service()
    context = context if context is not None else {}
    parent_id = context.setdefault("parent_id", parent_folder_id())
    if "folders" not in context:
        context["folders"] = _week_folders(service, parent_id)
    if "profiles" not in context:
        context["profiles"] = list(UserProfile.objects.filter(employment_status="ACTIVE").only("email", "name"))
    if "slots" not in context:
        context["slots"] = learn_employee_slots(service, context["folders"], report.completed_week, context["profiles"])
    folders, profiles = context["folders"], context["profiles"]
    slot = context["slots"].get(report.employee_email)

    folder_id = _ensure_week_folder(service, parent_id, folders, report.completed_week)
    week_files = context.setdefault("week_files", {})
    if folder_id not in week_files:
        week_files[folder_id] = _folder_files(service, folder_id)
    files = week_files[folder_id]

    human = _human_file_for(report, slot, files, profiles)
    if human:
        raise DriveArchiveSkipped(
            f"Đã có file tự tải lên: {human.get('name')}. Hệ thống không ghi đè.",
            file_name=str(human.get("name") or ""),
            file_url=human.get("webViewLink") or _file_url(human["id"]),
        )

    filename = drive_file_name(report, slot)
    _, content = build_weekly_report_docx(report)
    from googleapiclient.http import MediaIoBaseUpload

    media = MediaIoBaseUpload(BytesIO(content), mimetype=DOCX_MIME, resumable=False)
    own = next(
        (item for item in files if (item.get("appProperties") or {}).get(APP_PROPERTY) == report.report_key),
        None,
    )
    if own:
        result = service.files().update(
            fileId=own["id"], body={"name": filename}, media_body=media,
            fields="id,name,webViewLink", supportsAllDrives=True,
        ).execute()
    else:
        result = service.files().create(
            body={
                "name": filename,
                "parents": [folder_id],
                "appProperties": {APP_PROPERTY: report.report_key, APP_EMAIL_PROPERTY: report.employee_email},
            },
            media_body=media, fields="id,name,webViewLink,appProperties", supportsAllDrives=True,
        ).execute()
        files.append(result)

    report.drive_file_id = result["id"]
    report.drive_file_name = result.get("name") or filename
    report.drive_file_url = result.get("webViewLink") or _file_url(result["id"])
    report.drive_saved_at = timezone.now()
    # updated_at is left alone so the web can tell whether the content changed after saving.
    report.save(update_fields=["drive_file_id", "drive_file_name", "drive_file_url", "drive_saved_at"])
    return report


def archive_week_reports(completed_week, *, service=None):
    """Friday run: save every report of the week for people who submit weekly.

    One failing employee is logged and skipped; it never stops the others.
    """
    service = service or _drive_service()
    context = {}
    context["parent_id"] = parent_folder_id()
    context["folders"] = _week_folders(service, context["parent_id"])
    context["profiles"] = list(UserProfile.objects.filter(employment_status="ACTIVE").only("email", "name"))
    context["slots"] = learn_employee_slots(service, context["folders"], completed_week, context["profiles"])
    result = {"saved": [], "skipped": [], "failed": []}
    # Week numbers repeat every year; only reports made in the last few weeks count.
    reports = WeeklyReport.objects.filter(
        completed_week=completed_week,
        created_at__gte=timezone.now() - timedelta(days=28),
    ).order_by("employee_name")
    for report in reports:
        if report.employee_email not in context["slots"]:
            continue
        if not (report.completed_items or report.planned_items or report.difficulties):
            result["skipped"].append({"employee": report.employee_name, "reason": "Báo cáo trống."})
            continue
        try:
            save_report_to_drive(report, service=service, context=context)
            result["saved"].append({"employee": report.employee_name, "file": report.drive_file_name, "reportId": report.pk})
        except DriveArchiveSkipped as exc:
            result["skipped"].append({"employee": report.employee_name, "reason": str(exc)})
        except Exception as exc:  # noqa: BLE001 - one employee must not block the rest
            logger.exception("Weekly report Drive archive failed for %s", report.employee_email)
            result["failed"].append({"employee": report.employee_name, "error": str(exc)[:300]})
    return result


def _queue_ai_rewrite(report):
    """Queue one AI rewrite that refreshes the Drive file when it finishes."""
    user = UserProfile.objects.filter(email=report.employee_email).first()
    if not user:
        return False
    active = AiReportJob.objects.filter(
        user=user,
        status__in=[AiReportJob.STATUS_QUEUED, AiReportJob.STATUS_RUNNING],
    ).first()
    if active:
        # A personal schedule may have queued the same report a moment earlier.
        if active.report_id == report.pk and not active.save_to_drive:
            active.save_to_drive = True
            active.save(update_fields=["save_to_drive", "updated_at"])
        return False
    AiReportJob.objects.create(user=user, report=report, save_to_drive=True)
    return True


def run_friday_weekly_reports(*, today=None, service=None):
    """Friday 16:00 run for everyone who submits weekly reports.

    1. Refresh this week's drafts from the work schedule (AI-written or edited
       reports are kept as they are).
    2. Save each person's Word file into "TUAN NN" right away, so Drive has a
       complete version even if the AI is down.
    3. Queue an AI rewrite for drafts; when it finishes the same Drive file is
       replaced by the AI-written version.
    """
    from .weekly_reports import build_schedule_reports, week_start

    today = today or timezone.localdate()
    monday = week_start(today)
    week = monday.isocalendar().week
    build_schedule_reports(report_week_start=monday)
    result = archive_week_reports(week, service=service)

    saved_ids = [row["reportId"] for row in result["saved"]]
    queued = 0
    for report in WeeklyReport.objects.filter(pk__in=saved_ids):
        if report.status == WeeklyReport.STATUS_SNAPSHOT and _queue_ai_rewrite(report):
            queued += 1
        notify_workspace(
            event_key=f"weekly-report-drive-{report.report_key}"[:255],
            title="Báo cáo tuần đã lưu lên Drive",
            message=(
                f"Báo cáo tuần {report.completed_week} của bạn đã được lưu vào thư mục TUAN {report.completed_week}"
                + (" và đang được AI viết lại; file trên Drive sẽ tự cập nhật." if report.status == WeeklyReport.STATUS_SNAPSHOT else ".")
            ),
            severity="success",
            category="weekly-report",
            action_url="/communication-tools/weekly-report",
            target_emails=[report.employee_email],
        )
    result["week"] = week
    result["aiQueued"] = queued
    return result
