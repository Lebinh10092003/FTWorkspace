from __future__ import annotations

import base64
import logging
import uuid
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from documents.funding_numbering import assign_funding_number
from documents.funding_proposal import build_funding_proposal, file_title
from documents.models import FundingProposalRecord, WeeklyReport
from documents.numbering import (
    DOCUMENT_TYPES,
    format_number,
    issue_number,
    register_state,
    weekday_label,
)
from .registry import register_tool

logger = logging.getLogger(__name__)


def vietnamese_number_to_words(number: int) -> str:
    """Đọc số nguyên thành chữ tiếng Việt chuẩn (hàng triệu, nghìn, đồng chẵn)."""
    if number == 0:
        return "Không đồng chẵn"
    units = ["", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"]
    levels = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ"]

    def read_three(b, is_highest):
        h, t, u = b // 100, (b % 100) // 10, b % 10
        res = []
        if h > 0:
            res.append(units[h] + " trăm")
        elif not is_highest:
            res.append("không trăm")
        if t == 0:
            if u > 0:
                if h > 0 or not is_highest:
                    res.append("lẻ")
                res.append(units[u])
        elif t == 1:
            res.append("mười")
            if u == 1:
                res.append("một")
            elif u == 5:
                res.append("lăm")
            elif u > 0:
                res.append(units[u])
        else:
            res.append(units[t] + " mươi")
            if u == 1:
                res.append("mốt")
            elif u == 4:
                res.append("tư")
            elif u == 5:
                res.append("lăm")
            elif u > 0:
                res.append(units[u])
        return " ".join(res)

    parts = []
    num = abs(number)
    is_neg = number < 0
    i = 0
    while num > 0:
        b = num % 1000
        if b > 0:
            txt = read_three(b, num < 1000)
            if levels[i]:
                txt += " " + levels[i]
            parts.insert(0, txt)
        num //= 1000
        i += 1
    out = " ".join(parts).strip()
    return ("Âm " if is_neg else "") + out.capitalize() + " đồng chẵn"


def _calc_totals(items: List[Dict[str, Any]], vat_rate: Any = None, other_cost: Any = None) -> Dict[str, Any]:
    subtotal = 0.0
    processed_items = []
    for idx, it in enumerate(items, 1):
        desc = str(it.get("description") or "").strip()
        unit = str(it.get("unit") or "").strip()
        qty_raw = it.get("quantity") or 0
        price_raw = it.get("unitPrice") if "unitPrice" in it else it.get("unit_price", 0)
        try:
            qty = float(str(qty_raw).replace(",", "").strip() or 0)
        except (ValueError, TypeError):
            qty = 0.0
        try:
            price = float(str(price_raw).replace(",", "").strip() or 0)
        except (ValueError, TypeError):
            price = 0.0
        line_sum = qty * price
        subtotal += line_sum
        processed_items.append({
            "id": str(it.get("id") or f"item-{idx}"),
            "description": desc,
            "unit": unit,
            "quantity": str(int(qty) if qty == int(qty) else qty),
            "unitPrice": str(int(price) if price == int(price) else price),
            "lineTotal": line_sum,
        })

    try:
        vat_pct = float(str(vat_rate or 0).replace("%", "").strip() or 0)
    except (ValueError, TypeError):
        vat_pct = 0.0
    vat_amount = subtotal * (vat_pct / 100.0)

    try:
        other = float(str(other_cost or 0).replace(",", "").strip() or 0)
    except (ValueError, TypeError):
        other = 0.0

    grand_total = subtotal + vat_amount + other
    grand_int = int(round(grand_total))

    return {
        "subtotal": subtotal,
        "vat_rate": vat_pct,
        "vat_amount": vat_amount,
        "other_cost": other,
        "grand_total": grand_total,
        "grand_total_int": grand_int,
        "in_words": vietnamese_number_to_words(grand_int),
        "items": processed_items,
    }


# ==============================================================================
# PHIẾU ĐỀ XUẤT KINH PHÍ (FUNDING PROPOSAL)
# ==============================================================================

@register_tool(
    name="docs_create_funding_proposal",
    description=(
        "Lập và cấp số chính thức cho Phiếu đề xuất kinh phí (PĐXKP) theo chuẩn FermatTech. "
        "Tự động tính toán tổng kinh phí, thuế VAT, chi phí khác, số tiền bằng chữ tiếng Việt, "
        "cấp số văn bản chính thức (dạng XX/PĐXKP-FT), sinh file Word .docx in ấn và tùy chọn lưu Google Drive."
    ),
    module="documents",
    min_role="EMPLOYEE",
    audit_action="Lập phiếu đề xuất kinh phí",
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Tên nội dung đề xuất kinh phí (hoặc tiêu đề ngắn)"},
            "file_title": {"type": "string", "description": "Tiêu đề đầy đủ của phiếu (mặc định: Phiếu đề xuất kinh phí + title)"},
            "proposer": {"type": "string", "description": "Họ tên người đề xuất (mặc định: tên tài khoản đăng nhập)"},
            "department": {"type": "string", "description": "Bộ phận / Phòng ban đề xuất"},
            "project": {"type": "string", "description": "Công việc hoặc Dự án cần chi phí (bắt buộc)"},
            "purpose": {"type": "string", "description": "Mục đích, kết quả cần đạt của đề xuất"},
            "approval_deadline": {"type": "string", "description": "Hạn cần duyệt (định dạng YYYY-MM-DD hoặc dd/mm/yyyy)"},
            "items": {
                "type": "array",
                "description": "Danh sách các khoản mục kinh phí chi tiết",
                "items": {
                    "type": "object",
                    "properties": {
                        "description": {"type": "string", "description": "Nội dung chi phí"},
                        "unit": {"type": "string", "description": "Đơn vị tính (buổi, ngày, bộ, người...)"},
                        "quantity": {"type": ["number", "string"], "description": "Số lượng"},
                        "unit_price": {"type": ["number", "string"], "description": "Đơn giá (VND)"},
                    },
                    "required": ["description", "quantity", "unit_price"],
                },
            },
            "vat_rate": {"type": ["number", "string"], "description": "Thuế suất VAT (%) nếu có, ví dụ 8 hoặc 10"},
            "other_cost": {"type": ["number", "string"], "description": "Chi phí khác nếu có phát sinh ngoài đơn giá"},
            "supplier": {"type": "string", "description": "Thông tin nhà cung cấp / Đơn vị thụ hưởng thanh toán"},
            "payment_method": {
                "type": "string",
                "enum": ["transfer", "cash"],
                "description": "Hình thức thanh toán: 'transfer' (Chuyển khoản) hoặc 'cash' (Tiền mặt)",
            },
            "advance_amount": {"type": ["number", "string"], "description": "Số tiền tạm ứng nếu có"},
            "advance_document": {"type": "string", "description": "Tại phiếu tạm ứng số (nếu có)"},
            "advance_date": {"type": "string", "description": "Ngày tạm ứng (nếu có)"},
            "kind": {
                "type": "string",
                "enum": ["new", "adjustment"],
                "description": "Loại đề xuất: 'new' (Đề xuất mới) hoặc 'adjustment' (Điều chỉnh, bổ sung)",
            },
            "submission_round": {"type": "string", "description": "Lần trình duyệt (ví dụ: '1')"},
            "department_head": {"type": "string", "description": "Họ tên Trưởng bộ phận"},
            "attachments": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Hồ sơ kèm theo (các mã: 'quote' - Báo giá, 'quantity' - Bảng số lượng, 'approval' - Phê duyệt trước, 'spec' - Mẫu sản phẩm)",
            },
            "attachment_other": {"type": "string", "description": "Tài liệu kèm theo khác"},
            "bndc_link": {"type": "string", "description": "Đường dẫn hồ sơ BNDC (nếu có)"},
            "save_to_drive": {
                "type": "boolean",
                "description": "Tự động tải và lưu trữ file Word lên thư mục Google Drive của công ty (mặc định: false)",
            },
            "return_base64": {
                "type": "boolean",
                "description": "Trả về nội dung file Word (.docx) mã hóa Base64 để tải trực tiếp (mặc định: false)",
            },
        },
        "required": ["project"],
        "additionalProperties": False,
    },
)
def docs_create_funding_proposal(
    ctx: Dict[str, Any],
    project: str,
    title: str = "",
    file_title: str = "",
    proposer: str = "",
    department: str = "",
    purpose: str = "",
    approval_deadline: str = "",
    items: Optional[List[Dict[str, Any]]] = None,
    vat_rate: Any = None,
    other_cost: Any = None,
    supplier: str = "",
    payment_method: str = "transfer",
    advance_amount: Any = None,
    advance_document: str = "",
    advance_date: str = "",
    kind: str = "new",
    submission_round: str = "1",
    department_head: str = "",
    attachments: Optional[List[str]] = None,
    attachment_other: str = "",
    bndc_link: str = "",
    save_to_drive: bool = False,
    return_base64: bool = False,
    **_kwargs,
) -> Dict[str, Any]:
    owner_email = str(ctx.get("email") or "").strip().lower()
    profile = ctx.get("profile")

    # Điền mặc định thông tin người lập nếu chưa truyền
    final_proposer = str(proposer or (profile.name if profile and getattr(profile, "name", "") else owner_email.split("@")[0])).strip()
    final_department = str(department or (profile.department.name if profile and getattr(profile, "department", None) else "")).strip()
    final_title = str(file_title or title or f"Phiếu đề xuất kinh phí - {project}").strip()
    if final_title.lower().endswith(".docx"):
        final_title = final_title[:-5].rstrip()

    raw_items = items or []
    if not raw_items:
        # Nếu chưa truyền danh sách items chi tiết, tạo 1 dòng mặc định từ project
        raw_items = [{"description": project, "unit": "gói", "quantity": 1, "unit_price": 0}]

    calc = _calc_totals(raw_items, vat_rate, other_cost)
    draft_id = uuid.uuid4()

    # Xây dựng payload đầy đủ tương thích với build_funding_proposal của FTWorkspace
    payload = {
        "draftId": str(draft_id),
        "fileTitle": final_title,
        "currency": "VND",
        "issuedOn": timezone.localdate().strftime("%Y-%m-%d"),
        "kind": kind if kind in {"new", "adjustment"} else "new",
        "submissionRound": str(submission_round or "1"),
        "proposer": final_proposer,
        "department": final_department,
        "project": str(project).strip(),
        "departmentHead": str(department_head or "").strip(),
        "purpose": str(purpose or "").strip(),
        "approvalDeadline": str(approval_deadline or "").strip(),
        "items": calc["items"],
        "vatRate": str(calc["vat_rate"]) if calc["vat_rate"] else "",
        "otherCost": str(calc["other_cost"]) if calc["other_cost"] else "",
        "supplier": str(supplier or "").strip(),
        "paymentMethod": payment_method if payment_method in {"transfer", "cash"} else "transfer",
        "advanceAmount": str(advance_amount or "") if advance_amount is not None else "",
        "advanceDocument": str(advance_document or "").strip(),
        "advanceDate": str(advance_date or "").strip(),
        "attachments": attachments or [],
        "attachmentOther": str(attachment_other or "").strip(),
        "bndcLink": str(bndc_link or "").strip(),
    }

    # Cấp số đề xuất kinh phí duy nhất và khóa transaction an toàn
    with transaction.atomic():
        record = FundingProposalRecord.objects.create(
            draft_id=draft_id,
            owner_email=owner_email,
            file_title=final_title,
            proposer=final_proposer,
            project=project,
            purpose=purpose,
            total_amount=f"{calc['grand_total_int']:,}".replace(",", "."),
            payload=payload,
        )
        doc_number = assign_funding_number(record)
        record.refresh_from_db()

    payload["documentNumber"] = doc_number

    # Sinh file Word (.docx) chính thức
    doc_filename, docx_bytes = build_funding_proposal(payload)

    drive_url = ""
    if save_to_drive:
        try:
            from documents.funding_archive import save_proposal
            file_id, drive_url = save_proposal(
                draft_id=record.draft_id,
                filename=doc_filename,
                content=docx_bytes,
            )
            record.drive_file_id = file_id
            record.drive_url = drive_url
            record.save(update_fields=["drive_file_id", "drive_url", "updated_at"])
        except Exception as exc:
            logger.warning("Không thể lưu file đề xuất lên Drive qua MCP: %s", exc)

    res = {
        "success": True,
        "message": f"Đã lập và cấp số thành công Phiếu đề xuất kinh phí: {doc_number}",
        "document_number": doc_number,
        "sequence_number": record.sequence_number,
        "draft_id": str(draft_id),
        "file_name": doc_filename,
        "file_title": final_title,
        "proposer": final_proposer,
        "project": project,
        "drive_url": drive_url or record.drive_url or None,
        "totals": {
            "subtotal": calc["subtotal"],
            "vat_rate": calc["vat_rate"],
            "vat_amount": calc["vat_amount"],
            "other_cost": calc["other_cost"],
            "grand_total": calc["grand_total"],
            "grand_total_formatted": f"{calc['grand_total_int']:,}".replace(",", ".") + " VND",
            "in_words": calc["in_words"],
        },
        "item_count": len(calc["items"]),
    }

    if return_base64:
        res["docx_base64"] = base64.b64encode(docx_bytes).decode("ascii")

    return res


