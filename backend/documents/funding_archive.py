"""Store a generated Word file directly in the funding proposal Drive folder."""
import os
from io import BytesIO

from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

from authentication.models import SystemConfig
from integrations.google_sheets import build_google_credentials

FOLDER_ID = "19lI4Pb31gQodj0yyZjV3g8Md_OePgffv"
DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _service():
    main = SystemConfig.objects.filter(key="main").first()
    data = main.data if main and isinstance(main.data, dict) else {}
    credentials = build_google_credentials(
        main.last_google_access_token if main else None,
        data,
        scopes=["https://www.googleapis.com/auth/drive.file"],
    )
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


def save_proposal(*, draft_id, filename, content, file_id=""):
    service = _service()
    folder_id = os.getenv("FUNDING_PROPOSAL_DRIVE_FOLDER_ID", FOLDER_ID).strip() or FOLDER_ID
    media = MediaIoBaseUpload(BytesIO(content), mimetype=DOCX_TYPE, resumable=False)
    fields = "id,webViewLink"
    if file_id:
        result = service.files().update(
            fileId=file_id, body={"name": filename}, media_body=media,
            fields=fields, supportsAllDrives=True,
        ).execute()
    else:
        # A retry after a successful Drive upload but failed database response
        # reuses the file rather than creating another copy.
        found = service.files().list(
            q=(f"appProperties has {{ key='fundingDraftId' and value='{draft_id}' }} "
               f"and '{folder_id}' in parents and trashed = false"),
            fields="files(id)", supportsAllDrives=True, includeItemsFromAllDrives=True,
        ).execute().get("files", [])
        existing = found[0]["id"] if found else ""
        if existing:
            result = service.files().update(
                fileId=existing, body={"name": filename}, media_body=media,
                fields=fields, supportsAllDrives=True,
            ).execute()
        else:
            result = service.files().create(
                body={"name": filename, "parents": [folder_id],
                      "appProperties": {"fundingDraftId": str(draft_id)}},
                media_body=media, fields=fields, supportsAllDrives=True,
            ).execute()
    saved_id = result["id"]
    return saved_id, result.get("webViewLink") or f"https://drive.google.com/file/d/{saved_id}/view"
