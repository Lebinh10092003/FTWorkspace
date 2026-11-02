import csv
import os
from django.core.management.base import BaseCommand, CommandError

from authentication.models import UserProfile
from office.models import (
    ROOM_CAPACITIES,
    ROOM_CHOICES,
    ROOM_COMMON,
    OfficeSeat,
)


VALID_ROOMS = {choice[0] for choice in ROOM_CHOICES}


class Command(BaseCommand):
    help = 'Nạp chỗ ngồi nhân sự từ tệp CSV (email,room,seat_index,is_head)'

    def add_arguments(self, parser):
        parser.add_argument(
            '--file',
            type=str,
            required=True,
            help='Đường dẫn tệp CSV chứa phân bổ chỗ ngồi',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Chỉ kiểm tra tính hợp lệ mà không lưu vào cơ sở dữ liệu',
        )

    def handle(self, *args, **options):
        file_path = options['file']
        dry_run = options['dry_run']

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
                        errors.append(f'Dòng {row_idx} ({email}): phòng không hợp lệ "{room}". Cho phép: {list(VALID_ROOMS)}')
                        error_count += 1
                        continue

                    seat_index = None
                    if seat_idx_raw:
                        try:
                            seat_index = int(seat_idx_raw)
                            if seat_index <= 0:
                                raise ValueError()
                        except ValueError:
                            errors.append(f'Dòng {row_idx} ({email}): seat_index "{seat_idx_raw}" phải là số nguyên dương.')
                            error_count += 1
                            continue

                    is_head = is_head_raw in {'1', 'true', 'yes', 't'}

                    # Kiểm tra giới hạn phòng
                    max_capacity = ROOM_CAPACITIES.get(room)
                    if max_capacity and seat_index and seat_index > max_capacity:
                        errors.append(f'Dòng {row_idx} ({email}): phòng {room} chỉ có tối đa {max_capacity} chỗ.')
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