@register_tool(
    name="docs_get_funding_proposal",
    description="Tra cứu chi tiết một Phiếu đề xuất kinh phí đã tạo theo Mã bản nháp (draft_id) hoặc Số văn bản (ví dụ: '05/PĐXKP-FT' hoặc '5').",
    module="documents",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "proposal_id": {
                "type": "string",
                "description": "Số văn bản (ví dụ '05/PĐXKP-FT', '5') hoặc Mã UUID draft_id của phiếu đề xuất",
            },
        },
        "required": ["proposal_id"],
        "additionalProperties": False,
    },
)
def docs_get_funding_proposal(ctx: Dict[str, Any], proposal_id: str, **_kwargs) -> Dict[str, Any]:
    key = str(proposal_id or "").strip()
    if not key:
        return {"success": False, "error": "Vui lòng cung cấp proposal_id."}

    record = None
    # 1. Tìm theo UUID
    try:
        val_uuid = uuid.UUID(key)
        record = FundingProposalRecord.objects.filter(draft_id=val_uuid).first()
    except ValueError:
        pass

    # 2. Tìm theo số văn bản hoặc số thứ tự
    if not record:
        digits = "".join(ch for ch in key if ch.isdigit())
        if digits:
            seq = int(digits)
            record = FundingProposalRecord.objects.filter(Q(document_number__icontains=key) | Q(sequence_number=seq)).first()
        else:
            record = FundingProposalRecord.objects.filter(document_number__iexact=key).first()

    if not record:
        return {"success": False, "error": f"Không tìm thấy phiếu đề xuất kinh phí khớp với '{key}'."}

    payload = record.payload if isinstance(record.payload, dict) else {}
    return {
        "success": True,
        "document_number": record.document_number,
        "sequence_number": record.sequence_number,
        "draft_id": str(record.draft_id),
        "file_title": record.file_title or payload.get("fileTitle", ""),
        "proposer": record.proposer or payload.get("proposer", ""),
        "owner_email": record.owner_email,
        "project": record.project or payload.get("project", ""),
        "purpose": record.purpose or payload.get("purpose", ""),
        "total_amount": record.total_amount,
        "drive_url": record.drive_url or None,
        "created_at": record.created_at.strftime("%d/%m/%Y %H:%M:%S") if record.created_at else "",
        "items": payload.get("items", []),
        "vat_rate": payload.get("vatRate", ""),
        "supplier": payload.get("supplier", ""),
        "payment_method": payload.get("paymentMethod", "transfer"),
    }


