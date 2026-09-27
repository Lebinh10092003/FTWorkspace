import os
import signal
from pathlib import Path
from threading import Event

from django.core.management.base import BaseCommand
from django.db import close_old_connections
from django.db.models import Min
from django.utils import timezone

from digital_training.assessment_lifecycle import close_due_assessments
from digital_training.models import TrainingAssessment


class Command(BaseCommand):
    help = "Wait for the next saved deadline and close due assessments."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Process due tests once and exit.")

    def handle(self, *args, **options):
        if options["once"]:
            self.stdout.write(f"Closed {close_due_assessments()} due assessment(s).")
            return

        pid_file = os.getenv("ASSESSMENT_CLOSING_PID_FILE")
        if not pid_file:
            raise RuntimeError("ASSESSMENT_CLOSING_PID_FILE is required for the deadline worker.")
        wake = Event()
        stopping = False

        def on_wake(_signum, _frame):
            wake.set()

        def on_stop(_signum, _frame):
            nonlocal stopping
            stopping = True
            wake.set()

        signal.signal(signal.SIGUSR1, on_wake)
        signal.signal(signal.SIGTERM, on_stop)
        signal.signal(signal.SIGINT, on_stop)
        path = Path(pid_file)
        path.write_text(str(os.getpid()), encoding="ascii")
        try:
            while not stopping:
                close_old_connections()
                count = close_due_assessments()
                if count:
                    self.stdout.write(f"Closed {count} due assessment(s).")
                close_old_connections()
                next_deadline = TrainingAssessment.objects.filter(
                    status="published", trashed_at__isnull=True, closes_at__isnull=False,
                ).aggregate(next_at=Min("closes_at"))["next_at"]
                seconds = max(0, (next_deadline - timezone.now()).total_seconds()) if next_deadline else None
                wake.wait(seconds)
                wake.clear()
        finally:
            if path.exists() and path.read_text(encoding="ascii") == str(os.getpid()):
                path.unlink()
