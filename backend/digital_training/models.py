import uuid

from django.db import models
from django.db.models import Q
from django.utils.text import slugify


class TrainingPartner(models.Model):
    name = models.CharField(max_length=255, unique=True)
    address = models.CharField(max_length=500, blank=True)
    contact_person = models.CharField(max_length=255, blank=True)
    contact_position = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
    additional_contacts = models.JSONField(default=list, blank=True)
    contract_start = models.CharField(max_length=20, blank=True)
    contract_end = models.CharField(max_length=20, blank=True)
    training_content = models.TextField(blank=True)
    planned_sessions = models.PositiveIntegerField(default=0)
    notes = models.TextField(blank=True)
    partner_type = models.CharField(max_length=50, blank=True)
    partner_subtype = models.CharField(max_length=100, blank=True)
    province = models.CharField(max_length=100, blank=True, default='')
    ward = models.CharField(max_length=255, blank=True)
    products = models.JSONField(default=list, blank=True)
    contract_duration = models.PositiveIntegerField(null=True, blank=True)
    contract_duration_unit = models.CharField(max_length=10, blank=True)
    contract_signed_date = models.DateField(null=True, blank=True)
    contract_status = models.CharField(max_length=30, blank=True)
    budget = models.DecimalField(max_digits=15, decimal_places=0, null=True, blank=True)
    ai_account_count = models.PositiveIntegerField(default=0)
    training_contents = models.JSONField(default=list, blank=True)
    training_schedule = models.JSONField(default=list, blank=True)
    training_location = models.CharField(max_length=500, blank=True)
    training_staff = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def refresh_ai_account_count(self) -> int:
        """Đếm lại số tài khoản AI đang dùng của khách hàng."""
        self.ai_account_count = self.ai_accounts.filter(status="active").count()
        self.save(update_fields=["ai_account_count"])
        return self.ai_account_count


class TrainingProduct(models.Model):
    TYPE_CHOICES = [
        ("product", "Product"),
        ("service", "Service"),
    ]
    name = models.CharField(max_length=255, unique=True)
    code = models.SlugField(max_length=255, unique=True)
    product_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default="product")
    description = models.TextField(blank=True)
    active = models.BooleanField(default=True)
    display_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["display_order", "name"]

    def save(self, *args, **kwargs):
        if not self.code:
            base = slugify(self.name) or "san-pham"
            candidate = base
            index = 2
            while TrainingProduct.objects.exclude(pk=self.pk).filter(code=candidate).exists():
                candidate = f"{base}-{index}"
                index += 1
            self.code = candidate
        super().save(*args, **kwargs)


class TrainingProductSubscription(models.Model):
    STATUS_CHOICES = [
        ("active", "Active"),
        ("paused", "Paused"),
        ("cancelled", "Cancelled"),
    ]
    partner = models.ForeignKey(TrainingPartner, on_delete=models.CASCADE, related_name="product_subscriptions")
    product = models.ForeignKey(TrainingProduct, on_delete=models.PROTECT, related_name="subscriptions")
    quantity = models.PositiveIntegerField(default=1)
    # starts_at/expires_at = thời gian thực tế; contract_* = thời gian theo hợp đồng.
    starts_at = models.DateField(null=True, blank=True)
    expires_at = models.DateField(null=True, blank=True)
    contract_starts_at = models.DateField(null=True, blank=True)
    contract_expires_at = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="active")
    notes = models.TextField(blank=True)
    expiry_notice_stage = models.PositiveSmallIntegerField(default=0)
    account_manager = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["partner__name", "product__display_order", "product__name"]
        constraints = [
            models.UniqueConstraint(fields=["partner", "product"], name="unique_product_subscription_per_partner"),
        ]

    @property
    def effective_expires_at(self):
        """Hạn dùng để tính còn lại/cảnh báo: thực tế, thiếu thì theo hợp đồng."""
        return self.expires_at or self.contract_expires_at


class SubscriptionSheetOutbox(models.Model):
    """Pending subscription changes waiting to be synced to the Google Sheet."""
    subscription_id = models.CharField(max_length=255)
    action = models.CharField(max_length=20, default="upsert")
    revision = models.UUIDField(default=uuid.uuid4)
    enqueued_at = models.DateTimeField(auto_now=True)
    attempts = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True, default="")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["subscription_id"], name="unique_subscription_sheet_outbox")
        ]

class TrainingProductOpportunity(models.Model):
    STATUS_CHOICES = [("negotiating", "Negotiating"), ("on_hold", "On hold"), ("won", "Won"), ("lost", "Lost")]
    partner = models.ForeignKey(TrainingPartner, on_delete=models.CASCADE, related_name="product_opportunities")
    product = models.ForeignKey(TrainingProduct, on_delete=models.PROTECT, related_name="opportunities")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="negotiating")
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["partner__name", "-updated_at", "-id"]


