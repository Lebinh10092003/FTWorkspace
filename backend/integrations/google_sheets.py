import json
import os
import re
from typing import Any

from google.oauth2.credentials import Credentials as OAuthCredentials
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets"
DOCS_SCOPE = "https://www.googleapis.com/auth/documents.readonly"
REQUIRED_SHEETS = {
    "DASHBOARD": (100, 20),
    "KENH_MXH": (1000, 20),
    "BAI_DANG": (1000, 20),
    "DU_LIEU_NGAY": (1000, 20),
    "NHAT_KY_API": (1000, 20),
}

SHEET_HEADERS = {
    "KENH_MXH": [
        "channel_id", "platform", "channel_name", "external_id", "channel_url",
        "status", "timezone", "created_at", "updated_at", "last_sync_at",
        "last_sync_status", "total_posts", "reactions", "comments", "shares",
        "total_engagement",
    ],
    "BAI_DANG": [
        "post_key", "platform", "channel_id", "external_post_id", "post_url",
        "post_type", "message", "published_at", "imported_at", "updated_at",
        "is_deleted", "reactions", "likes", "comments", "shares", "views",
        "reach", "total_engagement", "engagement_rate",
    ],
    "DU_LIEU_NGAY": [
        "snapshot_key", "snapshot_date", "platform", "channel_id", "post_key",
        "reactions", "likes", "comments", "shares", "views", "reach",
        "impressions", "clicks", "total_engagement", "engagement_rate",
        "fetched_at",
    ],
    "NHAT_KY_API": [
        "log_id", "started_at", "ended_at", "platform", "action", "channel_id",
        "status", "records_received", "records_inserted", "records_updated",
        "error_code", "error_message", "request_id",
    ],
}


def extract_spreadsheet_id(value: str) -> str:
    source = str(value or "").strip()
    if not source:
        return ""
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", source)
    if match:
        return match.group(1)
    if re.fullmatch(r"[a-zA-Z0-9_-]{20,}", source):
        return source
    return ""


def _service_account_info(config_data: dict[str, Any]) -> dict[str, Any] | None:
    raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        raw = str(config_data.get("googleServiceAccountJson") or "").strip()
    if not raw:
        return None
    try:
        info = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("Google Service Account JSON không hợp lệ.") from exc
    if not info.get("client_email") or not info.get("private_key"):
        raise ValueError("Service Account phải có client_email và private_key.")
    info["private_key"] = str(info["private_key"]).replace("\\n", "\n")
    return info


def build_google_credentials(user_token: str | None, config_data: dict[str, Any], *, scopes: list[str]):
    info = _service_account_info(config_data)
    if info:
        return service_account.Credentials.from_service_account_info(
            info,
            scopes=scopes,
        )
    if user_token:
        return OAuthCredentials(token=user_token, scopes=scopes)
    raise ValueError(
        "Cần GOOGLE_SERVICE_ACCOUNT_JSON hoặc Google OAuth Access Token để truy cập Google Workspace."
    )


def build_sheets_service(user_token: str | None, config_data: dict[str, Any]):
    credentials = build_google_credentials(user_token, config_data, scopes=[SHEETS_SCOPE])
    return build("sheets", "v4", credentials=credentials, cache_discovery=False)


def build_docs_service(user_token: str | None, config_data: dict[str, Any]):
    credentials = build_google_credentials(user_token, config_data, scopes=[DOCS_SCOPE])
    return build("docs", "v1", credentials=credentials, cache_discovery=False)


