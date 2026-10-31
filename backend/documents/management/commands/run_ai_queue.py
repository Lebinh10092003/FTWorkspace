"""Management command to process background AI report rewrite jobs from the queue."""

import logging
import signal
import time
from concurrent.futures import ThreadPoolExecutor

from django.core.management.base import BaseCommand
from django.db import connections

from documents.ai_service import (
    claim_next_job,
    expire_stale_jobs,
    get_max_concurrent,
    process_ai_job,
)

logger = logging.getLogger(__name__)


def _worker_wrapper(job_type: str, job_id: int):
    try:
        if job_type == "chat":
            from chatbot.service import process_chat_job
            process_chat_job(job_id)
        elif job_type == "news_post":
            from news_posts.service import process_news_post_job
            process_news_post_job(job_id)
        elif job_type == "gmail":
            from gmail_assistant.ai_service import process_mail_job
            process_mail_job(job_id)
        elif job_type == "publishing":
            from publishing.service import process_publish_ai_job
            process_publish_ai_job(job_id)
        else:
            process_ai_job(job_id)
    finally:
        connections.close_all()


class Command(BaseCommand):
    help = "Chạy tiến trình worker xử lý hàng đợi AI viết lại báo cáo tuần."

    def add_arguments(self, parser):
        parser.add_argument(
            "--poll-interval",
            type=float,
            default=2.0,
            help="Thời gian chờ giữa các lần kiểm tra hàng đợi (giây). Mặc định 2.0.",
        )
        parser.add_argument(
            "--once",
            action="store_true",
            help="Chạy một lượt xử lý các công việc sẵn sàng rồi thoát (dùng cho kiểm thử/cron).",
        )

    def handle(self, *args, **options):
        poll_interval = max(0.5, float(options.get("poll_interval") or 2.0))
        run_once = bool(options.get("once"))
        max_concurrent = get_max_concurrent()

        stop_requested = False

        def _handle_signal(signum, frame):
            nonlocal stop_requested
            self.stdout.write(self.style.WARNING(f"\nNhận tín hiệu dừng ({signum}), đang thoát êm..."))
            stop_requested = True

        signal.signal(signal.SIGINT, _handle_signal)
        signal.signal(signal.SIGTERM, _handle_signal)

        self.stdout.write(
            self.style.SUCCESS(
                f"Bắt đầu AI queue worker (đồng thời tối đa: {max_concurrent}, thăm dò: {poll_interval}s)..."
            )
        )

        executor = ThreadPoolExecutor(max_workers=max_concurrent)
        active_futures = []

        try:
            while not stop_requested:
                # 1. Clean up stale jobs
                expire_stale_jobs()

                # 2. Filter out completed futures
                active_futures = [f for f in active_futures if not f.done()]

                # 3. Claim jobs up to available capacity
                while len(active_futures) < max_concurrent and not stop_requested:
                    job = claim_next_job()
                    if not job:
                        break
                    job_kind = getattr(job, "job_kind", None)
                    if not job_kind:
                        if job.__class__.__name__ == "MailJob":
                            job_kind = "gmail"
                        else:
                            job_kind = getattr(job, "job_type", "report")
                    self.stdout.write(f"Đã nhận việc [{job_kind}] #{job.id} cho {job.user.email} (status: running)")
                    future = executor.submit(_worker_wrapper, job_kind, job.id)
                    active_futures.append(future)

                if run_once:
                    # In once mode, wait for submitted tasks to complete and then exit
                    break

                # Sleep until next poll or signal
                sleep_start = time.monotonic()
                while time.monotonic() - sleep_start < poll_interval and not stop_requested:
                    time.sleep(0.2)

        finally:
            self.stdout.write("Đang chờ các tác vụ đang chạy hoàn tất...")
            executor.shutdown(wait=True)
            self.stdout.write(self.style.SUCCESS("AI queue worker đã dừng an toàn."))