@register_tool(
    name="docs_list_funding_proposals",
    description="Xem danh sách các Phiếu đề xuất kinh phí đã tạo trên hệ thống FTWorkspace (hỗ trợ lọc và tìm kiếm).",
    module="documents",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Từ khóa tìm kiếm theo tên dự án, tiêu đề, người đề xuất hoặc số phiếu"},
            "limit": {"type": "integer", "description": "Số lượng bản ghi tối đa (mặc định: 20)"},
        },
        "additionalProperties": False,
    },
)
def docs_list_funding_proposals(ctx: Dict[str, Any], query: str = "", limit: int = 20, **_kwargs) -> Dict[str, Any]:
    qs = FundingProposalRecord.objects.all().order_by("-sequence_number", "-created_at")
    if query:
        q_clean = query.strip()
        digits = "".join(ch for ch in q_clean if ch.isdigit())
        q_filter = (
            Q(file_title__icontains=q_clean)
            | Q(project__icontains=q_clean)
            | Q(proposer__icontains=q_clean)
            | Q(document_number__icontains=q_clean)
        )
        if digits:
            q_filter |= Q(sequence_number=int(digits))
        qs = qs.filter(q_filter)

    max_limit = min(max(1, limit), 100)
    records = []
    for r in qs[:max_limit]:
        records.append({
            "document_number": r.document_number,
            "sequence_number": r.sequence_number,
            "draft_id": str(r.draft_id),
            "file_title": r.file_title,
            "project": r.project,
            "proposer": r.proposer,
            "owner_email": r.owner_email,
            "total_amount": r.total_amount,
            "drive_url": r.drive_url or None,
            "created_at": r.created_at.strftime("%d/%m/%Y %H:%M") if r.created_at else "",
        })

    return {
        "success": True,
        "count": len(records),
        "total": qs.count(),
        "proposals": records,
    }


