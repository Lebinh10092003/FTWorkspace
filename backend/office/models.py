import unicodedata
from django.db import models
from django.utils import timezone


ROOM_DIRECTOR = 'director'
ROOM_TECH = 'tech'
ROOM_EXAM = 'exam'
ROOM_MEDIA = 'media'
ROOM_ACCOUNTING = 'accounting'
ROOM_COMMON = 'common'

ROOM_CHOICES = [
    (ROOM_DIRECTOR, 'Phòng Giám đốc'),
    (ROOM_TECH, 'Phòng Công nghệ'),
    (ROOM_EXAM, 'Phòng Khảo thí'),
    (ROOM_MEDIA, 'Phòng Truyền thông'),
    (ROOM_ACCOUNTING, 'Phòng Kế toán & HR'),
    (ROOM_COMMON, 'Phòng chung'),
]

ROOM_CAPACITIES = {
    ROOM_DIRECTOR: 1,
    ROOM_TECH: 4,
    ROOM_EXAM: 8,
    ROOM_MEDIA: 6,
    ROOM_ACCOUNTING: 2,
    ROOM_COMMON: None,
}

ONLINE_TIMEOUT_SECONDS = 180  # 3 phút
HEARTBEAT_MIN_WRITE_INTERVAL_SECONDS = 30  # Giới hạn tần suất ghi SQLite

STATUS_WORKING = 'working'
STATUS_IDLE = 'idle'
STATUS_HOME = 'home'
STATUS_OFFLINE = 'offline'

WORK_STATUS_CHOICES = [
    (STATUS_WORKING, 'Đang làm việc'),
    (STATUS_IDLE, 'Rảnh'),
    (STATUS_HOME, 'Về nhà'),
]


def remove_vietnamese_accents(text: str) -> str:
    """Chuẩn hóa chuỗi tiếng Việt về dạng không dấu, viết thường."""
    if not text:
        return ''
    normalized = unicodedata.normalize('NFKD', str(text))
    stripped = ''.join(ch for ch in normalized if not unicodedata.combining(ch))
    return stripped.replace('đ', 'd').replace('Đ', 'D').lower().strip()


def is_director_account(user) -> bool:
    """Kiểm tra tài khoản Giám đốc (Lê Đức Thuận)."""
    raw_name = getattr(user, 'name', '') or ''
    norm_name = remove_vietnamese_accents(raw_name)
    return 'le duc thuan' in norm_name or 'lê đức thuận' in raw_name.lower()


class OfficeSeat(models.Model):
    user = models.OneToOneField(
        'authentication.UserProfile',
        on_delete=models.CASCADE,
        related_name='office_seat',
        primary_key=True,
    )
    room = models.CharField(max_length=32, choices=ROOM_CHOICES, default=ROOM_COMMON)
    seat_index = models.PositiveSmallIntegerField(null=True, blank=True, default=None)
    is_head = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['room', 'seat_index', 'user_id']
        verbose_name = 'Chỗ ngồi văn phòng'
        verbose_name_plural = 'Chỗ ngồi văn phòng'

    def __str__(self):
        head_str = ' (Trưởng phòng)' if self.is_head else ''
        seat_str = f' #{self.seat_index}' if self.seat_index is not None else ''
        return f'{self.user_id} - {self.get_room_display()}{seat_str}{head_str}'


class OfficePresence(models.Model):
    user = models.OneToOneField(
        'authentication.UserProfile',
        on_delete=models.CASCADE,
        related_name='office_presence',
        primary_key=True,
    )
    last_seen = models.DateTimeField(null=True, blank=True)
    is_idle = models.BooleanField(default=False)
    work_status = models.CharField(
        max_length=20,
        choices=WORK_STATUS_CHOICES,
        default=STATUS_WORKING,
    )
    show_presence = models.BooleanField(default=True)
    avatar_config = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Hiện diện văn phòng'
        verbose_name_plural = 'Hiện diện văn phòng'

    def __str__(self):
        return f'{self.user_id} (seen: {self.last_seen}, status: {self.work_status}, idle: {self.is_idle}, visible: {self.show_presence})'

    def is_online(self, now=None) -> bool:
        if not self.last_seen:
            return False
        current_time = now or timezone.now()
        delta = (current_time - self.last_seen).total_seconds()
        return 0 <= delta <= ONLINE_TIMEOUT_SECONDS

    def get_status(self, now=None, is_me=False) -> str:
        """
        Tính trạng thái của người dùng:
        - 'offline': show_presence tắt (với người khác)
        - 'home': work_status == 'home'
        - 'idle': work_status == 'idle' hoặc (work_status == 'working' và is_idle == True)
        - 'working': đang làm việc
        """
        if not is_me and not self.show_presence:
            return STATUS_OFFLINE
        if self.work_status == STATUS_HOME:
            return STATUS_HOME
        if self.work_status == STATUS_IDLE or (self.work_status == STATUS_WORKING and self.is_idle):
            return STATUS_IDLE
        return STATUS_WORKING