class TrainingFinanceEntry(models.Model):
    ENTRY_TYPE_CHOICES = [("income", "Income"), ("expense", "Expense")]
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("completed", "Completed"),
        ("overdue", "Overdue"),
        ("cancelled", "Cancelled"),
    ]

    transaction_date = models.DateField()
    entry_type = models.CharField(max_length=20, choices=ENTRY_TYPE_CHOICES)
    category = models.CharField(max_length=150)
    description = models.CharField(max_length=500)
    amount = models.DecimalField(max_digits=16, decimal_places=0)
    partner = models.ForeignKey(
        TrainingPartner,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="finance_entries",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    payment_method = models.CharField(max_length=100, blank=True)
    reference_code = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.EmailField(blank=True)
    updated_by = models.EmailField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-transaction_date", "-id"]


class TrainingClass(models.Model):
    partner = models.ForeignKey(TrainingPartner, on_delete=models.CASCADE, related_name="classes")
    name = models.CharField(max_length=255)
    members = models.CharField(max_length=500, blank=True)
    planned_sessions = models.PositiveIntegerField(default=0)
    training_contents = models.JSONField(default=list, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["partner__name", "name"]
        constraints = [models.UniqueConstraint(fields=["partner", "name"], name="unique_training_class_per_partner")]


class TrainingSession(models.Model):
    STATUS_CHOICES = [("unscheduled", "Unscheduled"), ("planned", "Scheduled"), ("completed", "Completed"), ("cancelled", "Cancelled")]
    SOURCE_INTERNAL = "internal"
    SOURCE_WORK_SCHEDULE = "work_schedule"
    SOURCE_CHOICES = [
        (SOURCE_INTERNAL, "Digital Training"),
        (SOURCE_WORK_SCHEDULE, "Work schedule projection"),
    ]
    title = models.CharField(max_length=255)
    source = models.CharField(max_length=30, choices=SOURCE_CHOICES, default=SOURCE_INTERNAL)
    session_number = models.PositiveIntegerField(null=True, blank=True)
    session_date = models.DateField(null=True, blank=True)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    partner = models.CharField(max_length=255, blank=True)
    partner_ref = models.ForeignKey(TrainingPartner, null=True, blank=True, on_delete=models.SET_NULL, related_name="sessions")
    training_class = models.ForeignKey(TrainingClass, null=True, blank=True, on_delete=models.SET_NULL, related_name="sessions")
    category = models.CharField(max_length=255, blank=True)
    contents = models.JSONField(default=list, blank=True)
    attendees = models.PositiveIntegerField(default=0)
    location = models.CharField(max_length=500, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="planned")
    notes = models.TextField(blank=True)
    staff_name = models.CharField(max_length=255, blank=True)
    instructor_name = models.CharField(max_length=255, blank=True)
    support_staff_name = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["session_date", "start_time", "title"]
        constraints = [
            # A session without a class belongs directly to its customer.  Class
            # sessions use a separate constraint because NULL values do not
            # compare equal in a composite unique constraint on PostgreSQL.
            models.UniqueConstraint(
                fields=["partner_ref", "session_number"],
                condition=Q(training_class__isnull=True, partner_ref__isnull=False),
                name="unique_partner_session_number",
            ),
            models.UniqueConstraint(
                fields=["training_class", "session_number"],
                condition=Q(training_class__isnull=False),
                name="unique_class_session_number",
            ),
        ]


class TrainingLead(models.Model):
    """A prospective customer before a contract is signed."""

    STAGE_CHOICES = [
        ("discussion", "Discussion"),
        ("meeting", "Meeting"),
        ("proposal", "Proposal"),
        ("negotiation", "Negotiation"),
        ("on_hold", "On hold"),
        ("lost", "Lost"),
        ("converted", "Converted"),
    ]

    name = models.CharField(max_length=255)
    lead_type = models.CharField(max_length=100, blank=True)
    address = models.CharField(max_length=500, blank=True)
    representative = models.CharField(max_length=255, blank=True)
    representative_position = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
    interested_products = models.JSONField(default=list, blank=True)
    stage = models.CharField(max_length=30, choices=STAGE_CHOICES, default="discussion")
    notes = models.TextField(blank=True)
    converted_partner = models.OneToOneField(
        TrainingPartner,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="source_lead",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]

class TrainingCustomerMeeting(models.Model):
    """A work-calendar entry for either a new-customer meeting or another activity."""

    SCHEDULE_TYPES = [
        ("meeting", "Customer meeting"),
        ("other", "Other work activity"),
    ]

    title = models.CharField(max_length=255)
    lead = models.ForeignKey(TrainingLead, null=True, blank=True, on_delete=models.SET_NULL, related_name="meetings")
    partner = models.ForeignKey(TrainingPartner, null=True, blank=True, on_delete=models.SET_NULL, related_name="customer_meetings")
    opportunity = models.ForeignKey(TrainingProductOpportunity, null=True, blank=True, on_delete=models.SET_NULL, related_name="meetings")
    schedule_type = models.CharField(max_length=20, choices=SCHEDULE_TYPES, default="meeting")
    activity_type = models.CharField(max_length=100, blank=True)
    customer_type = models.CharField(max_length=100, blank=True)
    representative = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
    meeting_date = models.DateField()
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    location = models.CharField(max_length=500, blank=True)
    content = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=TrainingSession.STATUS_CHOICES, default="planned")
    staff_name = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["meeting_date", "start_time", "title"]

class TrainingMaterial(models.Model):
    title = models.CharField(max_length=255)
    file = models.FileField(upload_to="digital-training/materials/%Y/%m/", blank=True)
    external_url = models.URLField(blank=True)
    file_name = models.CharField(max_length=500, blank=True)
    file_type = models.CharField(max_length=100, blank=True)
    session = models.ForeignKey(TrainingSession, null=True, blank=True, on_delete=models.SET_NULL, related_name="materials")
    partner = models.ForeignKey(TrainingPartner, null=True, blank=True, on_delete=models.SET_NULL, related_name="materials")
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "title"]