@register_tool(
    name="docs_calculate_funding_totals",
    description=(
        "Tiện ích tính toán nhanh dự toán kinh phí: nhận danh sách các hạng mục chi phí (đơn giá, số lượng), "
        "thuế suất VAT và chi phí khác. Trả về bảng phân tích tổng tiền và số tiền bằng chữ tiếng Việt chính xác."
    ),
    module="documents",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "description": "Danh sách các khoản mục dự toán chi phí",
                "items": {
                    "type": "object",
                    "properties": {
                        "description": {"type": "string", "description": "Tên chi phí / dịch vụ"},
                        "unit": {"type": "string", "description": "Đơn vị tính"},
                        "quantity": {"type": ["number", "string"], "description": "Số lượng"},
                        "unit_price": {"type": ["number", "string"], "description": "Đơn giá (VND)"},
                    },
                    "required": ["description", "quantity", "unit_price"],
                },
            },
            "vat_rate": {"type": ["number", "string"], "description": "Thuế suất VAT (%) nếu có, ví dụ 8 hoặc 10"},
            "other_cost": {"type": ["number", "string"], "description": "Chi phí khác (VND)"},
        },
        "required": ["items"],
        "additionalProperties": False,
    },
)
def docs_calculate_funding_totals(
    ctx: Dict[str, Any],
    items: List[Dict[str, Any]],
    vat_rate: Any = None,
    other_cost: Any = None,
    **_kwargs,
) -> Dict[str, Any]:
    calc = _calc_totals(items, vat_rate, other_cost)
    return {
        "success": True,
        "item_count": len(calc["items"]),
        "subtotal": calc["subtotal"],
        "subtotal_formatted": f"{int(round(calc['subtotal'])):,}".replace(",", ".") + " VND",
        "vat_rate": calc["vat_rate"],
        "vat_amount": calc["vat_amount"],
        "vat_amount_formatted": f"{int(round(calc['vat_amount'])):,}".replace(",", ".") + " VND",
        "other_cost": calc["other_cost"],
        "other_cost_formatted": f"{int(round(calc['other_cost'])):,}".replace(",", ".") + " VND",
        "grand_total": calc["grand_total"],
        "grand_total_formatted": f"{calc['grand_total_int']:,}".replace(",", ".") + " VND",
        "in_words": calc["in_words"],
        "items": calc["items"],
    }