def suggest_seat_for_user(user) -> dict:
    """Tận dụng UserProfile.name/department/job_title/role để gợi ý khu mặc định."""
    if is_director_account(user):
        return {
            'room': ROOM_DIRECTOR,
            'is_head': True,
            'seat_index': 1,
        }

    dept_name = ''
    if getattr(user, 'department', None) and getattr(user.department, 'name', None):
        dept_name = user.department.name.lower()

    title_name = ''
    if getattr(user, 'job_title', None) and getattr(user.job_title, 'name', None):
        title_name = user.job_title.name.lower()

    role = str(getattr(user, 'role', '') or '').upper()
    combined = f'{dept_name} {title_name}'.strip()
    combined_norm = remove_vietnamese_accents(combined)

    is_head = any(keyword in title_name for keyword in ['trưởng', 'lead', 'head', 'chủ nhiệm', 'giám đốc', 'director'])

    # Ban giám đốc
    if role == 'ADMIN' or any(keyword in combined or keyword in combined_norm for keyword in ['giám đốc', 'giam doc', 'ban giám đốc', 'director', 'ceo']):
        return {
            'room': ROOM_DIRECTOR,
            'is_head': True,
            'seat_index': 1,
        }

    email_lower = (getattr(user, 'email', '') or '').strip().lower()

    # Robot Trợ lý AI thường trực phòng chung
    if 'assistant' in email_lower or any(k in combined or k in combined_norm for k in ['assistant', 'trợ lý', 'tro ly', 'hermes']):
        return {
            'room': ROOM_COMMON,
            'is_head': True,
            'seat_index': 0,
        }

    # 5 Bot AI Khảo thí (bot.fb.*)
    if 'bot.fb.' in email_lower or (role == 'BOT' and any(k in combined or k in combined_norm for k in ['facebook', 'trend', 'material', 'writer', 'reviewer', 'publisher', 'đăng bài', 'soạn thảo'])):
        return {
            'room': ROOM_EXAM,
            'is_head': False,
            'seat_index': None,
        }

    # Truyền thông (tách riêng với Khảo thí)
    if any(keyword in combined or keyword in combined_norm for keyword in ['truyền thông', 'truyen thong', 'media', 'marketing', 'social', 'content']):
        return {
            'room': ROOM_MEDIA,
            'is_head': is_head,
            'seat_index': 1 if is_head else None,
        }

    # Công nghệ
    if any(keyword in combined or keyword in combined_norm for keyword in ['công nghệ', 'cong nghe', 'kỹ thuật', 'ky thuat', 'tech', 'it', 'phát triển', 'phat trien', 'lập trình', 'lap trinh']):
        return {
            'room': ROOM_TECH,
            'is_head': is_head,
            'seat_index': 1 if is_head else None,
        }

    # Khảo thí
    if any(keyword in combined or keyword in combined_norm for keyword in ['khảo thí', 'khao thi', 'đề thi', 'de thi', 'sản xuất đề', 'san xuat de', 'exam', 'testing']):
        return {
            'room': ROOM_EXAM,
            'is_head': is_head,
            'seat_index': 1 if is_head else None,
        }

    # Kế toán & HR (bỏ phòng HR riêng)
    if any(keyword in combined or keyword in combined_norm for keyword in ['kế toán', 'ke toan', 'tài chính', 'tai chinh', 'accounting', 'finance', 'hr', 'nhân sự', 'nhan su']):
        return {
            'room': ROOM_ACCOUNTING,
            'is_head': is_head,
            'seat_index': 1 if is_head else None,
        }

    # Mặc định phòng chung
    return {
        'room': ROOM_COMMON,
        'is_head': False,
        'seat_index': None,
    }