class TrainingSurvey(models.Model):
    FORM_TYPES = [("end_session", "End session"), ("end_course", "End course")]
    title = models.CharField(max_length=255)
    form_type = models.CharField(max_length=20, choices=FORM_TYPES)
    session = models.ForeignKey(TrainingSession, null=True, blank=True, on_delete=models.SET_NULL, related_name="surveys")
    partner = models.ForeignKey(TrainingPartner, null=True, blank=True, on_delete=models.SET_NULL, related_name="surveys")
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "title"]


class TrainingQuestionBankSnapshot(models.Model):
    """A server-side index of a shared question bank.

    Question generation must not depend on downloading a Google workbook on every
    request.  The snapshot keeps the parsed questions as well as a compact
    inventory that is displayed to managers before they configure an assessment.
    """

    source_key = models.CharField(max_length=255, unique=True)
    source_url = models.URLField()
    source_name = models.CharField(max_length=500, blank=True)
    inventory = models.JSONField(default=dict, blank=True)
    question_count = models.PositiveIntegerField(default=0)
    synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-synced_at"]


class TrainingAssessment(models.Model):
    STATUS_CHOICES = [
        ("draft", "Bản nháp"),
        ("published", "Đang mở"),
        ("closed", "Đã đóng"),
        ("graded", "Đã chấm bài"),
        ("backup_complete", "Đã hoàn thành sao lưu"),
    ]
    GENERATION_MODE_CHOICES = [("prepared", "Prepared variants"), ("auto_generate", "Auto-generate from import")]
    title = models.CharField(max_length=255)
    session = models.ForeignKey(TrainingSession, null=True, blank=True, on_delete=models.SET_NULL, related_name="assessments")
    partner = models.ForeignKey(TrainingPartner, null=True, blank=True, on_delete=models.SET_NULL, related_name="assessments")
    training_class = models.ForeignKey(TrainingClass, null=True, blank=True, on_delete=models.SET_NULL, related_name="assessments")
    description = models.TextField(blank=True)
    instructions = models.TextField(blank=True)
    duration_minutes = models.PositiveIntegerField(default=30)
    opens_at = models.DateTimeField(null=True, blank=True)
    closes_at = models.DateTimeField(null=True, blank=True)
    attempt_limit = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="draft")
    public_slug = models.SlugField(max_length=255, unique=True, editable=False)
    legacy_public_slugs = models.JSONField(default=list, blank=True)
    questions = models.JSONField(default=list, blank=True)
    generation_mode = models.CharField(
        max_length=30,
        choices=GENERATION_MODE_CHOICES,
        default="prepared",
    )
    generation_config = models.JSONField(default=dict, blank=True)
    source_type = models.CharField(max_length=20, blank=True)
    source_name = models.CharField(max_length=500, blank=True)
    question_bank_url = models.URLField(blank=True)
    output_sheet_url = models.URLField(blank=True)
    drive_folder_id = models.CharField(max_length=255, blank=True)
    storage_config = models.JSONField(default=dict, blank=True)
    audience_group = models.CharField(max_length=255, blank=True)
    participants = models.JSONField(default=list, blank=True)
    max_people_per_variant = models.PositiveIntegerField(default=12)
    sync_status = models.CharField(max_length=20, default="pending")
    sync_error = models.TextField(blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    retention_started_at = models.DateTimeField(null=True, blank=True)
    next_lifecycle_at = models.DateTimeField(null=True, blank=True, db_index=True)
    retention_milestone = models.PositiveSmallIntegerField(default=0)
    graded_at = models.DateTimeField(null=True, blank=True)
    backup_completed_at = models.DateTimeField(null=True, blank=True)
    backup_retry_at = models.DateTimeField(null=True, blank=True, db_index=True)
    backup_manifest = models.JSONField(default=dict, blank=True)
    trashed_at = models.DateTimeField(null=True, blank=True)
    purge_at = models.DateTimeField(null=True, blank=True)
    created_by = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at", "title"]

    def save(self, *args, **kwargs):
        if not self.public_slug:
            label = self.partner.name if self.partner else (
                self.training_class.name if self.training_class else ""
            )
            label = label.replace("Đ", "D").replace("đ", "d")
            candidate = slugify(f"{label} Bai kiem tra cuoi khoa tap huan") or f"training-assessment-{uuid.uuid4().hex[:8]}"
            if TrainingAssessment.objects.filter(public_slug=candidate).exclude(pk=self.pk).exists():
                base = candidate
                suffix = 2
                while TrainingAssessment.objects.filter(public_slug=candidate).exclude(pk=self.pk).exists():
                    candidate = f"{base}-{suffix}"
                    suffix += 1
            self.public_slug = candidate
        super().save(*args, **kwargs)


class TrainingAssessmentAttempt(models.Model):
    STATUS_CHOICES = [("in_progress", "In progress"), ("submitted", "Submitted"), ("timed_out", "Timed out")]
    assessment = models.ForeignKey(TrainingAssessment, on_delete=models.CASCADE, related_name="attempts")
    access_token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    respondent_name = models.CharField(max_length=255)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    organization = models.CharField(max_length=255, blank=True)
    position = models.CharField(max_length=255, blank=True)
    participant_code = models.CharField(max_length=100, blank=True)
    drive_folder_id = models.CharField(max_length=255, blank=True)
    variant = models.CharField(max_length=100)
    answers = models.JSONField(default=dict, blank=True)
    progress = models.JSONField(default=dict, blank=True)
    score = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    max_score = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    auto_graded_points = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    manual_grading_required = models.BooleanField(default=False)
    practical_score = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    grading = models.JSONField(default=dict, blank=True)
    grading_notes = models.JSONField(default=list, blank=True)
    sync_status = models.CharField(max_length=20, default="pending")
    sync_error = models.TextField(blank=True)
    synced_at = models.DateTimeField(null=True, blank=True)
    purge_after = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="in_progress")
    started_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    submitted_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-started_at"]


