"""Check user weekly report schedules and dispatch reminders or auto-generate jobs."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from authentication.notifications import notify_workspace
from documents.models import AiReportJob, WeeklyReportSchedule, WeeklyReportSupplement
from documents.weekly_reports import build_schedule_reports, week_start

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Check enabled WeeklyReportSchedule rows, send reminders, and enqueue AI report jobs."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Bypass time and weekday checks, running for all enabled schedules.",
        )

    def handle(self, *args, **options):
        now = timezone.localtime()
        force = options.get("force", False)
        current_year = now.year
        current_week_num = now.isocalendar().week
        week_id = current_year * 100 + current_week_num
        current_weekday = now.weekday()  # 0=Monday .. 6=Sunday

        schedules = WeeklyReportSchedule.objects.select_related("user").filter(enabled=True)
        remind_count = 0
        run_count = 0

        self.stdout.write(
            f"Checking weekly report schedules at {now.strftime('%Y-%m-%d %H:%M:%S %Z')} "
            f"(Thứ {current_weekday + 2}, Tuần {current_week_num}, {schedules.count()} active schedules)"
        )

        for sched in schedules:
            user = sched.user
            if not user or not user.is_active:
                continue

            run_time = sched.run_time
            run_dt = now.replace(
                hour=run_time.hour,
                minute=run_time.minute,
                second=0,
                microsecond=0,
            )
            remind_dt = run_dt - timedelta(minutes=sched.remind_minutes)

            # 1. Check reminder
            if not force and sched.weekday == current_weekday:
                if now >= remind_dt and now < run_dt:
                    if sched.last_reminded_week != week_id:
                        time_str = run_time.strftime("%H:%M")
                        try:
                            notify_workspace(
                                event_key=f"weekly-report-remind-{user.id}-{week_id}",
                                title="Báo cáo tuần: Chuẩn bị nội dung",
                                message=(
                                    f"Báo cáo tuần của bạn sẽ được tạo tự động lúc {time_str}. "
                                    "Bạn có thể bổ sung ghi chú hoặc tải lên tệp đính kèm ngay bây giờ."
                                ),
                                severity="normal",
                                category="weekly-report",
                                action_url="/communication-tools/weekly-report",
                                target_users=[user],
                            )
                            sched.last_reminded_week = week_id
                            sched.save(update_fields=["last_reminded_week", "updated_at"])
                            remind_count += 1
                            self.stdout.write(f"  [Reminder sent] User {user.email} (auto-run at {time_str})")
                        except Exception as exc:
                            logger.exception("Error sending auto-report reminder to %s: %s", user.email, exc)

            # 2. Check auto-run
            should_run = force or (
                sched.weekday == current_weekday
                and now >= run_dt
                and sched.last_run_week != week_id
            )

            if should_run:
                # If run today (usually Friday), the reporting week is current week's Monday
                current_monday = week_start(now.date())
                try:
                    reports = build_schedule_reports(
                        report_week_start=current_monday,
                        employee_email=user.email,
                    )
                    if not reports:
                        self.stdout.write(self.style.WARNING(f"  Could not build schedule report draft for {user.email}"))
                        continue
                    report = reports[0]

                    # Load supplement
                    supp = WeeklyReportSupplement.objects.filter(
                        user=user,
                        week_start=current_monday,
                    ).first()
                    snapshot = {}
                    if supp:
                        snapshot = {
                            "note": supp.note,
                            "attachments": supp.attachments or [],
                        }

                    # Check if user already has an active AI job
                    active_job = AiReportJob.objects.filter(
                        user=user,
                        status__in=[AiReportJob.STATUS_QUEUED, AiReportJob.STATUS_RUNNING],
                    ).first()

                    if not active_job:
                        job = AiReportJob.objects.create(
                            user=user,
                            report=report,
                            supplement_snapshot=snapshot,
                            status=AiReportJob.STATUS_QUEUED,
                        )
                        run_count += 1
                        self.stdout.write(f"  [Job enqueued] AI Job #{job.id} for {user.email} (Report #{report.id})")

                        notify_workspace(
                            event_key=f"weekly-report-autorun-{user.id}-{week_id}",
                            title="Báo cáo tuần: Đang tạo tự động",
                            message=(
                                f"Hệ thống đang tự động tổng hợp báo cáo tuần {report.completed_week} cho bạn. "
                                "Báo cáo sẽ sớm hoàn tất để bạn kiểm tra và tải về."
                            ),
                            severity="normal",
                            category="weekly-report",
                            action_url="/communication-tools/weekly-report",
                            target_users=[user],
                        )
                    else:
                        self.stdout.write(f"  [Skipped enqueue] User {user.email} already has active Job #{active_job.id}")

                    sched.last_run_week = week_id
                    sched.save(update_fields=["last_run_week", "updated_at"])

                except Exception as exc:
                    logger.exception("Error enqueuing auto-report for %s: %s", user.email, exc)
                    self.stdout.write(self.style.ERROR(f"  Error auto-running for {user.email}: {exc}"))

        self.stdout.write(
            self.style.SUCCESS(
                f"Finished schedule check: {remind_count} reminders sent, {run_count} jobs enqueued."
            )
        )