# ==============================================================================
# SỔ LẤY SỐ CÔNG VĂN / VĂN BẢN ĐI THEO NGHỊ ĐỊNH 30/2020/NĐ-CP
# ==============================================================================

@register_tool(
    name="docs_get_document_register",
    description="Tra cứu Sổ đăng ký văn bản đi / cấp số công văn chính thức (đọc trực tiếp từ Google Sheet Sổ lấy số văn bản).",
    module="documents",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "recent_count": {"type": "integer", "description": "Số lượng văn bản đã cấp gần nhất cần lấy (mặc định: 10)"},
        },
        "additionalProperties": False,
    },
)
def docs_get_document_register(ctx: Dict[str, Any], recent_count: int = 10, **_kwargs) -> Dict[str, Any]:
    try:
        state = register_state(google_token=None, recent=recent_count)
        return {
            "success": True,
            "latest_number": state.get("latest", 0),
            "next_number": state.get("next", 1),
            "sheet_title": state.get("sheetTitle", ""),
            "recent_documents": state.get("recent", []),
            "supported_document_types": DOCUMENT_TYPES,
        }
    except Exception as exc:
        return {
            "success": False,
            "error": f"Không thể tra cứu sổ công văn: {exc}",
        }


@register_tool(
    name="docs_issue_document_number",
    description=(
        "Cấp số chính thức cho Công văn, Quyết định, Tờ trình, Kế hoạch... theo đúng chuẩn Nghị định 30/2020/NĐ-CP. "
        "Ghi trực tiếp một dòng vào Google Sheet Sổ lấy số văn bản của công ty và trả về số hiệu văn bản chính thức."
    ),
    module="documents",
    min_role="EMPLOYEE",
    audit_action="Cấp số công văn chính thức",
    parameters={
        "type": "object",
        "properties": {
            "document_type": {
                "type": "string",
                "description": "Loại văn bản hành chính: 'Công văn', 'Quyết định', 'Báo cáo', 'Thông báo', 'Tờ trình', 'Kế hoạch', 'Biên bản', 'Hợp đồng', 'Báo giá', 'Nghị quyết', 'Quy chế', 'Quy định', 'Hướng dẫn', 'Giấy mời'...",
            },
            "subject": {"type": "string", "description": "Nội dung công việc / Trích yếu văn bản hành chính"},
            "drafter": {"type": "string", "description": "Họ tên người soạn thảo (mặc định: tên tài khoản đăng nhập)"},
            "signer": {"type": "string", "description": "Họ tên hoặc chức danh người ký văn bản (ví dụ: 'Tổng Giám đốc')"},
            "issued_on": {"type": "string", "description": "Ngày ban hành văn bản (định dạng dd/mm/yyyy hoặc YYYY-MM-DD, mặc định: hôm nay)"},
        },
        "required": ["document_type", "subject"],
        "additionalProperties": False,
    },
)
def docs_issue_document_number(
    ctx: Dict[str, Any],
    document_type: str,
    subject: str,
    drafter: str = "",
    signer: str = "",
    issued_on: str = "",
    **_kwargs,
) -> Dict[str, Any]:
    doc_type_clean = str(document_type or "").strip()
    subject_clean = str(subject or "").strip()
    if not doc_type_clean:
        return {"success": False, "error": "Vui lòng chọn loại văn bản."}
    if not subject_clean:
        return {"success": False, "error": "Vui lòng nhập trích yếu / nội dung công việc của văn bản."}
    if doc_type_clean.casefold() == "phiếu đề xuất kinh phí":
        return {
            "success": False,
            "error": "Phiếu đề xuất kinh phí dùng dãy số riêng; vui lòng gọi tool docs_create_funding_proposal.",
        }

    profile = ctx.get("profile")
    final_drafter = str(drafter or (profile.name if profile and getattr(profile, "name", "") else ctx.get("email", "").split("@")[0])).strip()
    final_signer = str(signer or "Tổng Giám đốc").strip()

    try:
        issued = issue_number(
            document_type=doc_type_clean,
            subject=subject_clean,
            drafter=final_drafter,
            signer=final_signer,
            issued_on=issued_on or None,
            google_token=None,
        )
        return {
            "success": True,
            "message": f"Đã cấp số công văn chính thức thành công: {issued.get('number')}",
            "number": issued.get("number"),
            "sequence": issued.get("sequence"),
            "document_type": issued.get("documentType"),
            "subject": issued.get("subject"),
            "drafter": issued.get("drafter"),
            "signer": issued.get("signer"),
            "date": issued.get("date"),
            "weekday": issued.get("weekday"),
            "sheet_title": issued.get("sheetTitle"),
        }
    except Exception as exc:
        return {
            "success": False,
            "error": f"Không thể cấp số công văn trên Google Sheet: {exc}",
        }


