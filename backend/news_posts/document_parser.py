"""Document parser extracting clean text from .docx, .txt, and .md files without heavy external dependencies."""

from __future__ import annotations

import csv
import io
import logging
import os
import zipfile
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

MAX_DOC_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_DOCS_PER_POST = 10
MAX_CHARS_PER_FILE = 20_000
MAX_TOTAL_CHARS = 60_000

DOCX_XML_NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
}


def _extract_text_from_docx_bytes(data: bytes) -> str:
    """Extract paragraphs and tables from .docx archive using standard library zipfile and xml."""
    try:
        with zipfile.ZipFile(io.BytesIO(data), "r") as zf:
            if "word/document.xml" not in zf.namelist():
                raise ValueError("Tệp .docx không hợp lệ (thiếu word/document.xml).")

            xml_content = zf.read("word/document.xml")
            root = ET.fromstring(xml_content)

            body = root.find("w:body", DOCX_XML_NS)
            if body is None:
                return ""

            lines: List[str] = []
            for elem in body:
                tag = elem.tag.split("}")[-1]
                if tag == "p":
                    texts = [t.text for t in elem.iterfind(".//w:t", DOCX_XML_NS) if t.text]
                    p_text = "".join(texts).strip()
                    if p_text:
                        lines.append(p_text)
                elif tag == "tbl":
                    for row in elem.iterfind(".//w:tr", DOCX_XML_NS):
                        cells = []
                        for cell in row.iterfind(".//w:tc", DOCX_XML_NS):
                            c_texts = [t.text for t in cell.iterfind(".//w:t", DOCX_XML_NS) if t.text]
                            cells.append("".join(c_texts).strip())
                        if any(cells):
                            lines.append(" | ".join(cells))

            return "\n".join(lines).strip()
    except zipfile.BadZipFile:
        raise ValueError("Tệp tin không đúng định dạng Word (.docx) hoặc đã bị hỏng.")
    except Exception as exc:
        if isinstance(exc, ValueError):
            raise
        logger.warning("Lỗi trích xuất tệp .docx: %s", exc)
        raise ValueError(f"Không thể đọc nội dung tệp .docx: {exc}")


def _extract_text_from_plain_bytes(data: bytes) -> str:
    """Decode plain text or markdown file trying utf-8, cp1258, utf-16, and latin-1."""
    encodings = ["utf-8-sig", "utf-8", "cp1258", "utf-16", "latin-1"]
    for enc in encodings:
        try:
            return data.decode(enc).strip()
        except (UnicodeDecodeError, LookupError):
            continue
    return data.decode("utf-8", errors="replace").strip()


def _extract_text_from_csv_bytes(data: bytes) -> str:
    """Parse CSV data into readable text lines separated by |."""
    plain_text = _extract_text_from_plain_bytes(data)
    if not plain_text:
        return ""
    try:
        reader = csv.reader(io.StringIO(plain_text))
        lines: List[str] = []
        for row in reader:
            cleaned_row = [cell.strip() for cell in row if cell.strip()]
            if cleaned_row:
                lines.append(" | ".join(cleaned_row))
        return "\n".join(lines).strip()
    except Exception:
        return plain_text


def extract_text_from_file(
    file_bytes: bytes,
    filename: str,
    file_type: str = "agenda",
) -> Dict[str, Any]:
    """Validate, parse and truncate text from a single uploaded document file (.docx, .txt, .md, .csv)."""
    if not file_bytes:
        raise ValueError("Tệp tin tải lên rỗng (0 bytes).")

    if len(file_bytes) > MAX_DOC_SIZE_BYTES:
        raise ValueError(f"Tệp vượt quá kích thước cho phép ({len(file_bytes) // (1024 * 1024)}MB > 5MB).")

    fname = str(filename or "").strip()
    fname_lower = fname.lower()

    if fname_lower.endswith(".docx"):
        # Verify ZIP magic header
        if not file_bytes.startswith(b"PK\x03\x04"):
            raise ValueError("Tệp không đúng định dạng .docx chuẩn (thiếu chữ ký ZIP).")
        raw_text = _extract_text_from_docx_bytes(file_bytes)
    elif fname_lower.endswith(".txt") or fname_lower.endswith(".md"):
        raw_text = _extract_text_from_plain_bytes(file_bytes)
    elif fname_lower.endswith(".csv"):
        raw_text = _extract_text_from_csv_bytes(file_bytes)
    else:
        raise ValueError(f"Định dạng tệp không được hỗ trợ: '{fname}'. Chỉ chấp nhận .docx, .txt, .md, .csv.")

    truncated = False
    if len(raw_text) > MAX_CHARS_PER_FILE:
        raw_text = raw_text[:MAX_CHARS_PER_FILE].rstrip() + "\n\n[...Đã cắt bớt vì vượt quá giới hạn 20.000 ký tự...]"
        truncated = True

    return {
        "name": fname,
        "fileType": file_type,
        "size": len(file_bytes),
        "text": raw_text,
        "charCount": len(raw_text),
        "truncated": truncated,
    }


def validate_and_truncate_files_total(doc_files: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Enforce maximum total character limit across all files in a post."""
    if len(doc_files) > MAX_DOCS_PER_POST:
        raise ValueError(f"Số lượng tệp vượt quá giới hạn cho phép ({len(doc_files)} > {MAX_DOCS_PER_POST} tệp).")

    current_total = 0
    results: List[Dict[str, Any]] = []

    for doc in doc_files:
        text = str(doc.get("text") or "")
        remaining = MAX_TOTAL_CHARS - current_total
        if remaining <= 0:
            results.append({
                **doc,
                "text": "[...Đã bỏ qua tệp này vì tổng dung lượng văn bản vượt quá 60.000 ký tự...]",
                "charCount": 0,
                "truncated": True,
            })
            continue

        if len(text) > remaining:
            truncated_text = text[:remaining].rstrip() + "\n\n[...Đã cắt bớt vì tổng dung lượng vượt quá 60.000 ký tự...]"
            results.append({
                **doc,
                "text": truncated_text,
                "charCount": len(truncated_text),
                "truncated": True,
            })
            current_total = MAX_TOTAL_CHARS
        else:
            results.append(doc)
            current_total += len(text)

    return results