class TrainingAssessmentUpload(models.Model):
    attempt = models.ForeignKey(TrainingAssessmentAttempt, on_delete=models.CASCADE, related_name="uploads")
    question_id = models.CharField(max_length=100)
    file = models.FileField(upload_to="digital-training/assessment-answers/%Y/%m/", blank=True)
    drive_file_id = models.CharField(max_length=255, blank=True)
    drive_url = models.URLField(blank=True)
    sync_status = models.CharField(max_length=20, default="local")
    original_name = models.CharField(max_length=500)
    content_type = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class TrainingPartnerAiAccount(models.Model):
    STATUS_CHOICES = [
        ("active", "Đang dùng"),
        ("expired", "Hết hạn"),
        ("locked", "Tạm khóa"),
        ("revoked", "Đã thu hồi"),
    ]
    PLATFORM_CHOICES = [
        ("chatgpt_plus", "ChatGPT Plus"),
        ("chatgpt_team", "ChatGPT Team"),
        ("claude_pro", "Claude Pro"),
        ("gemini_advanced", "Gemini Advanced"),
        ("canva_pro", "Canva Pro"),
        ("midjourney", "Midjourney"),
        ("copilot", "Microsoft Copilot"),
        ("shared_ai", "AI Dùng chung FT"),
        ("other", "Khác"),
    ]
    partner = models.ForeignKey(TrainingPartner, on_delete=models.CASCADE, related_name="ai_accounts")
    subscription = models.ForeignKey(
        TrainingProductSubscription,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="ai_accounts",
    )
    platform = models.CharField(max_length=50, choices=PLATFORM_CHOICES, default="chatgpt_plus")
    account_username = models.CharField(max_length=255)
    account_password = models.CharField(max_length=255)
    assigned_to = models.CharField(max_length=255, blank=True)
    starts_at = models.DateField(null=True, blank=True)
    expires_at = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="active")
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["partner__name", "account_username"]