@register_tool(
    name="docs_get_document_number_preview",
    description="Xem trước số công văn / văn bản hành chính tiếp theo sẽ được cấp (theo mẫu số chính thức của FermatTech).",
    module="documents",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "document_type": {
                "type": "string",
                "enum": ["Công văn", "Tờ trình", "Quyết định", "Kế hoạch", "Thông báo", "Biên bản", "Báo cáo", "Báo giá"],
                "description": "Loại văn bản hành chính",
            },
        },
        "additionalProperties": False,
    },
)
def docs_get_document_number_preview(ctx: Dict[str, Any], document_type: str = "Công văn", **_kwargs) -> Dict[str, Any]:
    try:
        state = register_state(google_token=None)
        next_num = state.get("next", 1)
        preview_str = format_number(next_num, document_type)
        return {
            "success": True,
            "document_type": document_type,
            "next_sequence": next_num,
            "formatted_number": preview_str,
            "supported_types": DOCUMENT_TYPES,
        }
    except Exception as exc:
        return {
            "success": False,
            "error": f"Không thể đọc sổ công văn: {exc}",
        }


# ==============================================================================
# TRUNG TÂM BÁO CÁO TUẦN (WEEKLY REPORT CENTER)
# ==============================================================================

@register_tool(
    name="docs_get_weekly_report",
    description="Tra cứu nội dung báo cáo tuần của nhân sự (công việc đã làm, khó khăn vướng mắc, kế hoạch tuần tới).",
    module="documents",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "week_number": {"type": "integer", "description": "Tuần báo cáo (ví dụ: tuần 41)"},
            "staff_email": {"type": "string", "description": "Email nhân viên (nếu Quản lý xem người khác)"},
        },
        "additionalProperties": False,
    },
)
def docs_get_weekly_report(ctx: Dict[str, Any], week_number: Optional[int] = None, staff_email: Optional[str] = None, **_kwargs) -> Dict[str, Any]:
    target_email = staff_email.strip().lower() if (staff_email and ctx["role"] in {"ADMIN", "MANAGER"}) else ctx["email"]
    qs = WeeklyReport.objects.filter(employee_email__iexact=target_email)
    if week_number:
        qs = qs.filter(completed_week=week_number)

    report = qs.order_by("-completed_week").first()
    if not report:
        return {"success": False, "error": f"Chưa có báo cáo tuần cho nhân sự {target_email}."}

    return {
        "success": True,
        "employee_name": report.employee_name,
        "completed_week": report.completed_week,
        "planned_week": report.planned_week,
        "status": report.status,
        "completed_items": report.completed_items,
        "difficulties": report.difficulties,
        "planned_items": report.planned_items,
    }


