import collections
import csv
import os
from django.core.management.base import BaseCommand, CommandError

from authentication.models import UserProfile
from office.models import (
    ROOM_ACCOUNTING,
    ROOM_CAPACITIES,
    ROOM_CHOICES,
    ROOM_COMMON,
    ROOM_DIRECTOR,
    ROOM_EXAM,
    ROOM_MEDIA,
    ROOM_TECH,
    OfficeSeat,
    is_director_account,
    remove_vietnamese_accents,
    suggest_seat_for_user,
)


VALID_ROOMS = {choice[0] for choice in ROOM_CHOICES}

ROOM_ORDER = [
    ROOM_DIRECTOR,
    ROOM_TECH,
    ROOM_EXAM,
    ROOM_MEDIA,
    ROOM_ACCOUNTING,
    ROOM_COMMON,
]

ROOM_SEED_DESCRIPTIONS = {
    ROOM_DIRECTOR: 'Phòng Giám đốc (1 ghế)',
    ROOM_TECH: 'Phòng Công nghệ',
    ROOM_EXAM: 'Phòng Khảo thí',
    ROOM_MEDIA: 'Phòng Truyền thông (6 ghế)',
    ROOM_ACCOUNTING: 'Phòng Kế toán & HR (2 ghế)',
    ROOM_COMMON: 'Phòng chung',
}


def _classify_user_for_seed(user):
    """Xác định phòng mục tiêu và vai trò trưởng phòng cho một nhân sự ACTIVE."""
    if is_director_account(user):
        return {
            'room': ROOM_DIRECTOR,
            'seat_index': 1,
            'is_head': True,
            'priority': 0,
        }

    is_bot = bool(
        getattr(user, 'role', '') == 'BOT'
        or (user.email and user.email.strip().lower().startswith('bot.'))
    )
    job_title_name = user.job_title.name if getattr(user, 'job_title', None) else ''
    bot_text = f"{user.name or ''} {getattr(user, 'role', '') or ''} {job_title_name} {user.email or ''}".lower()
    bot_norm = remove_vietnamese_accents(bot_text)

    email_lower = (user.email or '').strip().lower()
    is_assistant = bool(
        is_bot and any(k in bot_text or k in bot_norm for k in ['assistant', 'trợ lý', 'tro ly', 'hermes'])
    )
    if is_assistant:
        return {
            'room': ROOM_COMMON,
            'seat_index': None,
            'is_head': False,
            'priority': 3,
        }

    is_media_bot = bool(
        is_bot
        and (
            email_lower.startswith('bot.fb.')
            or 'bot.fb.' in email_lower
            or any(
                k in bot_text or k in bot_norm
                for k in [
                    'bot.fb.',
                    'kiểm duyệt', 'kiem duyet',
                    'nội dung', 'noi dung',
                    'săn tin', 'san tin',
                    'tư liệu', 'tu lieu',
                    'xu hướng', 'xu huong',
                    'truyền thông', 'truyen thong',
                    'đăng bài', 'dang bai',
                    'soạn thảo', 'soan thao',
                    'social', 'media', 'facebook', 'zalo',
                ]
            )
        )
    )
    if is_media_bot:
        return {
            'room': ROOM_MEDIA,
            'seat_index': None,
            'is_head': False,
            'priority': 2,
        }

    suggested = suggest_seat_for_user(user)
    room = suggested.get('room', ROOM_COMMON)
    is_head = bool(suggested.get('is_head', False))
    seat_index = suggested.get('seat_index')
    priority = 1 if is_head else 2
    return {
        'room': room,
        'seat_index': seat_index,
        'is_head': is_head,
        'priority': priority,
    }


