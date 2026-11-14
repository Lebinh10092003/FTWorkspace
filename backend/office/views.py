import collections
import hashlib
import logging
import re
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.models import UserProfile
from authentication.permissions import IsAdmin, IsWorkspaceAuthenticated
from .models import (
    HEARTBEAT_MIN_WRITE_INTERVAL_SECONDS,
    ROOM_ACCOUNTING,
    ROOM_COMMON,
    ROOM_DIRECTOR,
    ROOM_EXAM,
    ROOM_MEDIA,
    ROOM_TECH,
    STATUS_HOME,
    STATUS_IDLE,
    STATUS_OFFLINE,
    STATUS_WORKING,
    OfficePresence,
    OfficeSeat,
    is_director_account,
    remove_vietnamese_accents,
    suggest_seat_for_user,
)
from .serializers import AvatarConfigSerializer, OfficeSeatUpdateSerializer

logger = logging.getLogger(__name__)

VALID_WORK_STATUSES = (STATUS_WORKING, STATUS_IDLE, STATUS_HOME)

EXACT_FEMALE_TOKENS = {
    'thị', 'hoa', 'lan', 'linh', 'vân', 'hương', 'trang', 'thảo', 'ngọc',
    'hà', 'mai', 'phương', 'quỳnh', 'nga', 'huyền', 'yến', 'nhung',
    'hằng', 'thúy', 'tuyết', 'diệp', 'nhi', 'vy', 'my', 'uyên', 'tâm',
    'chi', 'trinh', 'oanh', 'hạnh', 'liên', 'đào', 'nguyệt', 'kiều', 'diễm',
    'loan', 'lệ', 'thu', 'xuân', 'hồng',
}

UNACCENTED_FEMALE_TOKENS = {
    'thi', 'hoa', 'lan', 'linh', 'huong', 'trang', 'thao', 'quynh', 'nga',
    'huyen', 'yen', 'nhung', 'thuy', 'tuyet', 'diep', 'nhi', 'vy', 'uyen',
    'trinh', 'oanh', 'hanh', 'lien', 'nguyet', 'kieu', 'diem', 'loan',
    'ha', 'phuong', 'mai', 'ngoc', 'hang', 'chi', 'tam',
}

EXACT_MALE_TOKENS = {
    'bình', 'dũng', 'phong', 'văn', 'tuấn', 'nam', 'hải', 'hùng', 'minh', 'long',
    'đức', 'thắng', 'hoàng', 'huy', 'sơn', 'tùng', 'khánh', 'bách', 'trung',
    'kiên', 'quân', 'tiến', 'thành', 'bảo', 'trọng', 'khoa', 'toàn', 'nghĩa',
}

UNACCENTED_MALE_TOKENS = {
    'binh', 'dung', 'phong', 'van', 'tuan', 'nam', 'hai', 'hung', 'minh', 'long',
    'duc', 'thang', 'hoang', 'huy', 'son', 'tung', 'khanh', 'bach', 'trung',
    'kien', 'quan', 'tien', 'thanh', 'bao', 'trong', 'khoa', 'toan', 'nghia',
}


def guess_gender_from_vietnamese_name(name: str) -> str:
    """Suy đoán giới tính ('male' | 'female') từ tên tiếng Việt.

    Ưu tiên tuyệt đối:
    - Nếu tên chứa đệm hoặc tên nam (Bình, Dũng, Phong, Văn, Tuấn...): male
    - Nếu có 'thị' hoặc tên nữ: female
    - Mặc định: male.
    """
    if not name:
        return 'male'
    clean_name = str(name).strip().lower()
    words = re.findall(r'[^\W\d_]+', clean_name, flags=re.UNICODE)
    if not words:
        return 'male'

    # Kiểm tra tên nam cố định (Dũng, Phong, Bình, Văn...)
    norm_name = remove_vietnamese_accents(clean_name)
    if any(k in words for k in EXACT_MALE_TOKENS) or \
       any(k in norm_name for k in ['binhlv', 'dungpv', 'phongnt', 'mr dung', 'le van binh', 'phong nt']):
        return 'male'

    # Kiểm tra tên đệm + tên (bỏ họ để tránh nhầm họ Đào, Hà, Mai, Hồng...)
    check_words = set(words[1:]) if len(words) > 1 else set(words)
    norm_words = {remove_vietnamese_accents(w) for w in check_words}

    # Nếu từ cuối cùng (tên gọi chính) là nam: male
    last_word = words[-1]
    last_norm = remove_vietnamese_accents(last_word)
    if last_word in EXACT_MALE_TOKENS or last_norm in UNACCENTED_MALE_TOKENS:
        return 'male'

    # Kiểm tra đệm 'thị' -> female; đệm 'văn' -> male
    if 'thị' in check_words or 'thi' in norm_words:
        return 'female'
    if 'văn' in check_words:
        return 'male'

    if check_words & EXACT_FEMALE_TOKENS:
        return 'female'
    if norm_words & UNACCENTED_FEMALE_TOKENS:
        return 'female'
    return 'male'