@register_tool(
    name="docs_update_weekly_report_draft",
    description="Cập nhật nội dung bản nháp báo cáo tuần (các nhóm việc đã làm, khó khăn vướng mắc, kế hoạch tuần tới) của nhân sự.",
    module="documents",
    min_role="EMPLOYEE",
    audit_action="Cập nhật bản nháp Báo cáo tuần",
    parameters={
        "type": "object",
        "properties": {
            "week_number": {
                "type": "integer",
                "description": "Tuần báo cáo kết quả (ví dụ 43). Mặc định là báo cáo tuần gần nhất.",
            },
            "completed_groups": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "items": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["name", "items"],
                },
                "description": "Danh sách nhóm việc đã làm",
            },
            "difficulties": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Danh sách các khó khăn, vướng mắc",
            },
            "planned_groups": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "items": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["name", "items"],
                },
                "description": "Danh sách nhóm việc dự kiến tuần tới",
            },
        },
        "additionalProperties": False,
    },
)
def docs_update_weekly_report_draft(
    ctx: Dict[str, Any],
    week_number: Optional[int] = None,
    completed_groups: Optional[List[Dict[str, Any]]] = None,
    difficulties: Optional[List[str]] = None,
    planned_groups: Optional[List[Dict[str, Any]]] = None,
    **_kwargs,
) -> Dict[str, Any]:
    target_email = ctx["email"]
    qs = WeeklyReport.objects.filter(employee_email__iexact=target_email)
    if week_number:
        qs = qs.filter(completed_week=week_number)
    report = qs.order_by("-completed_week").first()
    if not report:
        return {"success": False, "error": f"Không tìm thấy bản nháp báo cáo tuần cho {target_email}."}

    user_name = ctx.get("name") or target_email
    if completed_groups is not None:
        report.completed_groups = completed_groups
        report.completed_items = [
            str(item).strip()
            for g in completed_groups if isinstance(g, dict)
            for item in g.get("items", []) if str(item).strip()
        ]
    if difficulties is not None:
        report.difficulties = [str(d).strip() for d in difficulties if str(d).strip()]
    if planned_groups is not None:
        report.planned_groups = planned_groups
        report.planned_items = [
            str(item).strip()
            for g in planned_groups if isinstance(g, dict)
            for item in g.get("items", []) if str(item).strip()
        ]

    report.status = WeeklyReport.STATUS_EDITED
    report.edited_by_name = user_name
    report.edited_by_email = target_email
    report.edited_at = timezone.now()
    report.save()

    return {
        "success": True,
        "message": f"Đã cập nhật bản nháp báo cáo tuần {report.completed_week} của {report.employee_name}.",
        "report_id": report.id,
        "completed_week": report.completed_week,
        "planned_week": report.planned_week,
    }


