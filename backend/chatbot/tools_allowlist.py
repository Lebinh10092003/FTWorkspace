"""Whitelist, JSON Schema validation, identity override, and action execution for Chatbot."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set, Tuple

from django.utils import timezone

from authentication.models import UserProfile
from mcp.registry import ToolRegistry
from work_schedule.models import WorkItem

logger = logging.getLogger(__name__)

# Strict tool allowlist
READ_TOOLS = {
    "schedule_get_my_tasks",
    "docs_get_weekly_report",
    "attendance_get_timesheet",
}

WRITE_TOOLS = {
    "schedule_update_task_progress",
    "schedule_create_task",
    "docs_update_weekly_report_draft",
}

CHAT_TOOL_ALLOWLIST = READ_TOOLS | WRITE_TOOLS

# Whitelist of valid internal navigation paths
VALID_WORKSPACE_PATHS = {
    "/",
    "/work-schedule",
    "/attendance",
    "/communication-tools",
    "/communication-tools/weekly-report",
    "/communication-tools/email-builder",
    "/communication-tools/signature-builder",
    "/communication-tools/qr-generator",
    "/communication-tools/funding-proposal",
    "/communication-tools/document-number",
    "/communication-tools/competition-landing",
    "/examination",
    "/digital-training",
    "/social-dashboard",
    "/account-management",
    "/finance-report",
}

# Explicit parameters displayed and confirmed in action cards for write tools
EXPLICIT_PREVIEW_PARAMETERS: Dict[str, Set[str]] = {
    "schedule_update_task_progress": {"task_id", "status", "progress_note"},
    "schedule_create_task": {
        "title",
        "work_date",
        "executor_email",
        "start_time",
        "end_time",
        "priority",
        "description",
    },
    "docs_update_weekly_report_draft": {
        "week_number",
        "completed_groups",
        "difficulties",
        "planned_groups",
    },
}


def is_tool_allowed(tool_name: str) -> bool:
    return tool_name in CHAT_TOOL_ALLOWLIST


def is_read_tool(tool_name: str) -> bool:
    return tool_name in READ_TOOLS


def is_write_tool(tool_name: str) -> bool:
    return tool_name in WRITE_TOOLS


def filter_and_validate_links(raw_links: Any) -> List[Dict[str, str]]:
    """Ensure all links returned by model are safe internal paths in Workspace."""
    if not isinstance(raw_links, list):
        return []

    valid_links = []
    for item in raw_links:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        path = str(item.get("path") or "").strip()
        if not path or not title:
            continue
        # Strip query parameters or hashes for checking base path
        base_path = path.split("?")[0].split("#")[0].rstrip("/") or "/"
        if base_path in VALID_WORKSPACE_PATHS or any(base_path.startswith(p + "/") for p in VALID_WORKSPACE_PATHS if p != "/"):
            valid_links.append({
                "title": title[:100],
                "path": path[:200],
            })
    return valid_links[:5]


def validate_arguments_against_schema(
    tool_name: str,
    raw_args: Dict[str, Any],
    schema: Dict[str, Any],
) -> Dict[str, Any]:
    """Strictly validates args against the tool's JSON Schema:
    - Rejects any key not declared in schema['properties'] (additionalProperties=False)
    - Validates required fields
    - Validates types, string lengths, enums, numbers, and nested array/object structures
    """
    if not isinstance(raw_args, dict):
        raise ValueError("Tham số truyền vào phải là một đối tượng JSON (dictionary).")

    allowed_properties = schema.get("properties", {})
    required_keys = schema.get("required", [])

    # 1. Reject any undeclared key (additionalProperties = False)
    for k in raw_args.keys():
        if k not in allowed_properties:
            raise ValueError(f"Tham số không hợp lệ: Khóa '{k}' không được định nghĩa trong schema của công cụ '{tool_name}'.")

    # 2. Check required fields
    for req in required_keys:
        if req not in raw_args or raw_args[req] is None or (isinstance(raw_args[req], str) and not raw_args[req].strip()):
            raise ValueError(f"Thiếu tham số bắt buộc '{req}' cho công cụ '{tool_name}'.")

    validated: Dict[str, Any] = {}

    # 3. Validate each provided parameter against its specification
    for key, val in raw_args.items():
        if val is None:
            continue
        spec = allowed_properties.get(key, {})
        expected_type = spec.get("type")

        if expected_type == "string":
            if not isinstance(val, str):
                raise ValueError(f"Tham số '{key}' phải là chuỗi (string), nhận được {type(val).__name__}.")
            val_clean = val.strip()
            max_len = 1000
            if len(val_clean) > max_len:
                raise ValueError(f"Tham số '{key}' quá dài (tối đa {max_len} ký tự).")
            if "enum" in spec and val_clean not in spec["enum"]:
                raise ValueError(f"Giá trị '{val_clean}' của '{key}' không hợp lệ. Cho phép: {spec['enum']}.")
            validated[key] = val_clean

        elif expected_type == "integer":
            if isinstance(val, bool) or not isinstance(val, int):
                if isinstance(val, str) and (val.isdigit() or (val.startswith("-") and val[1:].isdigit())):
                    val = int(val)
                else:
                    raise ValueError(f"Tham số '{key}' phải là số nguyên (integer), nhận được {type(val).__name__}.")
            if "minimum" in spec and val < spec["minimum"]:
                raise ValueError(f"Tham số '{key}' có giá trị {val} nhỏ hơn mức tối thiểu ({spec['minimum']}).")
            if "maximum" in spec and val > spec["maximum"]:
                raise ValueError(f"Tham số '{key}' có giá trị {val} vượt quá mức tối đa ({spec['maximum']}).")
            validated[key] = val

        elif expected_type == "boolean":
            if not isinstance(val, bool):
                raise ValueError(f"Tham số '{key}' phải là boolean (true/false).")
            validated[key] = val

        elif expected_type == "array":
            if not isinstance(val, list):
                raise ValueError(f"Tham số '{key}' phải là danh sách (array), nhận được {type(val).__name__}.")
            if len(val) > 100:
                raise ValueError(f"Danh sách '{key}' vượt quá 100 phần tử.")
            item_spec = spec.get("items", {})
            item_type = item_spec.get("type")

            clean_list = []
            if item_type == "string":
                for it in val:
                    if not isinstance(it, str):
                        raise ValueError(f"Các phần tử trong danh sách '{key}' phải là chuỗi.")
                    it_clean = it.strip()
                    if len(it_clean) > 500:
                        raise ValueError(f"Phần tử trong danh sách '{key}' quá dài (tối đa 500 ký tự).")
                    if it_clean:
                        clean_list.append(it_clean)
            elif item_type == "object":
                sub_props = item_spec.get("properties", {})
                sub_req = item_spec.get("required", [])
                for idx, obj in enumerate(val):
                    if not isinstance(obj, dict):
                        raise ValueError(f"Phần tử thứ {idx + 1} trong danh sách '{key}' phải là đối tượng.")
                    for sk in obj.keys():
                        if sk not in sub_props:
                            raise ValueError(f"Khóa '{sk}' trong phần tử '{key}' không hợp lệ.")
                    for sr in sub_req:
                        if sr not in obj:
                            raise ValueError(f"Phần tử thứ {idx + 1} trong '{key}' thiếu trường '{sr}'.")
                    clean_obj = {}
                    for pk, pv in obj.items():
                        p_spec = sub_props.get(pk, {})
                        p_type = p_spec.get("type")
                        if p_type == "string":
                            if not isinstance(pv, str):
                                raise ValueError(f"Trường '{pk}' trong '{key}' phải là chuỗi.")
                            clean_obj[pk] = pv.strip()[:200]
                        elif p_type == "array":
                            if not isinstance(pv, list):
                                raise ValueError(f"Trường '{pk}' trong '{key}' phải là danh sách.")
                            clean_items = [str(x).strip()[:500] for x in pv if str(x).strip()]
                            clean_obj[pk] = clean_items[:50]
                        else:
                            clean_obj[pk] = pv
                    clean_list.append(clean_obj)
            else:
                clean_list = val
            validated[key] = clean_list

        else:
            validated[key] = val

    return validated


def sanitize_and_override_arguments(
    tool_name: str,
    raw_args: Dict[str, Any],
    user: UserProfile,
) -> Dict[str, Any]:
    """Strictly validate tool name, validate schema, enforce user identity and reject undeclared keys."""
    if not is_tool_allowed(tool_name):
        raise PermissionError(f"Công cụ '{tool_name}' không được phép sử dụng trong trợ lý chatbot.")

    tool = ToolRegistry.get_tool(tool_name)
    if not tool:
        raise ValueError(f"Không tìm thấy công cụ '{tool_name}' trong hệ thống.")

    # Check minimum role
    user_role = getattr(user, "role", "EMPLOYEE")
    role_order = {"VIEWER": 0, "EMPLOYEE": 1, "MANAGER": 2, "ADMIN": 3}
    user_level = role_order.get(str(user_role).upper(), 0)
    min_level = role_order.get(str(tool.min_role or "EMPLOYEE").upper(), 1)
    if user_level < min_level:
        raise PermissionError(f"Bạn không đủ quyền để sử dụng công cụ '{tool_name}'.")

    # Reject any destructive tool (safety guarantee)
    if tool.is_destructive:
        raise PermissionError("Các công cụ mang tính chất xóa/thu hồi dữ liệu bị cấm hoàn toàn trong chatbot.")

    # 1. Strictly validate raw_args against tool.parameters JSON schema
    clean_args = validate_arguments_against_schema(tool_name, raw_args, tool.parameters)

    # 2. Strict Identity Overrides: No matter what the model outputs, enforce current user!
    if tool_name == "schedule_get_my_tasks":
        clean_args["staff_email"] = user.email
    elif tool_name == "docs_get_weekly_report":
        clean_args["staff_email"] = user.email
    elif tool_name == "attendance_get_timesheet":
        clean_args["staff_email"] = user.email
    elif tool_name == "schedule_create_task":
        clean_args["executor_email"] = user.email
    elif tool_name == "schedule_update_task_progress":
        task_id = clean_args.get("task_id")
        if not task_id:
            raise ValueError("Thiếu mã công việc (task_id).")
        task_item = WorkItem.objects.filter(pk=task_id).first()
        if not task_item:
            raise ValueError(f"Không tìm thấy công việc với ID {task_id}.")
        if task_item.executor_id != user.pk:
            raise PermissionError("Bạn chỉ được phép cập nhật công việc của chính mình.")

    return clean_args


def generate_action_preview(
    tool_name: str,
    args: Dict[str, Any],
    user: UserProfile,
) -> Tuple[str, Dict[str, Any]]:
    """Generate human-friendly preview and before/after diff for write confirmation card.
    Strictly verifies that EVERY parameter in args is accounted for and shown in the preview.
    """
    allowed_preview_keys = EXPLICIT_PREVIEW_PARAMETERS.get(tool_name, set())
    unaccounted = set(args.keys()) - allowed_preview_keys
    if unaccounted:
        raise ValueError(f"Phát hiện tham số ẩn ngoài phần xem trước ({unaccounted}). Thao tác bị từ chối.")

    if tool_name == "schedule_update_task_progress":
        task_id = args["task_id"]
        item = WorkItem.objects.get(pk=task_id)
        status_map = {
            "todo": "Cần làm",
            "doing": "Đang làm",
            "completed": "Đã hoàn thành",
        }
        new_status = args.get("status")
        new_note = args.get("progress_note")

        desc_parts = [f"Cập nhật công việc '{item.title}' (ID #{task_id})"]
        before_state = {
            "Mã công việc": task_id,
            "Trạng thái": item.get_status_display(),
            "Ghi chú": item.progress_note or "(trống)",
        }
        after_state = {
            "Mã công việc": task_id,
            "Trạng thái": status_map.get(new_status, new_status) if new_status else item.get_status_display(),
            "Ghi chú": new_note if new_note is not None else (item.progress_note or "(trống)"),
        }
        if new_status:
            desc_parts.append(f"đổi trạng thái sang '{status_map.get(new_status, new_status)}'")
        if new_note:
            desc_parts.append(f"ghi chú: '{new_note}'")

        description = " - ".join(desc_parts)
        diff = {
            "before": before_state,
            "after": after_state,
            "all_parameters": dict(args),
        }
        return description, diff

    elif tool_name == "schedule_create_task":
        title = args.get("title", "")
        work_date = args.get("work_date", "")
        priority = args.get("priority", "medium")
        priority_map = {"low": "Thấp", "medium": "Bình thường", "high": "Cao"}
        description = f"Tạo công việc mới: '{title}' vào ngày {work_date} (Ưu tiên: {priority_map.get(priority, priority)})"
        
        after_state = {
            "Tên công việc": title,
            "Ngày thực hiện": work_date,
            "Mức độ ưu tiên": priority_map.get(priority, priority),
            "Người thực hiện": user.name or user.email,
        }
        if "start_time" in args and args["start_time"]:
            after_state["Giờ bắt đầu"] = args["start_time"]
        if "end_time" in args and args["end_time"]:
            after_state["Giờ kết thúc"] = args["end_time"]
        if "description" in args and args["description"]:
            after_state["Mô tả"] = args["description"]

        diff = {
            "before": {"Công việc": "(Chưa tạo)"},
            "after": after_state,
            "all_parameters": dict(args),
        }
        return description, diff

    elif tool_name == "docs_update_weekly_report_draft":
        week = args.get("week_number") or "hiện tại"
        completed_groups = args.get("completed_groups") or []
        difficulties = args.get("difficulties") or []
        planned_groups = args.get("planned_groups") or []

        description = f"Cập nhật bản nháp báo cáo tuần {week}"
        after_state = {
            "Tuần báo cáo": week,
            "Nhóm việc đã làm": f"{len(completed_groups)} nhóm",
            "Khó khăn/vướng mắc": f"{len(difficulties)} mục",
            "Kế hoạch tuần tới": f"{len(planned_groups)} nhóm",
        }
        diff = {
            "before": {"Trạng thái": "Bản nháp hiện có"},
            "after": after_state,
            "all_parameters": dict(args),
        }
        return description, diff

    raise ValueError(f"Công cụ '{tool_name}' không hỗ trợ tạo phần xem trước.")


def execute_tool_safely(
    tool_name: str,
    clean_args: Dict[str, Any],
    user: UserProfile,
) -> Dict[str, Any]:
    """Execute an MCP tool directly with the user context.
    Strictly re-checks ownership right before execution (cannot rely on card-creation check).
    """
    if not is_tool_allowed(tool_name):
        raise PermissionError(f"Công cụ '{tool_name}' không nằm trong danh sách trắng được phép.")

    # Re-check no hidden parameters
    if is_write_tool(tool_name):
        allowed_keys = EXPLICIT_PREVIEW_PARAMETERS.get(tool_name, set())
        unaccounted = set(clean_args.keys()) - allowed_keys
        if unaccounted:
            raise ValueError(f"Không thể thực thi: tham số ẩn '{unaccounted}' ngoài phần xem trước.")

    # Re-verify ownership at execution time!
    if tool_name == "schedule_update_task_progress":
        task_id = clean_args.get("task_id")
        task_item = WorkItem.objects.filter(pk=task_id).first()
        if not task_item:
            raise ValueError(f"Công việc ID {task_id} không còn tồn tại trên hệ thống.")
        if task_item.executor_id != user.pk:
            raise PermissionError(
                f"Quyền sở hữu công việc đã thay đổi: Bạn không còn là người phụ trách công việc #{task_id} "
                f"(hiện do {task_item.executor_id} phụ trách)."
            )

    if tool_name == "schedule_create_task":
        clean_args["executor_email"] = user.email

    if tool_name == "docs_update_weekly_report_draft":
        clean_args.pop("staff_email", None)

    tool = ToolRegistry.get_tool(tool_name)
    if not tool:
        raise ValueError(f"Không tìm thấy công cụ '{tool_name}'.")

    ctx = {
        "user": user,
        "profile": user,
        "email": user.email,
        "role": getattr(user, "role", "EMPLOYEE"),
        "name": getattr(user, "name", "") or user.email,
    }

    try:
        result = tool.handler(ctx=ctx, **clean_args)
        if tool.audit_action:
            logger.info("Chatbot action executed: %s by %s", tool.audit_action, user.email)
        return result
    except PermissionError:
        raise
    except Exception as exc:
        logger.error("Error executing tool %s for %s: %s", tool_name, user.email, exc)
        return {"success": False, "error": str(exc)}