class HeartbeatView(APIView):
    """
    POST /api/office/heartbeat/
    Cập nhật last_seen của người dùng đang đăng nhập.
    Hỗ trợ gửi trạng thái: { idle: boolean, status?: 'working' | 'idle' | 'home' }.
    Web gọi mỗi ~60 giây khi tab đang mở hoặc ngay khi đổi trạng thái làm việc/rảnh/về nhà.
    Có rate limit ghi để bảo vệ SQLite (không ghi nếu lần cuối < 30s và trạng thái không đổi).
    """
    permission_classes = [IsWorkspaceAuthenticated]

    def post(self, request):
        user = request.user
        now = timezone.now()
        data = request.data if isinstance(request.data, dict) else {}

        raw_status = data.get('status')
        if raw_status is not None and raw_status not in VALID_WORK_STATUSES:
            return Response(
                {'error': "Trạng thái không hợp lệ. Cho phép: 'working', 'idle', 'home'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        has_idle = 'idle' in data and data.get('idle') is not None
        raw_idle = bool(data.get('idle')) if has_idle else False

        presence, created = OfficePresence.objects.get_or_create(
            user=user,
            defaults={
                'last_seen': now,
                'show_presence': True,
                'is_idle': (raw_status == STATUS_IDLE) if raw_status is not None else raw_idle,
                'work_status': raw_status if raw_status is not None else (STATUS_IDLE if raw_idle else STATUS_WORKING),
            },
        )

        rate_limited = False
        if not created:
            old_work_status = presence.work_status
            old_is_idle = presence.is_idle

            if raw_status is not None:
                next_work_status = raw_status
                next_is_idle = (raw_status == STATUS_IDLE)
            elif has_idle:
                next_is_idle = raw_idle
                if old_work_status == STATUS_HOME:
                    next_work_status = STATUS_HOME
                elif next_is_idle:
                    next_work_status = STATUS_IDLE
                else:
                    next_work_status = STATUS_WORKING
            else:
                next_is_idle = False if old_work_status != STATUS_IDLE else old_is_idle
                next_work_status = old_work_status

            state_changed = (next_work_status != old_work_status) or (next_is_idle != old_is_idle)

            if not state_changed and presence.last_seen and (now - presence.last_seen).total_seconds() < HEARTBEAT_MIN_WRITE_INTERVAL_SECONDS:
                rate_limited = True
            else:
                presence.last_seen = now
                presence.work_status = next_work_status
                presence.is_idle = next_is_idle
                presence.save(update_fields=['last_seen', 'work_status', 'is_idle', 'updated_at'])

        return Response({
            'status': 'ok',
            'online': presence.work_status != STATUS_HOME,
            'work_status': presence.work_status,
            'is_idle': presence.is_idle,
            'user_status': presence.get_status(now, is_me=True),
            'last_seen': presence.last_seen.isoformat() if presence.last_seen else now.isoformat(),
            'rate_limited': rate_limited,
        })


OfficeHeartbeatView = HeartbeatView


class OfficeStatusView(APIView):
    """
    GET /api/office/status/
    POST /api/office/status/
    Xem hoặc cập nhật trạng thái làm việc: { status: 'working' | 'idle' | 'home' }.
    """
    permission_classes = [IsWorkspaceAuthenticated]

    def get(self, request):
        user = request.user
        presence, _ = OfficePresence.objects.get_or_create(
            user=user,
            defaults={'show_presence': True, 'work_status': STATUS_WORKING, 'is_idle': False},
        )
        return Response({
            'status': 'ok',
            'work_status': presence.work_status,
            'is_idle': presence.is_idle,
            'online': presence.work_status != STATUS_HOME,
            'user_status': presence.get_status(timezone.now(), is_me=True),
        })

    def post(self, request):
        user = request.user
        now = timezone.now()
        data = request.data if isinstance(request.data, dict) else {}
        target_status = data.get('status')
        if target_status not in VALID_WORK_STATUSES:
            return Response(
                {'error': "Trạng thái không hợp lệ. Cho phép: 'working', 'idle', 'home'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        presence, _ = OfficePresence.objects.get_or_create(
            user=user,
            defaults={'last_seen': now, 'show_presence': True},
        )
        presence.work_status = target_status
        presence.is_idle = (target_status == STATUS_IDLE)
        presence.last_seen = now
        presence.save(update_fields=['work_status', 'is_idle', 'last_seen', 'updated_at'])

        return Response({
            'status': 'ok',
            'work_status': presence.work_status,
            'is_idle': presence.is_idle,
            'online': presence.work_status != STATUS_HOME,
            'user_status': presence.get_status(now, is_me=True),
            'last_seen': presence.last_seen.isoformat(),
        })


class OfficeRosterView(APIView):
    """
    GET /api/office/roster/
    Trả danh sách nhân viên an toàn cho mọi người dùng đã đăng nhập.
    Mặc định toàn bộ nhân sự ACTIVE đều online trừ khi work_status == 'home'.
    """
    permission_classes = [IsWorkspaceAuthenticated]

    def get(self, request):
        now = timezone.now()
        current_email = getattr(request.user, 'email', '')

        # Lấy tất cả nhân viên đang hoạt động (ACTIVE)
        active_users = list(
            UserProfile.objects.filter(
                employment_status='ACTIVE'
            ).select_related('department', 'job_title', 'office_seat', 'office_presence')
        )

        # Bước 1: Xác định khu vực và chỗ ngồi cố định trước để tránh trùng seat_index
        used_seats = collections.defaultdict(set)
        preliminary = []
        for u in active_users:
            is_director_user = is_director_account(u)
            is_bot = bool(getattr(u, 'role', '') == 'BOT' or (u.email and u.email.strip().lower().startswith('bot.')))
            job_title_name = u.job_title.name if getattr(u, 'job_title', None) else ''
            bot_text = f"{u.name or ''} {getattr(u, 'role', '') or ''} {job_title_name} {u.email or ''}".lower()
            bot_norm = remove_vietnamese_accents(bot_text)

            email_lower = (u.email or '').strip().lower()
            is_assistant = bool(is_bot and any(k in bot_text or k in bot_norm for k in ['assistant', 'trợ lý', 'tro ly', 'hermes']))
            is_media_bot = bool(
                is_bot
                and not is_assistant
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

            if is_director_user:
                room = ROOM_DIRECTOR
                seat_index = 1
                is_head = True
            elif is_assistant:
                room = ROOM_COMMON
                seat_index = None
                is_head = False
            elif is_media_bot:
                room = ROOM_MEDIA
                seat_index = (
                    u.office_seat.seat_index
                    if hasattr(u, 'office_seat') and u.office_seat and u.office_seat.room == ROOM_MEDIA
                    else None
                )
                is_head = False
            elif 'binhlv' in (u.email or '').lower():
                room = ROOM_TECH
                seat_index = (
                    u.office_seat.seat_index
                    if hasattr(u, 'office_seat') and u.office_seat and u.office_seat.room == ROOM_TECH
                    else None
                )
                is_head = False
            elif not is_bot and (
                any(k in (u.email or '').lower() for k in ['ketoan', 'ha.ntt', 'thuha', 'thu.ha', 'khanhha', 'khanh.ha', 'quynhanh', 'quynh.anh'])
                or any(k in (u.name or '').lower() for k in ['thu hà', 'thu ha', 'khánh hà', 'khanh ha', 'quỳnh anh', 'quynh anh'])
                or (getattr(u, 'department', None) and any(k in (u.department.name or '').lower() for k in ['kế toán', 'ke toan', 'accounting', 'tài chính']))
            ):
                room = ROOM_ACCOUNTING
                u_email_l = (u.email or '').lower()
                u_name_l = (u.name or '').lower()
                if any(k in u_email_l for k in ['ha.ntt', 'thuha', 'thu.ha']) or any(k in u_name_l for k in ['thu hà', 'thu ha']):
                    seat_index = 1
                    is_head = True
                elif any(k in u_email_l for k in ['khanhha', 'khanh.ha', 'quynhanh', 'quynh.anh']) or any(k in u_name_l for k in ['khánh hà', 'khanh ha', 'quỳnh anh', 'quynh anh']):
                    seat_index = 2
                    is_head = False
                else:
                    seat_index = (
                        u.office_seat.seat_index
                        if hasattr(u, 'office_seat') and u.office_seat and u.office_seat.room == ROOM_ACCOUNTING
                        else None
                    )
                    is_head = False
            elif is_bot and hasattr(u, 'office_seat') and u.office_seat and u.office_seat.room == ROOM_ACCOUNTING:
                # Bot không được chiếm phòng Kế toán & HR, chuyển sang phòng Media
                room = ROOM_MEDIA
                seat_index = None
                is_head = False
            elif hasattr(u, 'office_seat') and u.office_seat:
                room = u.office_seat.room
                seat_index = u.office_seat.seat_index
                is_head = u.office_seat.is_head
            else:
                sug = suggest_seat_for_user(u)
                room = sug.get('room', ROOM_COMMON)
                seat_index = sug.get('seat_index')
                is_head = sug.get('is_head', False)

            if seat_index is not None and seat_index > 0:
                if seat_index in used_seats[room]:
                    seat_index = None
                else:
                    used_seats[room].add(seat_index)

            preliminary.append({
                'user': u,
                'room': room,
                'seat_index': seat_index,
                'is_head': is_head,
                'is_director_user': is_director_user,
                'is_bot': is_bot,
                'is_assistant': is_assistant,
            })

        # Bước 2: Gán seat_index tự động không trùng lặp và xây dựng roster payload
        roster = []
        next_seat_counter = collections.defaultdict(lambda: 1)

        for entry in preliminary:
            u = entry['user']
            room = entry['room']
            seat_index = entry['seat_index']
            is_head = entry['is_head']
            is_director_user = entry['is_director_user']
            is_bot = entry['is_bot']
            is_assistant = entry['is_assistant']

            if seat_index is None or seat_index == 0:
                candidate = next_seat_counter[room]
                while candidate in used_seats[room]:
                    candidate += 1
                seat_index = candidate
                used_seats[room].add(seat_index)
                next_seat_counter[room] = candidate + 1

            is_me = (u.email.strip().lower() == current_email.strip().lower()) if (u.email and current_email) else False
            member_id = hashlib.sha256(u.email.encode('utf-8')).hexdigest()[:12] if u.email else f"u_{u.pk}"

            seat_data = {
                'room': room,
                'seat_index': seat_index,
                'is_head': is_head,
            }

            presence = getattr(u, 'office_presence', None)
            avatar_cfg = dict(presence.avatar_config) if presence and isinstance(presence.avatar_config, dict) else {}
            show_presence = presence.show_presence if presence else True
            work_status = getattr(presence, 'work_status', STATUS_WORKING) if presence else STATUS_WORKING
            is_presence_idle = getattr(presence, 'is_idle', False) if presence else False

            full_name = getattr(u, 'name', None) or (u.get_full_name().strip() if hasattr(u, 'get_full_name') and u.get_full_name() and u.get_full_name().strip() else '')
            display_name = avatar_cfg.get('display_name') or full_name or (u.email.split('@')[0] if u.email else 'Thành viên')

            u_email_l = (u.email or '').lower()
            u_name_l = (full_name or display_name or '').lower()
            if any(k in u_email_l for k in ['binhlv', 'dungpv', 'phongnt', 'son.dc']) or \
               any(k in u_name_l for k in ['bình', 'dũng', 'phong', 'văn bình', 'mr dũng', 'phong nt']):
                gender = 'male'
            else:
                gender = avatar_cfg.get('gender')
                if gender not in ('male', 'female'):
                    gender = guess_gender_from_vietnamese_name(full_name or display_name or '')

            if gender == 'female':
                avatar_cfg.setdefault('hairStyle', 'bob' if ('khánh hà' in (full_name or '').lower() or 'khanh ha' in (full_name or '').lower()) else 'ponytail')
                avatar_cfg.setdefault('shirt', '#F2B8B5' if ('hà' in (full_name or '').lower() or 'ha' in (full_name or '').lower()) else '#E7C6D3')

            # Auto online cho nhân sự ACTIVE (không timeout offline), chỉ offline khi work_status == 'home' hoặc ẩn hiện diện
            if is_bot or presence is None:
                user_status = STATUS_WORKING
                raw_online = True
                is_user_idle = False
            else:
                user_status = presence.get_status(now, is_me=is_me)
                if user_status in (STATUS_OFFLINE, STATUS_HOME):
                    raw_online = False
                    is_user_idle = False
                elif user_status == STATUS_IDLE:
                    raw_online = True
                    is_user_idle = True
                else:
                    raw_online = True
                    is_user_idle = False

            # Nếu tắt hiện diện thì người khác luôn thấy offline
            if not is_me and not show_presence:
                display_online = False
                display_status = STATUS_OFFLINE
            else:
                display_online = user_status != STATUS_HOME
                display_status = user_status

            is_director = bool(is_director_user or (room == ROOM_DIRECTOR and is_head))

            member_info = {
                'name': display_name,
                'department': u.department.name if u.department else None,
                'job_title': u.job_title.name if u.job_title else None,
                'role': u.job_title.name if u.job_title else getattr(u, 'role', None),
                'id': member_id,
                'seat': seat_data,
                'online': display_online,
                'status': display_status,
                'work_status': work_status,
                'is_idle': is_user_idle,
                'is_bot': is_bot,
                'is_assistant': is_assistant,
                'is_director': is_director,
                'is_me': is_me,
                'gender': gender,
                'avatar': {**avatar_cfg, 'gender': gender},
            }

            if is_me:
                member_info['show_presence'] = show_presence

            roster.append(member_info)

        # Đảm bảo luôn có Robot Trợ lý AI chuyên trách trong văn phòng (phòng chung)
        if not any(m.get('is_assistant') for m in roster):
            roster.append({
                'name': 'Robot Trợ lý AI',
                'department': 'Văn phòng trung tâm',
                'job_title': 'Trợ lý AI Workspace',
                'role': 'Trợ lý AI Workspace',
                'id': 'bot-assistant',
                'seat': {'room': ROOM_COMMON, 'seat_index': 0, 'is_head': True},
                'seat_index': 0,
                'room': ROOM_COMMON,
                'is_head': True,
                'online': True,
                'status': STATUS_WORKING,
                'work_status': STATUS_WORKING,
                'is_idle': False,
                'is_bot': True,
                'is_assistant': True,
                'is_director': False,
                'is_me': False,
                'gender': 'male',
                'avatar': {'shirt': '#0EA5E9', 'skin_color': '#E2E8F0', 'hairStyle': 'plain', 'glasses': False, 'gender': 'male'},
            })

        return Response({'roster': roster})


class MyAvatarView(APIView):
    """
    GET /api/office/me/avatar/
    PUT /api/office/me/avatar/
    Xem và chỉnh sửa kiểu nhân vật và cài đặt show_presence của chính mình.
    """
    permission_classes = [IsWorkspaceAuthenticated]

    def get(self, request):
        user = request.user
        presence, _ = OfficePresence.objects.get_or_create(
            user=user,
            defaults={'show_presence': True, 'avatar_config': {}},
        )
        avatar = dict(presence.avatar_config or {})
        if 'gender' not in avatar:
            avatar['gender'] = guess_gender_from_vietnamese_name(user.name or '')
        return Response({
            'show_presence': presence.show_presence,
            'avatar': avatar,
            'gender': avatar.get('gender', 'male'),
        })

    def put(self, request):
        serializer = AvatarConfigSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        presence, _ = OfficePresence.objects.get_or_create(user=user)

        validated = serializer.validated_data
        if 'show_presence' in validated:
            presence.show_presence = validated['show_presence']

        avatar_keys = ['display_name', 'skin_color', 'hair_style', 'hair_color', 'outfit_color', 'glasses', 'gender']
        current_config = dict(presence.avatar_config or {})
        for key in avatar_keys:
            if key in validated:
                current_config[key] = validated[key]

        presence.avatar_config = current_config
        presence.save(update_fields=['show_presence', 'avatar_config', 'updated_at'])

        return Response({
            'status': 'ok',
            'show_presence': presence.show_presence,
            'avatar': presence.avatar_config,
            'gender': presence.avatar_config.get('gender', 'male'),
        })


class AdminSeatsView(APIView):
    """
    GET /api/office/seats/
    PUT /api/office/seats/
    Quản trị chỗ ngồi nhân sự. Dành riêng cho ADMIN.
    """
    permission_classes = [IsWorkspaceAuthenticated, IsAdmin]

    def get(self, request):
        users = UserProfile.objects.filter(
            employment_status='ACTIVE'
        ).select_related('department', 'job_title', 'office_seat')

        results = []
        for u in users:
            current_seat = None
            if hasattr(u, 'office_seat') and u.office_seat:
                current_seat = {
                    'room': u.office_seat.room,
                    'seat_index': u.office_seat.seat_index,
                    'is_head': u.office_seat.is_head,
                }
            suggested = suggest_seat_for_user(u)
            results.append({
                'email': u.email,
                'name': u.name or u.email.split('@')[0],
                'role': u.role,
                'department': u.department.name if u.department else None,
                'job_title': u.job_title.name if u.job_title else None,
                'seat': current_seat,
                'suggested_seat': suggested,
            })

        return Response({'seats': results})

    def put(self, request):
        data = request.data
        items = data.get('seats') if isinstance(data, dict) and 'seats' in data else ([data] if isinstance(data, dict) else data)

        if not isinstance(items, list) or not items:
            return Response({'error': 'Dữ liệu không hợp lệ. Cần danh sách chỗ ngồi hoặc đối tượng chỗ ngồi.'}, status=status.HTTP_400_BAD_REQUEST)

        updated_seats = []
        admin_email = getattr(request.user, 'email', 'unknown_admin')

        for item in items:
            serializer = OfficeSeatUpdateSerializer(data=item)
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

            vdata = serializer.validated_data
            target_email = vdata['email'].strip().lower()
            try:
                target_user = UserProfile.objects.get(email__iexact=target_email)
            except UserProfile.DoesNotExist:
                return Response({'error': f'Không tìm thấy nhân viên với email {target_email}'}, status=status.HTTP_404_NOT_FOUND)

            seat, created = OfficeSeat.objects.get_or_create(user=target_user)
            old_desc = f'{seat.room} #{seat.seat_index} (head={seat.is_head})' if not created else 'chưa có chỗ'
            
            seat.room = vdata['room']
            seat.seat_index = vdata.get('seat_index')
            seat.is_head = vdata.get('is_head', False)
            seat.save()

            new_desc = f'{seat.room} #{seat.seat_index} (head={seat.is_head})'
            logger.info(f'[OFFICE_SEAT_CHANGE] Admin {admin_email} changed seat for {target_email}: {old_desc} -> {new_desc}')

            updated_seats.append({
                'email': target_user.email,
                'room': seat.room,
                'seat_index': seat.seat_index,
                'is_head': seat.is_head,
            })

        return Response({'status': 'ok', 'updated_seats': updated_seats})
