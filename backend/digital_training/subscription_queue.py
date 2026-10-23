"""Hàng đợi outbox đồng bộ Đăng ký dịch vụ khách hàng với Google Sheet."""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import uuid
from typing import Any, Dict, List

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from authentication.models import SystemConfig
from integrations.google_sheets import build_sheets_service
from .models import SubscriptionSheetOutbox, TrainingProductSubscription
from .subscription_sheet_sync import (
    DEFAULT_TAB_TITLE,
    get_spreadsheet_id,
    get_sync_credentials,
    import_subscriptions_from_sheet,
    export_subscriptions_to_sheet,
    remove_subscription_sheet_rows,
)

logger = logging.getLogger(__name__)

_launch_lock = threading.Lock()
_launch_timer: threading.Timer | None = None


def enqueue_subscription(subscription_id: Any, action: str = "upsert") -> None:
    """Lưu yêu cầu đồng bộ vào cùng transaction với thao tác DB."""
    if not subscription_id:
        return
    SubscriptionSheetOutbox.objects.update_or_create(
        subscription_id=str(subscription_id),
        defaults={"action": action, "revision": uuid.uuid4(), "attempts": 0, "last_error": ""},
    )
    transaction.on_commit(launch_subscription_sheet_worker)


def enqueue_subscription_deletion(subscription_id: Any) -> None:
    """Lưu yêu cầu xóa dòng trên Google Sheet khi đăng ký bị xóa khỏi web."""
    if not subscription_id:
        return
    SubscriptionSheetOutbox.objects.update_or_create(
        subscription_id=str(subscription_id),
        defaults={"action": "delete", "revision": uuid.uuid4(), "attempts": 0, "last_error": ""},
    )
    transaction.on_commit(launch_subscription_sheet_worker)


def _start_worker() -> None:
    global _launch_timer
    with _launch_lock:
        _launch_timer = None
    manage_py = settings.BASE_DIR / "manage.py"
    kwargs = {"cwd": str(settings.BASE_DIR), "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    else:
        kwargs["start_new_session"] = True
    try:
        subprocess.Popen([sys.executable, str(manage_py), "sync_subscription_sheet_queue"], **kwargs)
    except OSError:
        logger.exception("Không khởi chạy được worker hàng đợi đăng ký dịch vụ.")


def launch_subscription_sheet_worker() -> None:
    global _launch_timer
    if "test" in sys.argv:
        return
    with _launch_lock:
        if _launch_timer:
            _launch_timer.cancel()
        _launch_timer = threading.Timer(2.0, _start_worker)
        _launch_timer.daemon = True
        _launch_timer.start()


def drain_subscription_sheet_queue(*, limit: int = 50) -> Dict[str, Any]:
    """Xử lý các bản ghi thay đổi trong hàng đợi outbox."""
    jobs = list(SubscriptionSheetOutbox.objects.order_by("attempts", "enqueued_at")[:limit])
    if not jobs:
        return {"status": "empty", "processed": 0}

    spreadsheet_id = get_spreadsheet_id()
    if not spreadsheet_id:
        return {"status": "error", "message": "Chưa cấu hình Google Spreadsheet ID."}

    token, cfg, sa_email = get_sync_credentials()
    try:
        service = build_sheets_service(token, cfg)
    except Exception as exc:
        SubscriptionSheetOutbox.objects.filter(pk__in=[j.pk for j in jobs]).update(
            attempts=F("attempts") + 1, last_error=str(exc)[:500]
        )
        return {"status": "error", "message": str(exc)}

    # Tìm tên tab
    target_title = DEFAULT_TAB_TITLE
    try:
        meta = service.spreadsheets().get(
            spreadsheetId=spreadsheet_id,
            fields="sheets(properties.title)",
        ).execute()
        existing_titles = [s.get("properties", {}).get("title") for s in meta.get("sheets", [])]
        for candidate in [DEFAULT_TAB_TITLE, "Trang tính1", "Dịch vụ khách hàng", "Theo dõi dịch vụ"]:
            if candidate in existing_titles:
                target_title = candidate
                break
    except Exception:
        pass

    summary = {"deleted": 0, "upserted": 0, "failed": 0}

    # 1. Xử lý các job delete
    delete_jobs = [j for j in jobs if j.action == "delete"]
    if delete_jobs:
        delete_ids = [j.subscription_id for j in delete_jobs]
        try:
            removed_count = remove_subscription_sheet_rows(service, spreadsheet_id, target_title, delete_ids)
            summary["deleted"] += removed_count
            SubscriptionSheetOutbox.objects.filter(pk__in=[j.pk for j in delete_jobs]).delete()
        except Exception as exc:
            logger.warning(f"Lỗi khi xóa dòng trên Sheet từ hàng đợi: {exc}")
            SubscriptionSheetOutbox.objects.filter(pk__in=[j.pk for j in delete_jobs]).update(
                attempts=F("attempts") + 1, last_error=str(exc)[:500]
            )
            summary["failed"] += len(delete_jobs)

    # 2. Xử lý các job upsert: Nhập thay đổi từ Sheet về trước, sau đó xuất ra Sheet
    upsert_jobs = [j for j in jobs if j.action != "delete"]
    if upsert_jobs:
        try:
            # Nhập trước để tránh đè mất sửa đổi gõ tay trên Sheet
            import_subscriptions_from_sheet()
            # Xuất toàn bộ dữ liệu hợp chuẩn ra Sheet
            export_res = export_subscriptions_to_sheet(force=True)
            if export_res.get("status") in {"synced", "unchanged"}:
                SubscriptionSheetOutbox.objects.filter(pk__in=[j.pk for j in upsert_jobs]).delete()
                summary["upserted"] += len(upsert_jobs)
            else:
                err_msg = export_res.get("message", "Lỗi xuất Sheet.")
                SubscriptionSheetOutbox.objects.filter(pk__in=[j.pk for j in upsert_jobs]).update(
                    attempts=F("attempts") + 1, last_error=err_msg[:500]
                )
                summary["failed"] += len(upsert_jobs)
        except Exception as exc:
            logger.exception("Lỗi khi xử lý hàng đợi outbox đăng ký dịch vụ.")
            SubscriptionSheetOutbox.objects.filter(pk__in=[j.pk for j in upsert_jobs]).update(
                attempts=F("attempts") + 1, last_error=str(exc)[:500]
            )
            summary["failed"] += len(upsert_jobs)

    return summary
