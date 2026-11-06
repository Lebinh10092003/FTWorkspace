import hashlib
import collections
import logging
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.models import UserProfile
from authentication.permissions import IsAdmin, IsWorkspaceAuthenticated, request_role
from .models import (
    HEARTBEAT_MIN_WRITE_INTERVAL_SECONDS,
    ONLINE_TIMEOUT_SECONDS,
    ROOM_COMMON,
    OfficePresence,
    OfficeSeat,
    suggest_seat_for_user,
)
from .serializers import AvatarConfigSerializer, OfficeSeatUpdateSerializer

logger = logging.getLogger(__name__)


class HeartbeatView(APIView):
    """
    POST /api/office/heartbeat/
    Cập nhật last_seen của người dùng đang đăng nhập.
    Web gọi mỗi ~60 giây khi tab đang mở.
    Có rate limit ghi để bảo vệ SQLite (không ghi nếu lần cuối < 30s).
    """
    permission_classes = [IsWorkspaceAuthenticated]

    def post(self, request):
        user = request.user
        now = timezone.now()
        presence, created = OfficePresence.objects.get_or_create(
            user=user,
            defaults={'last_seen': now, 'show_presence': True},
        )

        rate_limited = False
        if not created:
            if presence.last_seen and (now - presence.last_seen).total_seconds() < HEARTBEAT_MIN_WRITE_INTERVAL_SECONDS:
                rate_limited = True
            else:
                presence.last_seen = now
                presence.save(update_fields=['last_seen', 'updated_at'])

        return Response({
            'status': 'ok',
            'online': True,
            'last_seen': presence.last_seen.isoformat() if presence.last_seen else now.isoformat(),
            'rate_limited': rate_limited,
        })


class OfficeRosterView(APIView):
    """
    GET /api/office/roster/
    Trả danh sách nhân viên an toàn cho mọi người dùng đã đăng nhập.
    Chỉ gồm: tên hiển thị, phòng ban, chức danh, chỗ ngồi, online (bool), is_me, avatar.
    Ẩn người đã nghỉ việc.
    Không trả email, điện thoại, lịch hay dữ liệu riêng của người khác.
    Nếu show_presence = False thì người khác luôn thấy offline.
    """
    permission_classes = [IsWorkspaceAuthenticated]

    def get(self, request):
        now = timezone.now()
        current_email = getattr(request.user, 'email', '')

        # Lấy tất cả nhân viên đang hoạt động (ACTIVE)
        active_users = UserProfile.objects.filter(
            employment_status='ACTIVE'
        ).select_related('department', 'job_title', 'office_seat', 'office_presence')

        roster = []
        room_counters = collections.defaultdict(int)
        for u in active_users:
            is_me = (u.email.strip().lower() == current_email.strip().lower()) if (u.email and current_email) else False
            member_id = hashlib.sha256(u.email.encode('utf-8')).hexdigest()[:12] if u.email else f"u_{u.pk}"

            # Chỗ ngồi: ưu tiên OfficeSeat trong DB, nếu chưa có thì gợi ý theo phòng ban
            if hasattr(u, 'office_seat') and u.office_seat:
                room = u.office_seat.room
                seat_index = u.office_seat.seat_index
                is_head = u.office_seat.is_head
            else:
                sug = suggest_seat_for_user(u)
                room = sug.get('room', ROOM_COMMON)
                seat_index = sug.get('seat_index')
                is_head = sug.get('is_head', False)

            # Phân bổ seat_index tuần tự không trùng lặp nếu chưa có
            if seat_index is None or seat_index == 0:
                room_counters[room] += 1
                seat_index = room_counters[room]

            seat_data = {
                'room': room,
                'seat_index': seat_index,
                'is_head': is_head,
            }
            # Hiện diện và avatar
            presence = getattr(u, 'office_presence', None)
            avatar_cfg = presence.avatar_config if presence and isinstance(presence.avatar_config, dict) else {}
            show_presence = presence.show_presence if presence else True

            # Tính trạng thái online: có nhịp trong 3 phút
            raw_online = presence.is_online(now) if presence else False

            # Nếu tắt hiện diện thì người khác luôn thấy offline
            display_online = raw_online if (is_me or show_presence) else False

            # Tên hiển thị an toàn: lấy tên tuỳ chỉnh avatar hoặc UserProfile.name
            display_name = avatar_cfg.get('display_name') or u.name or (u.email.split('@')[0] if u.email else 'Thành viên')

            member_info = {
                'name': display_name,
                'department': u.department.name if u.department else None,
                'job_title': u.job_title.name if u.job_title else None,
                'id': member_id,
                'seat': seat_data,
                'online': display_online,
                'is_me': is_me,
                'avatar': avatar_cfg,
            }

            if is_me:
                # Chính người dùng được biết cấu hình ẩn hiện của mình
                member_info['show_presence'] = show_presence

            roster.append(member_info)

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
        return Response({
            'show_presence': presence.show_presence,
            'avatar': presence.avatar_config or {},
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

        avatar_keys = ['display_name', 'skin_color', 'hair_style', 'hair_color', 'outfit_color', 'glasses']
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