class Command(BaseCommand):
    help = (
        'Nạp chỗ ngồi nhân sự từ tệp CSV (email,room,seat_index,is_head) '
        'hoặc tự động seed cho 6 phòng: director (1), tech, exam, media (6), accounting (2), common.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--file',
            type=str,
            required=False,
            default=None,
            help='Đường dẫn tệp CSV chứa phân bổ chỗ ngồi (nếu bỏ trống sẽ tự động seed cho nhân sự ACTIVE)',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Chỉ kiểm tra tính hợp lệ mà không lưu vào cơ sở dữ liệu',
        )
        parser.add_argument(
            '--only-missing',
            action='store_true',
            help='(Chế độ tự động) Chỉ seed cho nhân sự chưa có bản ghi OfficeSeat',
        )

    def handle(self, *args, **options):
        file_path = options.get('file')
        dry_run = options.get('dry_run', False)
        only_missing = options.get('only_missing', False)

        if file_path:
            self._handle_csv(file_path, dry_run=dry_run)
        else:
            self._handle_auto_seed(dry_run=dry_run, only_missing=only_missing)

    def _handle_csv(self, file_path, dry_run=False):
        if not os.path.exists(file_path):
            raise CommandError(f'Tệp không tồn tại: {file_path}')

        success_count = 0
        error_count = 0
        errors = []

        try:
            with open(file_path, mode='r', encoding='utf-8-sig') as f:
                reader = csv.DictReader(f)

                # Kiểm tra các cột bắt buộc
                if not reader.fieldnames:
                    raise CommandError('Tệp CSV rỗng hoặc không có tiêu đề.')

                fieldnames = [c.strip().lower() for c in reader.fieldnames if c]
                if 'email' not in fieldnames or 'room' not in fieldnames:
                    raise CommandError("Tệp CSV thiếu cột bắt buộc 'email' hoặc 'room'.")

                for row_idx, raw_row in enumerate(reader, start=2):
                    # Chuẩn hoá key
                    row = {k.strip().lower(): (v.strip() if v else '') for k, v in raw_row.items() if k}
                    email = row.get('email', '').lower()
                    room = row.get('room', '').lower()
                    seat_idx_raw = row.get('seat_index', '')
                    is_head_raw = row.get('is_head', '').lower()

                    if not email:
                        errors.append(f'Dòng {row_idx}: email trống')
                        error_count += 1
                        continue

                    if not room or room not in VALID_ROOMS:
                        errors.append(
                            f'Dòng {row_idx} ({email}): phòng không hợp lệ "{room}". Cho phép: {list(VALID_ROOMS)}'
                        )
                        error_count += 1
                        continue

                    seat_index = None
                    if seat_idx_raw:
                        try:
                            seat_index = int(seat_idx_raw)
                            if seat_index <= 0:
                                raise ValueError()
                        except ValueError:
                            errors.append(
                                f'Dòng {row_idx} ({email}): seat_index "{seat_idx_raw}" phải là số nguyên dương.'
                            )
                            error_count += 1
                            continue

                    is_head = is_head_raw in {'1', 'true', 'yes', 't'}

                    # Kiểm tra giới hạn phòng
                    max_capacity = ROOM_CAPACITIES.get(room)
                    if max_capacity and seat_index and seat_index > max_capacity:
                        errors.append(
                            f'Dòng {row_idx} ({email}): phòng {room} chỉ có tối đa {max_capacity} chỗ.'
                        )
                        error_count += 1
                        continue

                    # Kiểm tra user có tồn tại trong hệ thống
                    try:
                        user = UserProfile.objects.get(email__iexact=email)
                    except UserProfile.DoesNotExist:
                        errors.append(f'Dòng {row_idx}: không tìm thấy UserProfile với email {email}')
                        error_count += 1
                        continue

                    if not dry_run:
                        seat, _ = OfficeSeat.objects.get_or_create(user=user)
                        seat.room = room
                        seat.seat_index = seat_index if room != ROOM_COMMON else None
                        seat.is_head = is_head
                        seat.save()

                    success_count += 1

        except Exception as e:
            if isinstance(e, CommandError):
                raise
            raise CommandError(f'Lỗi khi đọc tệp CSV: {e}')

        self.stdout.write(self.style.SUCCESS(
            f'{"[DRY RUN] " if dry_run else ""}Xử lý hoàn tất: {success_count} thành công, {error_count} lỗi.'
        ))

        if errors:
            self.stdout.write(self.style.WARNING('Chi tiết các dòng bị lỗi/bỏ qua:'))
            for err in errors:
                self.stdout.write(f'  - {err}')

    def _handle_auto_seed(self, dry_run=False, only_missing=False):
        active_users = list(
            UserProfile.objects.filter(employment_status='ACTIVE')
            .select_related('department', 'job_title', 'office_seat')
            .order_by('id')
        )

        used_seats = collections.defaultdict(set)
        room_counts = collections.Counter()
        targets = []

        for user in active_users:
            existing_seat = getattr(user, 'office_seat', None)
            if only_missing and existing_seat is not None:
                if existing_seat.room != ROOM_COMMON and existing_seat.seat_index:
                    used_seats[existing_seat.room].add(existing_seat.seat_index)
                room_counts[existing_seat.room] += 1
                continue

            info = _classify_user_for_seed(user)
            targets.append((info['priority'], user.id, user, info))

        targets.sort(key=lambda item: (item[0], item[1]))

        seeded_count = 0
        for _, _, user, info in targets:
            room = info['room']
            preferred_seat = info['seat_index']
            is_head = info['is_head']

            if room == ROOM_COMMON:
                assigned_room = ROOM_COMMON
                assigned_seat_index = None
                assigned_is_head = False
            else:
                max_capacity = ROOM_CAPACITIES.get(room)
                candidate = None
                if (
                    preferred_seat is not None
                    and preferred_seat > 0
                    and preferred_seat not in used_seats[room]
                    and (max_capacity is None or preferred_seat <= max_capacity)
                ):
                    candidate = preferred_seat
                else:
                    idx = 1
                    while idx in used_seats[room]:
                        idx += 1
                    if max_capacity is None or idx <= max_capacity:
                        candidate = idx

                if candidate is None:
                    # Vượt quá sức chứa của phòng -> chuyển sang phòng chung
                    assigned_room = ROOM_COMMON
                    assigned_seat_index = None
                    assigned_is_head = False
                else:
                    used_seats[room].add(candidate)
                    assigned_room = room
                    assigned_seat_index = candidate
                    assigned_is_head = is_head

            if not dry_run:
                seat, _ = OfficeSeat.objects.get_or_create(user=user)
                seat.room = assigned_room
                seat.seat_index = assigned_seat_index
                seat.is_head = assigned_is_head
                seat.save()

            room_counts[assigned_room] += 1
            seeded_count += 1

        summary_parts = []
        for r in ROOM_ORDER:
            cap = ROOM_CAPACITIES.get(r)
            cap_str = f'/{cap}' if cap is not None else ''
            summary_parts.append(f'{ROOM_SEED_DESCRIPTIONS[r]}: {room_counts[r]}{cap_str}')

        self.stdout.write(self.style.SUCCESS(
            f'{"[DRY RUN] " if dry_run else ""}Đã seed tự động {seeded_count} nhân sự. '
            + ' | '.join(summary_parts)
        ))
