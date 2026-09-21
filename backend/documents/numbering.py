"""Official document numbers, issued straight out of the shared Google Sheet.

The sheet is the register of record: the next number is whatever the largest
number already written there is, plus one. Nothing is mirrored into the
database, so a number the team writes into the sheet by hand counts exactly the
same as one this module issued.

Sheet layout (tab "SỐ LẤY SỐ VĂN BẢN", resolved by gid so a rename cannot break
it): row 1 is the banner, row 2 the column headers, data from row 3.

    Thứ | Thời gian | Số văn bản | Loại văn bản | Nội dung công việc |
    Người soạn | Người ký
"""
import re
import unicodedata
from datetime import date, datetime

from django.utils import timezone

from authentication.models import SystemConfig
from integrations.google_sheets import build_sheets_service

# The same workbook the work schedule already syncs with, so the service
# account needs no extra sharing.
DEFAULT_SPREADSHEET_ID = "1kWiJdTSM_6ZDeLTGCWvDA3num5n0DmRH2Tv-6AwuBYc"
DEFAULT_SHEET_GID = 138890787
CONFIG_KEY = "document_numbers"

HEADER_ROWS = 2
COLUMN_COUNT = 7

# Weekday names as the register writes them, Monday first.
WEEKDAYS_VI = ["Hai", "Ba", "Tư", "Năm", "Sáu", "Bảy", "CN"]

# Codes follow Nghị định 30/2020/NĐ-CP. "Công văn" carries no code at all, which
# is why its numbers read "40/FT" while a decision reads "41/QĐ-FT".
DOCUMENT_TYPES = [
    {"label": "Công văn", "code": ""},
    {"label": "Quyết định", "code": "QĐ"},
    {"label": "Báo cáo", "code": "BC"},
    {"label": "Thông báo", "code": "TB"},
    {"label": "Tờ trình", "code": "TTr"},
    {"label": "Kế hoạch", "code": "KH"},
    {"label": "Biên bản", "code": "BB"},
    {"label": "Hợp đồng", "code": "HĐ"},
    {"label": "Nghị quyết", "code": "NQ"},
    {"label": "Nghị định", "code": "NĐ"},
    {"label": "Quy chế", "code": "QC"},
    {"label": "Quy định", "code": "QyĐ"},
    {"label": "Hướng dẫn", "code": "HD"},
    {"label": "Giấy mời", "code": "GM"},
    {"label": "Giấy giới thiệu", "code": "GGT"},
    {"label": "Phiếu đề xuất kinh phí", "code": "PĐXKP"},
]

_SUFFIX = "FT"
_NUMBER_PREFIX = re.compile(r"^\s*(\d+)")
_WORD_SPLIT = re.compile(r"[^\wÀ-ỹ]+", re.UNICODE)


def _normalise(value):
    plain = "".join(
        char for char in unicodedata.normalize("NFD", str(value or "").casefold())
        if unicodedata.category(char) != "Mn"
    ).replace("đ", "d")
    return " ".join(plain.split())


def derive_type_code(label):
    """Initials of a document type, e.g. "Thông báo" -> "TB".

    Used for a type that is not in DOCUMENT_TYPES, so the team can register a
    kind of document this module has never seen without a code change.
    """
    words = [word for word in _WORD_SPLIT.split(str(label or "").strip()) if word]
    return "".join(word[0].upper() for word in words)


def type_code_for(label):
    target = _normalise(label)
    for entry in DOCUMENT_TYPES:
        if _normalise(entry["label"]) == target:
            return entry["code"]
    return derive_type_code(label)


def format_number(sequence, type_label):
    """"46" + "Quyết định" -> "46/QĐ-FT"; "Công văn" -> "46/FT"."""
    code = type_code_for(type_label)
    number = f"{int(sequence):02d}"
    return f"{number}/{code}-{_SUFFIX}" if code else f"{number}/{_SUFFIX}"


def weekday_label(value):
    return WEEKDAYS_VI[value.weekday()]


def _settings():
    config = SystemConfig.objects.filter(key=CONFIG_KEY).first()
    data = config.data if config and isinstance(config.data, dict) else {}
    return {
        "spreadsheetId": str(data.get("spreadsheetId") or "").strip() or DEFAULT_SPREADSHEET_ID,
        "gid": int(data.get("gid") or DEFAULT_SHEET_GID),
    }


def _service(google_token=None):
    main = SystemConfig.objects.filter(key="main").first()
    config_data = main.data if main and isinstance(main.data, dict) else {}
    token = google_token or (main.last_google_access_token if main else None)
    return build_sheets_service(token, config_data)


def _tab_title(service, spreadsheet_id, gid):
    """Resolve the tab by its gid, so renaming it cannot break the register."""
    metadata = service.spreadsheets().get(
        spreadsheetId=spreadsheet_id, fields="sheets.properties"
    ).execute()
    sheets = metadata.get("sheets", [])
    for sheet in sheets:
        properties = sheet.get("properties", {})
        if int(properties.get("sheetId", -1)) == int(gid):
            return properties.get("title", "")
    raise ValueError("Không tìm thấy trang tính lấy số văn bản trong bảng tính đã cấu hình.")