def _dashboard_values() -> list[list[str]]:
    return [
        ["FT SOCIAL ANALYTICS - BÁO CÁO TỔNG QUAN", ""],
        ["Trạng thái:", "Dữ liệu cập nhật từ FT Workspace"],
        ["", ""],
        ["Số liệu KPI tổng hợp", ""],
        ["Chỉ số", "Giá trị"],
        ["Tổng số bài viết", "=COUNTA(BAI_DANG!A2:A)"],
        ["Tổng lượt tương tác", "=SUM(DU_LIEU_NGAY!N2:N)"],
        ["Tổng lượt tiếp cận", "=SUM(DU_LIEU_NGAY!K2:K)"],
        ["Lượt xem", "=SUM(DU_LIEU_NGAY!J2:J)"],
        ["Phản hồi", "=SUM(DU_LIEU_NGAY!F2:F)"],
        ["Bình luận", "=SUM(DU_LIEU_NGAY!H2:H)"],
        ["Chia sẻ", "=SUM(DU_LIEU_NGAY!I2:I)"],
        ["", ""],
        ["Lưu ý:", "Bảng tổng hợp sử dụng công thức từ các tab dữ liệu chi tiết."],
    ]


def initialize_sheets_structure(service, spreadsheet_id: str) -> dict[str, Any]:
    try:
        metadata = service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            fields="sheets(properties(sheetId,title))",
        ).execute()
        existing = {
            sheet.get("properties", {}).get("title")
            for sheet in metadata.get("sheets", [])
        }

        add_requests = []
        for title, (rows, columns) in REQUIRED_SHEETS.items():
            if title not in existing:
                add_requests.append(
                    {
                        "addSheet": {
                            "properties": {
                                "title": title,
                                "gridProperties": {
                                    "rowCount": rows,
                                    "columnCount": columns,
                                },
                            }
                        }
                    }
                )
        if add_requests:
            service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": add_requests},
            ).execute()

        metadata = service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            fields="sheets(properties(sheetId,title))",
        ).execute()
        sheet_ids = {
            sheet["properties"]["title"]: sheet["properties"]["sheetId"]
            for sheet in metadata.get("sheets", [])
            if sheet.get("properties", {}).get("title")
        }

        format_requests = []
        for title, headers in SHEET_HEADERS.items():
            current = service.spreadsheets().values().get(
                spreadsheetId=spreadsheet_id,
                range=f"'{title}'!A1:Z1",
            ).execute().get("values", [])
            if not current or not current[0]:
                service.spreadsheets().values().update(
                    spreadsheetId=spreadsheet_id,
                    range=f"'{title}'!A1",
                    valueInputOption="RAW",
                    body={"values": [headers]},
                ).execute()

            sheet_id = sheet_ids.get(title)
            if sheet_id is not None:
                format_requests.extend(
                    [
                        {
                            "updateSheetProperties": {
                                "properties": {
                                    "sheetId": sheet_id,
                                    "gridProperties": {"frozenRowCount": 1},
                                },
                                "fields": "gridProperties.frozenRowCount",
                            }
                        },
                        {
                            "repeatCell": {
                                "range": {
                                    "sheetId": sheet_id,
                                    "startRowIndex": 0,
                                    "endRowIndex": 1,
                                    "startColumnIndex": 0,
                                    "endColumnIndex": len(headers),
                                },
                                "cell": {
                                    "userEnteredFormat": {
                                        "textFormat": {"bold": True},
                                        "backgroundColor": {
                                            "red": 0.90,
                                            "green": 0.94,
                                            "blue": 1.0,
                                        },
                                    }
                                },
                                "fields": "userEnteredFormat(textFormat,backgroundColor)",
                            }
                        },
                    ]
                )

        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range="'DASHBOARD'!A1",
            valueInputOption="USER_ENTERED",
            body={"values": _dashboard_values()},
        ).execute()

        if format_requests:
            service.spreadsheets().batchUpdate(
                spreadsheetId=spreadsheet_id,
                body={"requests": format_requests},
            ).execute()

        return {
            "success": True,
            "spreadsheetId": spreadsheet_id,
            "createdSheets": len(add_requests),
            "message": "Khởi tạo và kiểm tra cấu trúc Google Sheets thành công.",
        }
    except HttpError as exc:
        detail = getattr(exc, "reason", None) or str(exc)
        raise RuntimeError(f"Google Sheets API từ chối yêu cầu: {detail}") from exc