@register_tool(
    name="docs_generate_weekly_report",
    description="Tự động trích xuất các công việc đã hoàn thành và việc kế hoạch từ Lịch công tác để lập bản thảo Báo cáo tuần hoàn chỉnh.",
    module="documents",
    min_role="EMPLOYEE",
    audit_action="Lập báo cáo tuần tự động từ Lịch công tác",
    parameters={
        "type": "object",
        "properties": {
            "staff_email": {"type": "string", "description": "Email nhân viên (mặc định là chính mình)"},
            "difficulties": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Các khó khăn, vướng mắc phát sinh trong tuần (nếu có)",
            },
        },
        "additionalProperties": False,
    },
)
def docs_generate_weekly_report(
    ctx: Dict[str, Any],
    staff_email: Optional[str] = None,
    difficulties: Optional[list] = None,
    **_kwargs,
) -> Dict[str, Any]:
    from datetime import timedelta
    from work_schedule.models import WorkItem

    today = timezone.localdate()
    target_email = staff_email.strip().lower() if (staff_email and ctx["role"] in {"ADMIN", "MANAGER"}) else ctx["email"]
    profile = ctx["profile"] if target_email == ctx["email"] else None

    # Tính toán ngày đầu tuần (Thứ Hai) và cuối tuần (Chủ Nhật)
    start_of_week = today - timedelta(days=today.weekday())
    end_of_week = start_of_week + timedelta(days=6)
    week_num = today.isocalendar()[1]

    items = WorkItem.objects.filter(
        executor__email=target_email,
        work_date__gte=start_of_week,
        work_date__lte=end_of_week,
    ).order_by("work_date", "daily_order")

    completed = []
    planned = []
    for it in items:
        entry_text = f"[{it.work_date.strftime('%d/%m')}] {it.title}"
        if it.progress_note:
            entry_text += f" (Tiến độ: {it.progress_note})"
        if it.status in {WorkItem.STATUS_COMPLETED, WorkItem.STATUS_REVIEWED}:
            completed.append(entry_text)
        else:
            planned.append(entry_text)

    return {
        "success": True,
        "employee_name": profile.name if profile else target_email,
        "employee_email": target_email,
        "week_number": week_num,
        "date_range": f"{start_of_week.strftime('%d/%m/%Y')} - {end_of_week.strftime('%d/%m/%Y')}",
        "completed_items": completed,
        "planned_items": planned,
        "difficulties": difficulties or ["Không có vướng mắc đáng kể."],
        "instruction_for_ai": (
            "Hãy hoàn thiện bản Báo cáo tuần chuẩn văn thư theo các mục: "
            "I. KẾT QUẢ CÔNG VIỆC TRONG TUẦN; II. KHÓ KHĂN, ĐỀ XUẤT; III. KẾ HOẠCH TUẦN TỚI."
        ),
    }


@register_tool(
    name="docs_export_weekly_reports",
    description="Xuất (export) danh sách các báo cáo tuần của nhân viên / phòng ban ra CSV (UTF-8 BOM tải vào Excel) hoặc JSON.",
    module="documents",
    min_role="EMPLOYEE",
    parameters={
        "type": "object",
        "properties": {
            "staff_email": {"type": "string", "description": "Email nhân viên (nếu Quản lý/Admin xem người khác)"},
            "format": {
                "type": "string",
                "enum": ["csv", "json"],
                "description": "Định dạng xuất ('csv' hoặc 'json', mặc định 'json')",
            },
        },
        "additionalProperties": False,
    },
)
def docs_export_weekly_reports(
    ctx: Dict[str, Any],
    staff_email: Optional[str] = None,
    format: str = "json",
    **_kwargs,
) -> Dict[str, Any]:
    qs = WeeklyReport.objects.all()
    if staff_email and ctx["role"] in {"ADMIN", "MANAGER"}:
        qs = qs.filter(employee_email__iexact=staff_email.strip())
    elif ctx["role"] not in {"ADMIN", "MANAGER"}:
        qs = qs.filter(employee_email=ctx["email"])

    items = []
    for rep in qs.order_by("-completed_week", "-created_at")[:100]:
        items.append({
            "id": rep.id,
            "employee_email": rep.employee_email,
            "completed_week": rep.completed_week,
            "created_at": rep.created_at.isoformat() if hasattr(rep.created_at, "isoformat") else str(rep.created_at),
            "summary": getattr(rep, "summary", "") or "",
        })

    if format == "csv":
        import csv
        import io
        out = io.StringIO()
        out.write("\ufeff")  # UTF-8 BOM
        writer = csv.writer(out)
        writer.writerow(["STT", "Mã báo cáo", "Nhân viên (Email)", "Tuần số", "Ngày tạo", "Tóm tắt"])
        for idx, it in enumerate(items, 1):
            writer.writerow([idx, it["id"], it["employee_email"], it["completed_week"], it["created_at"], it["summary"]])
        return {
            "success": True,
            "format": "csv",
            "count": len(items),
            "csv_content": out.getvalue(),
        }

    return {
        "success": True,
        "format": "json",
        "count": len(items),
        "reports": items,
    }
