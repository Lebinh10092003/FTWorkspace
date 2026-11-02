from django.db import models
from django.utils import timezone


ROOM_DIRECTOR = 'director'
ROOM_TECH = 'tech'
ROOM_EXAM = 'exam'
ROOM_ACCOUNTING = 'accounting'
ROOM_COMMON = 'common'

ROOM_CHOICES = [
    (ROOM_DIRECTOR, 'Phòng Giám đốc'),
    (ROOM_TECH, 'Phòng Công nghệ'),
    (ROOM_EXAM, 'Phòng Khảo thí'),
    (ROOM_ACCOUNTING, 'Phòng Kế toán'),
    (ROOM_COMMON, 'Phòng khách chung'),
]

ROOM_CAPACITIES = {
    ROOM_DIRECTOR: 1,
    ROOM_TECH: 4,
    ROOM_EXAM: 3,
    ROOM_ACCOUNTING: 2,
    ROOM_COMMON: None,
}

ONLINE_TIMEOUT_SECONDS = 180  # 3 phút
HEARTBEAT_MIN_WRITE_INTERVAL_SECONDS = 30  # Giới hạn tần suất ghi SQLite


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
    show_presence = models.BooleanField(default=True)
    avatar_config = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Hiện diện văn phòng'
        verbose_name_plural = 'Hiện diện văn phòng'

    def __str__(self):
        return f'{self.user_id} (seen: {self.last_seen}, visible: {self.show_presence})'

    def is_online(self, now=None) -> bool:
        if not self.last_seen:
            return False
        current_time = now or timezone.now()
        delta = (current_time - self.last_seen).total_seconds()
        return 0 <= delta <= ONLINE_TIMEOUT_SECONDS


def suggest_seat_for_user(user) -> dict:
    """Tận dụng UserProfile.department/job_title/manager/role để gợi ý khu mặc định."""
    dept_name = ''
    if getattr(user, 'department', None) and getattr(user.department, 'name', None):
        dept_name = user.department.name.lower()
    
    title_name = ''
    if getattr(user, 'job_title', None) and getattr(user.job_title, 'name', None):
        title_name = user.job_title.name.lower()
    
    role = str(getattr(user, 'role', '') or '').upper()

    is_head = any(keyword in title_name for keyword in ['trưởng', 'lead', 'head', 'chủ nhiệm', 'giám đốc', 'director'])

    # Ban giám đốc
    if role == 'ADMIN' or any(keyword in title_name or keyword in dept_name for keyword in ['giám đốc', 'ban giám đốc', 'director', 'ceo']):
        return {
            'room': ROOM_DIRECTOR,
            'is_head': True,
            'seat_index': 1,
        }

    # Công nghệ
    if any(keyword in dept_name or keyword in title_name for keyword in ['công nghệ', 'kỹ thuật', 'tech', 'it', 'phát triển', 'lập trình']):
        return {
            'room': ROOM_TECH,
            'is_head': is_head,
            'seat_index': 1 if is_head else None,
        }

    # Khảo thí
    if any(keyword in dept_name or keyword in title_name for keyword in ['khảo thí', 'đề thi', 'exam', 'testing']):
        return {
            'room': ROOM_EXAM,
            'is_head': is_head,
            'seat_index': 1 if is_head else None,
        }

    # Kế toán
    if any(keyword in dept_name or keyword in title_name for keyword in ['kế toán', 'tài chính', 'accounting', 'finance']):
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
