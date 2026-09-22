from django.db import models


class WeeklyReport(models.Model):
    """The structured report that powers the web preview and Word download.

    Google Docs remains the human/AI authoring surface.  Keeping a structured
    copy locally lets Workspace render the report reliably without scraping a
    document in the browser or exposing Google credentials to users.
    """

    STATUS_SNAPSHOT = "snapshot"
    STATUS_PUBLISHED = "published"
    STATUS_CHOICES = [
        (STATUS_SNAPSHOT, "Đã lấy từ lịch công tác"),
        (STATUS_PUBLISHED, "Đã cập nhật từ báo cáo AI"),
    ]

    report_key = models.CharField(max_length=180, unique=True)
    employee_email = models.EmailField(blank=True, default="", db_index=True)
    employee_name = models.CharField(max_length=255)
    completed_week = models.PositiveSmallIntegerField(db_index=True)
    planned_week = models.PositiveSmallIntegerField(db_index=True)
    completed_items = models.JSONField(default=list, blank=True)
    difficulties = models.JSONField(default=list, blank=True)
    planned_items = models.JSONField(default=list, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_SNAPSHOT)
    google_document_id = models.CharField(max_length=180, blank=True, default="")
    google_tab_id = models.CharField(max_length=180, blank=True, default="")
    source_revision = models.CharField(max_length=500, blank=True, default="")
    document_synced_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-completed_week", "employee_name"]
        indexes = [
            models.Index(fields=["completed_week", "planned_week", "employee_email"], name="weekly_report_period_email"),
        ]

    def __str__(self):
        return f"Tuần {self.completed_week}/{self.planned_week} · {self.employee_name}"
