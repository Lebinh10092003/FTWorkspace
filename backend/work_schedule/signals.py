import os
import subprocess
import sys
import threading
from contextvars import ContextVar

from django.conf import settings
from django.db import transaction
from django.db.models.signals import post_save, pre_delete, pre_save
from django.dispatch import receiver

from .models import WorkItem, WorkScheduleSheetChange


_queue_suppressed = ContextVar("work_schedule_sheet_queue_suppressed", default=False)
_launch_lock = threading.Lock()
_launch_timer = None


class suppress_sheet_queue:
    def __enter__(self):
        self.token = _queue_suppressed.set(True)

    def __exit__(self, *args):
        _queue_suppressed.reset(self.token)


def _start_worker():
    global _launch_timer
    with _launch_lock:
        _launch_timer = None
    if "test" in sys.argv:
        return
    manage_py = settings.BASE_DIR / "manage.py"
    kwargs = {"cwd": str(settings.BASE_DIR), "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    else:
        kwargs["start_new_session"] = True
    try:
        subprocess.Popen([sys.executable, str(manage_py), "sync_work_schedule_sheet", "--direction", "to-sheet"], **kwargs)
    except OSError:
        pass


def launch_sheet_sync_worker():
    global _launch_timer
    if "test" in sys.argv:
        return
    with _launch_lock:
        if _launch_timer:
            _launch_timer.cancel()
        _launch_timer = threading.Timer(1.0, _start_worker)
        _launch_timer.daemon = True
        _launch_timer.start()


def queue_group(executor_email, work_date):
    if _queue_suppressed.get() or not executor_email or not work_date:
        return
    WorkScheduleSheetChange.objects.create(executor_email=executor_email, work_date=work_date)
    transaction.on_commit(launch_sheet_sync_worker, robust=True)


@receiver(pre_save, sender=WorkItem)
def remember_previous_group(sender, instance, **kwargs):
    if not instance.pk or _queue_suppressed.get():
        return
    previous = WorkItem.objects.filter(pk=instance.pk).values_list("executor_id", "work_date").first()
    if previous and previous != (instance.executor_id, instance.work_date):
        instance._previous_sheet_group = previous


@receiver(post_save, sender=WorkItem)
def queue_saved_item(sender, instance, **kwargs):
    queue_group(instance.executor_id, instance.work_date)
    previous = getattr(instance, "_previous_sheet_group", None)
    if previous:
        queue_group(*previous)


@receiver(pre_delete, sender=WorkItem)
def queue_deleted_item(sender, instance, **kwargs):
    queue_group(instance.executor_id, instance.work_date)