def _read_rows(service, spreadsheet_id, title):
    result = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"'{title}'!A:G",
        valueRenderOption="UNFORMATTED_VALUE",
    ).execute()
    return result.get("values", [])


def sequence_of(cell):
    match = _NUMBER_PREFIX.match(str(cell or ""))
    return int(match.group(1)) if match else None


def _highest(rows):
    numbers = [
        sequence_of(row[2])
        for row in rows[HEADER_ROWS:]
        if len(row) > 2 and sequence_of(row[2]) is not None
    ]
    return max(numbers) if numbers else 0


def _entry_from(row):
    padded = list(row) + [""] * (COLUMN_COUNT - len(row))
    return {
        "weekday": str(padded[0] or ""),
        "date": str(padded[1] or ""),
        "number": str(padded[2] or ""),
        "documentType": str(padded[3] or ""),
        "subject": str(padded[4] or ""),
        "drafter": str(padded[5] or ""),
        "signer": str(padded[6] or ""),
    }


def register_state(google_token=None, recent=8):
    """Latest issued number, the next one available, and the tail of the register."""
    config = _settings()
    service = _service(google_token)
    title = _tab_title(service, config["spreadsheetId"], config["gid"])
    rows = _read_rows(service, config["spreadsheetId"], title)
    body = [row for row in rows[HEADER_ROWS:] if any(str(cell).strip() for cell in row)]
    latest = _highest(rows)
    return {
        "latest": latest,
        "next": latest + 1,
        "sheetTitle": title,
        "spreadsheetId": config["spreadsheetId"],
        "gid": config["gid"],
        "recent": [_entry_from(row) for row in body[-recent:]][::-1],
    }


def parse_date(value):
    text = str(value or "").strip()
    if not text:
        return timezone.localdate()
    for pattern in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    raise ValueError("Ngày không hợp lệ. Định dạng đúng là dd/mm/yyyy.")


def issue_number(*, document_type, subject, drafter, signer, issued_on=None, google_token=None):
    """Append one row to the register and return the number it was given.

    The sheet is the source of truth, so the number is read immediately before
    the write. Two people issuing at the same instant can still land on the same
    number; the row is re-checked afterwards and renumbered if that happened.
    """
    when = issued_on if isinstance(issued_on, date) else parse_date(issued_on)
    config = _settings()
    service = _service(google_token)
    title = _tab_title(service, config["spreadsheetId"], config["gid"])

    rows = _read_rows(service, config["spreadsheetId"], title)
    sequence = _highest(rows) + 1
    number = format_number(sequence, document_type)
    row = [
        weekday_label(when),
        when.strftime("%d/%m/%Y"),
        number,
        str(document_type or "").strip(),
        str(subject or "").strip(),
        str(drafter or "").strip(),
        str(signer or "").strip(),
    ]
    response = service.spreadsheets().values().append(
        spreadsheetId=config["spreadsheetId"],
        range=f"'{title}'!A:G",
        valueInputOption="USER_ENTERED",
        insertDataOption="INSERT_ROWS",
        body={"values": [row]},
    ).execute()

    updated_range = (response.get("updates") or {}).get("updatedRange", "")
    resolved = _resolve_collision(
        service, config["spreadsheetId"], title, updated_range, sequence, document_type
    )
    return {
        "number": resolved["number"],
        "sequence": resolved["sequence"],
        "weekday": row[0],
        "date": row[1],
        "documentType": row[3],
        "subject": row[4],
        "drafter": row[5],
        "signer": row[6],
        "sheetTitle": title,
        "spreadsheetId": config["spreadsheetId"],
        "gid": config["gid"],
        "renumbered": resolved["sequence"] != sequence,
    }


def _resolve_collision(service, spreadsheet_id, title, updated_range, sequence, document_type):
    """Give our row a fresh number if someone else took the same one."""
    if not updated_range:
        return {"number": format_number(sequence, document_type), "sequence": sequence}
    rows = _read_rows(service, spreadsheet_id, title)
    taken = [
        sequence_of(row[2])
        for row in rows[HEADER_ROWS:]
        if len(row) > 2 and sequence_of(row[2]) is not None
    ]
    if taken.count(sequence) <= 1:
        return {"number": format_number(sequence, document_type), "sequence": sequence}

    corrected = (max(taken) if taken else sequence) + 1
    number = format_number(corrected, document_type)
    cell = _number_cell(updated_range)
    if cell:
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=cell,
            valueInputOption="USER_ENTERED",
            body={"values": [[number]]},
        ).execute()
    return {"number": number, "sequence": corrected}


def _number_cell(updated_range):
    """"'Tab'!A40:G40" -> "'Tab'!C40" (column C holds the number)."""
    match = re.search(r"^(.*!)[A-Z]+(\d+)(?::[A-Z]+\d+)?$", str(updated_range or ""))
    if not match:
        return ""
    return f"{match.group(1)}C{match.group(2)}"
