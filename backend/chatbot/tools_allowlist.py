"""Whitelist, parameter sanitation, identity override, and action execution for Chatbot."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any, Dict, List, Optional, Tuple

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
            # Enforce title length
            valid_links.append({
                "title": title[:100],
                "path": path[:200],
            })
    return valid_links[:5]


def sanitize_and_override_arguments(
    tool_name: str,
    raw_args: Dict[str, Any],
    user: UserProfile,
) -> Dict[str, Any]:
    """Strictly validate tool name, enforce user identity, and validate against schema."""
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

    clean_args = dict(raw_args) if isinstance(raw_args, dict) else {}

    # Strict Identity Overrides: No matter what the model outputs, enforce current user!
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
        try:
            task_id = int(task_id)
            clean_args["task_id"] = task_id
        except (ValueError, TypeError):
            raise ValueError("Mã công việc (task_id) phải là số nguyên.")
        # Ensure task belongs to current user
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
    """Generate human-friendly preview and before/after diff for write confirmation card."""
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

        desc_parts = [f"Cập nhật công việc '{item.title}'"]
        before_state = {
            "Trạng thái": item.get_status_display(),
            "Ghi chú": item.progress_note or "(trống)",
        }
        after_state = {
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
        }
        return description, diff

    elif tool_name == "schedule_create_task":
        title = args.get("title", "")
        work_date = args.get("work_date", "")
        priority = args.get("priority", "medium")
        priority_map = {"low": "Thấp", "medium": "Bình thường", "high": "Cao"}
        description = f"Tạo công việc mới: '{title}' vào ngày {work_date} (Ưu tiên: {priority_map.get(priority, priority)})"
        diff = {
            "before": {"Công việc": "(Chưa tạo)"},
            "after": {
                "Tên công việc": title,
                "Ngày thực hiện": work_date,
                "Ưu tiên": priority_map.get(priority, priority),
                "Người thực hiện": user.name or user.email,
            },
        }
        return description, diff

    elif tool_name == "docs_update_weekly_report_draft":
        week = args.get("week_number") or "hiện tại"
        description = f"Cập nhật bản nháp báo cáo tuần {week}"
        diff = {
            "before": {"Trạng thái": "Bản nháp hiện có"},
            "after": {
                "Nhóm việc đã làm": len(args.get("completed_groups") or []),
                "Khó khăn/vướng mắc": len(args.get("difficulties") or []),
                "Kế hoạch tuần tới": len(args.get("planned_groups") or []),
            },
        }
        return description, diff

    return f"Thực hiện hành động '{tool_name}'", {"params": args}


def execute_tool_safely(
    tool_name: str,
    clean_args: Dict[str, Any],
    user: UserProfile,
) -> Dict[str, Any]:
    """Execute an MCP tool directly with the user context."""
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
        # Log audit if applicable
        if tool.audit_action:
            logger.info("Chatbot action executed: %s by %s", tool.audit_action, user.email)
        return result
    except Exception as exc:
        logger.error("Error executing tool %s for %s: %s", tool_name, user.email, exc)
        return {"success": False, "error": str(exc)}
