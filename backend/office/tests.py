import os
import tempfile
from datetime import timedelta
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from authentication.models import Department, JobTitle, UserProfile
from office.models import (
    HEARTBEAT_MIN_WRITE_INTERVAL_SECONDS,
    ONLINE_TIMEOUT_SECONDS,
    ROOM_ACCOUNTING,
    ROOM_COMMON,
    ROOM_DIRECTOR,
    ROOM_EXAM,
    ROOM_TECH,
    OfficePresence,
    OfficeSeat,
    suggest_seat_for_user,
)


class OfficeBackendTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Tạo phòng ban và chức danh mẫu
        self.dept_tech = Department.objects.create(name='Phòng Công nghệ', code='TECH')
        self.dept_exam = Department.objects.create(name='Phòng Khảo thí', code='EXAM')
        self.dept_accounting = Department.objects.create(name='Phòng Kế toán', code='ACC')
        self.title_head_tech = JobTitle.objects.create(name='Trưởng phòng Công nghệ')
        self.title_dev = JobTitle.objects.create(name='Lập trình viên')
        self.title_examiner = JobTitle.objects.create(name='Chuyên viên Khảo thí')

        # Admin user
        self.admin_user = UserProfile.objects.create(
            email='admin_test@fermat.test',
            name='Nguyễn Văn Quản Trị',
            role='ADMIN',
            phone='0900000001',
            employee_code='NV001',
            employment_status='ACTIVE',
        )

        # Employee 1 (Tech Lead)
        self.tech_lead = UserProfile.objects.create(
            email='lead_tech@fermat.test',
            name='Trần Công Nghệ',
            role='EMPLOYEE',
            phone='0900000002',
            employee_code='NV002',
            department=self.dept_tech,
            job_title=self.title_head_tech,
            employment_status='ACTIVE',
        )

        # Employee 2 (Dev)
        self.dev_user = UserProfile.objects.create(
            email='dev_test@fermat.test',
            name='Lê Lập Trình',
            role='EMPLOYEE',
            phone='0900000003',
            employee_code='NV003',
            department=self.dept_tech,
            job_title=self.title_dev,
            employment_status='ACTIVE',
        )

        # Resigned user (đã nghỉ việc)
        self.resigned_user = UserProfile.objects.create(
            email='resigned_test@fermat.test',
            name='Phạm Nghỉ Việc',
            role='EMPLOYEE',
            phone='0900000004',
            employee_code='NV004',
            employment_status='RESIGNED',
        )

    def test_unauthenticated_requests_are_rejected(self):
        """Tất cả API văn phòng phải yêu cầu đăng nhập."""
        res_hb = self.client.post('/api/office/heartbeat/')
        self.assertIn(res_hb.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])

        res_roster = self.client.get('/api/office/roster/')
        self.assertIn(res_roster.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])

        res_avatar = self.client.get('/api/office/me/avatar/')
        self.assertIn(res_avatar.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])

        res_seats = self.client.get('/api/office/seats/')
        self.assertIn(res_seats.status_code, [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN])

    def test_heartbeat_updates_presence_and_expires(self):
        """Heartbeat cập nhật last_seen; online = trong 3 phút, sau đó chuyển offline."""
        self.client.force_authenticate(user=self.dev_user)
        now = timezone.now()

        # Gọi heartbeat lần đầu
        with patch('django.utils.timezone.now', return_value=now):
            response = self.client.post('/api/office/heartbeat/')
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            data = response.json()
            self.assertEqual(data['status'], 'ok')
            self.assertTrue(data['online'])

        presence = OfficePresence.objects.get(user=self.dev_user)
        self.assertEqual(presence.last_seen, now)
        self.assertTrue(presence.is_online(now))

        # Kiểm tra sau 2 phút (120s): vẫn online
        after_2m = now + timedelta(seconds=120)
        self.assertTrue(presence.is_online(after_2m))

        # Kiểm tra sau 3 phút 5 giây (185s): hết hạn, trở thành offline
        after_3m = now + timedelta(seconds=185)
        self.assertFalse(presence.is_online(after_3m))

    def test_heartbeat_rate_limiting_protects_sqlite(self):
        """Không ghi lại DB nếu heartbeat liên tục trong vòng 30 giây."""
        self.client.force_authenticate(user=self.dev_user)
        t0 = timezone.now()

        # Heartbeat 1 tại t0
        with patch('django.utils.timezone.now', return_value=t0):
            res1 = self.client.post('/api/office/heartbeat/')
            self.assertEqual(res1.status_code, status.HTTP_200_OK)
            self.assertFalse(res1.json().get('rate_limited'))

        presence1 = OfficePresence.objects.get(user=self.dev_user)
        self.assertEqual(presence1.last_seen, t0)

        # Heartbeat 2 tại t0 + 10 giây (<30s) -> Bị rate limit ghi
        t1 = t0 + timedelta(seconds=10)
        with patch('django.utils.timezone.now', return_value=t1):
            res2 = self.client.post('/api/office/heartbeat/')
            self.assertEqual(res2.status_code, status.HTTP_200_OK)
            self.assertTrue(res2.json().get('rate_limited'))

        # DB vẫn giữ timestamp cũ t0
        presence2 = OfficePresence.objects.get(user=self.dev_user)
        self.assertEqual(presence2.last_seen, t0)

        # Heartbeat 3 tại t0 + 35 giây (>30s) -> Ghi DB thành công
        t2 = t0 + timedelta(seconds=35)
        with patch('django.utils.timezone.now', return_value=t2):
            res3 = self.client.post('/api/office/heartbeat/')
            self.assertEqual(res3.status_code, status.HTTP_200_OK)
            self.assertFalse(res3.json().get('rate_limited'))

        presence3 = OfficePresence.objects.get(user=self.dev_user)
        self.assertEqual(presence3.last_seen, t2)

    def test_roster_privacy_no_leaks(self):
        """Roster không bao giờ trả email, sđt, mã nhân viên của người khác."""
        self.client.force_authenticate(user=self.dev_user)

        # Gán chỗ ngồi cho Tech Lead
        OfficeSeat.objects.create(
            user=self.tech_lead,
            room=ROOM_TECH,
            seat_index=1,
            is_head=True,
        )

        response = self.client.get('/api/office/roster/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertIn('roster', data)
        roster = data['roster']

        # Đảm bảo người nghỉ việc không xuất hiện
        resigned_names = [item['name'] for item in roster if item['name'] == self.resigned_user.name]
        self.assertEqual(len(resigned_names), 0)

        # Duyệt từng người trong roster và kiểm tra rò rỉ
        for member in roster:
            # Không có trường email, phone, employee_code trong payload
            self.assertNotIn('email', member)
            self.assertNotIn('phone', member)
            self.assertNotIn('employee_code', member)
            self.assertNotIn('salary', member)
            self.assertNotIn('access_modules', member)

            # Các trường hợp lệ bắt buộc có
            self.assertIn('name', member)
            self.assertIn('department', member)
            self.assertIn('job_title', member)
            self.assertIn('seat', member)
            self.assertIn('online', member)
            self.assertIn('is_me', member)
            self.assertIn('avatar', member)

            # Kiểm tra trường seat
            seat = member['seat']
            self.assertIn('room', seat)
            self.assertIn('seat_index', seat)
            self.assertIn('is_head', seat)

        # Kiểm tra nội dung thô của response không chứa số điện thoại hoặc mã nhân viên
        content_str = response.content.decode('utf-8')
        self.assertNotIn('0900000001', content_str)
        self.assertNotIn('0900000002', content_str)
        self.assertNotIn('NV001', content_str)
        self.assertNotIn('NV002', content_str)

    def test_roster_unassigned_user_defaults_to_common_room(self):
        """Người chưa có chỗ ngồi được tự động xếp vào 'common' (phòng chung)."""
        self.client.force_authenticate(user=self.dev_user)
        # dev_user chưa có OfficeSeat
        response = self.client.get('/api/office/roster/')
        data = response.json()
        dev_entry = next(item for item in data['roster'] if item['is_me'])
        self.assertEqual(dev_entry['seat']['room'], ROOM_COMMON)
        self.assertIsNone(dev_entry['seat']['seat_index'])
        self.assertFalse(dev_entry['seat']['is_head'])

    def test_show_presence_toggle_hides_online_status_from_others(self):
        """Khi người dùng tắt hiện diện (show_presence=False), người khác luôn thấy offline."""
        now = timezone.now()

        # Tech Lead đang online nhưng tắt hiện diện
        OfficePresence.objects.create(
            user=self.tech_lead,
            last_seen=now,
            show_presence=False,
        )

        # Dev User xem roster
        self.client.force_authenticate(user=self.dev_user)
        response = self.client.get('/api/office/roster/')
        data = response.json()
        lead_entry = next(item for item in data['roster'] if item['name'] == self.tech_lead.name)
        # Người khác thấy offline!
        self.assertFalse(lead_entry['online'])

        # Tech Lead tự xem roster của mình
        self.client.force_authenticate(user=self.tech_lead)
        response_self = self.client.get('/api/office/roster/')
        data_self = response_self.json()
        self_entry = next(item for item in data_self['roster'] if item['is_me'])
        # Chính mình vẫn thấy mình đang online và biết cờ show_presence = False
        self.assertTrue(self_entry['online'])
        self.assertFalse(self_entry['show_presence'])

    def test_my_avatar_get_and_put(self):
        """Xem và cập nhật cấu hình avatar cá nhân với whitelist kiểm tra chặt chẽ."""
        self.client.force_authenticate(user=self.dev_user)

        # GET ban đầu
        res_get = self.client.get('/api/office/me/avatar/')
        self.assertEqual(res_get.status_code, status.HTTP_200_OK)
        self.assertTrue(res_get.json()['show_presence'])

        # PUT thành công
        payload = {
            'display_name': 'Dev Siêu Cấp',
            'skin_color': '#fadcbc',
            'hair_style': 'short',
            'hair_color': '#090806',
            'outfit_color': '#2563eb',
            'glasses': 'round',
            'show_presence': False,
        }
        res_put = self.client.put('/api/office/me/avatar/', payload, format='json')
        self.assertEqual(res_put.status_code, status.HTTP_200_OK)
        res_data = res_put.json()
        self.assertEqual(res_data['status'], 'ok')
        self.assertFalse(res_data['show_presence'])
        self.assertEqual(res_data['avatar']['display_name'], 'Dev Siêu Cấp')
        self.assertEqual(res_data['avatar']['skin_color'], '#fadcbc')

        # PUT thất bại: màu hex sai định dạng
        bad_color = {'skin_color': 'blue_not_hex'}
        res_bad1 = self.client.put('/api/office/me/avatar/', bad_color, format='json')
        self.assertEqual(res_bad1.status_code, status.HTTP_400_BAD_REQUEST)

        # PUT thất bại: kiểu tóc không có trong whitelist
        bad_hair = {'hair_style': 'rainbow_spiky_hair'}
        res_bad2 = self.client.put('/api/office/me/avatar/', bad_hair, format='json')
        self.assertEqual(res_bad2.status_code, status.HTTP_400_BAD_REQUEST)

        # PUT thất bại: kiểu kính không có trong whitelist
        bad_glasses = {'glasses': 'telescope'}
        res_bad3 = self.client.put('/api/office/me/avatar/', bad_glasses, format='json')
        self.assertEqual(res_bad3.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_seats_permission_and_management(self):
        """Chỉ ADMIN mới có quyền truy cập và chỉnh sửa API /api/office/seats/."""
        # Nhân viên thường gọi GET / PUT -> 403 Forbidden
        self.client.force_authenticate(user=self.dev_user)
        res_emp_get = self.client.get('/api/office/seats/')
        self.assertEqual(res_emp_get.status_code, status.HTTP_403_FORBIDDEN)

        res_emp_put = self.client.put('/api/office/seats/', {
            'email': self.dev_user.email,
            'room': ROOM_TECH,
            'seat_index': 2,
        }, format='json')
        self.assertEqual(res_emp_put.status_code, status.HTTP_403_FORBIDDEN)

        # Admin gọi GET -> 200 OK
        self.client.force_authenticate(user=self.admin_user)
        res_admin_get = self.client.get('/api/office/seats/')
        self.assertEqual(res_admin_get.status_code, status.HTTP_200_OK)
        data = res_admin_get.json()
        self.assertIn('seats', data)
        self.assertTrue(len(data['seats']) >= 3)

        # Admin gọi PUT chỉnh sửa chỗ ngồi cho dev_user
        res_admin_put = self.client.put('/api/office/seats/', {
            'email': self.dev_user.email,
            'room': ROOM_TECH,
            'seat_index': 2,
            'is_head': False,
        }, format='json')
        self.assertEqual(res_admin_put.status_code, status.HTTP_200_OK)

        seat = OfficeSeat.objects.get(user=self.dev_user)
        self.assertEqual(seat.room, ROOM_TECH)
        self.assertEqual(seat.seat_index, 2)
        self.assertFalse(seat.is_head)

        # Admin gọi PUT vượt quá sức chứa phòng (director chỉ có 1 chỗ)
        res_over = self.client.put('/api/office/seats/', {
            'email': self.dev_user.email,
            'room': ROOM_DIRECTOR,
            'seat_index': 2,
        }, format='json')
        self.assertEqual(res_over.status_code, status.HTTP_400_BAD_REQUEST)

    def test_seed_seats_command_valid_csv(self):
        """Lệnh office_seed_seats nạp đúng từ CSV giả lập hợp lệ."""
        csv_content = f"""email,room,seat_index,is_head
{self.admin_user.email},director,1,true
{self.tech_lead.email},tech,1,true
{self.dev_user.email},tech,2,false
"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False, encoding='utf-8') as f:
            f.write(csv_content)
            temp_path = f.name

        try:
            call_command('office_seed_seats', file=temp_path)

            admin_seat = OfficeSeat.objects.get(user=self.admin_user)
            self.assertEqual(admin_seat.room, ROOM_DIRECTOR)
            self.assertEqual(admin_seat.seat_index, 1)
            self.assertTrue(admin_seat.is_head)

            lead_seat = OfficeSeat.objects.get(user=self.tech_lead)
            self.assertEqual(lead_seat.room, ROOM_TECH)
            self.assertEqual(lead_seat.seat_index, 1)
            self.assertTrue(lead_seat.is_head)

            dev_seat = OfficeSeat.objects.get(user=self.dev_user)
            self.assertEqual(dev_seat.room, ROOM_TECH)
            self.assertEqual(dev_seat.seat_index, 2)
            self.assertFalse(dev_seat.is_head)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    def test_seed_seats_command_invalid_csv_handled_gracefully(self):
        """Lệnh office_seed_seats bắt lỗi CSV sai, không crash."""
        # 1. Tệp không tồn tại
        with self.assertRaises(CommandError):
            call_command('office_seed_seats', file='/path/to/non_existent_file_xyz.csv')

        # 2. Tệp thiếu header
        with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False, encoding='utf-8') as f:
            f.write("wrong_header1,wrong_header2\na,b\n")
            bad_header_path = f.name

        try:
            with self.assertRaises(CommandError):
                call_command('office_seed_seats', file=bad_header_path)
        finally:
            if os.path.exists(bad_header_path):
                os.remove(bad_header_path)

        # 3. Tệp chứa dòng lỗi (phòng sai, email không tồn tại, seat_index sai)
        bad_rows_csv = f"""email,room,seat_index,is_head
nonexistent_email@test.com,tech,1,false
{self.dev_user.email},wrong_room_name,1,false
{self.dev_user.email},tech,not_a_number,false
"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False, encoding='utf-8') as f:
            f.write(bad_rows_csv)
            bad_rows_path = f.name

        try:
            # Không raise exception mà ghi nhận lỗi và in ra
            call_command('office_seed_seats', file=bad_rows_path)
            # dev_user không bị cập nhật sai
            self.assertFalse(OfficeSeat.objects.filter(user=self.dev_user).exists())
        finally:
            if os.path.exists(bad_rows_path):
                os.remove(bad_rows_path)

    def test_suggest_seat_for_user_logic(self):
        """Gợi ý khu vực văn phòng dựa trên vai trò, phòng ban, chức danh."""
        # Admin -> Director
        s_admin = suggest_seat_for_user(self.admin_user)
        self.assertEqual(s_admin['room'], ROOM_DIRECTOR)
        self.assertTrue(s_admin['is_head'])

        # Tech Lead -> Tech, is_head=True
        s_lead = suggest_seat_for_user(self.tech_lead)
        self.assertEqual(s_lead['room'], ROOM_TECH)
        self.assertTrue(s_lead['is_head'])

        # Dev -> Tech, is_head=False
        s_dev = suggest_seat_for_user(self.dev_user)
        self.assertEqual(s_dev['room'], ROOM_TECH)
        self.assertFalse(s_dev['is_head'])

        # User không có thông tin -> Common
        plain_user = UserProfile.objects.create(
            email='plain_test@fermat.test',
            name='Nguyễn Khách',
            role='EMPLOYEE',
            employment_status='ACTIVE',
        )
        s_plain = suggest_seat_for_user(plain_user)
        self.assertEqual(s_plain['room'], ROOM_COMMON)
        self.assertFalse(s_plain['is_head'])

    def test_heartbeat_idle_status_and_roster_behavior(self):
        """
        Việc 033: Kiểm tra trạng thái working / idle / offline trong heartbeat và roster:
        - Heartbeat nhận idle=True -> roster trả status='idle', online=True.
        - Heartbeat gửi ngay idle=False -> roster trả status='working', online=True.
        - Quá 3 phút không có nhịp -> status='offline', online=False.
        - show_presence=False -> người khác thấy status='offline', online=False.
        """
        self.client.force_authenticate(user=self.dev_user)

        # 1. Gửi heartbeat với idle=True
        res = self.client.post('/api/office/heartbeat/', {'idle': True}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data['idle'])
        presence = OfficePresence.objects.get(user=self.dev_user)
        self.assertTrue(presence.is_idle)

        # Roster người khác xem thấy idle
        self.client.force_authenticate(user=self.admin_user)
        res_roster = self.client.get('/api/office/roster/')
        self.assertEqual(res_roster.status_code, status.HTTP_200_OK)
        dev_member = next(m for m in res_roster.data['roster'] if m['name'] == self.dev_user.name)
        self.assertEqual(dev_member['status'], 'idle')
        self.assertTrue(dev_member['online'])

        # 2. Người dùng thao tác lại -> gửi ngay idle=False (không bị chặn bởi rate limit 30s)
        self.client.force_authenticate(user=self.dev_user)
        res_active = self.client.post('/api/office/heartbeat/', {'idle': False}, format='json')
        self.assertEqual(res_active.status_code, status.HTTP_200_OK)
        self.assertFalse(res_active.data['idle'])
        self.assertFalse(res_active.data['rate_limited'])
        presence.refresh_from_db()
        self.assertFalse(presence.is_idle)

        # Roster người khác xem thấy working
        self.client.force_authenticate(user=self.admin_user)
        res_roster2 = self.client.get('/api/office/roster/')
        dev_member2 = next(m for m in res_roster2.data['roster'] if m['name'] == self.dev_user.name)
        self.assertEqual(dev_member2['status'], 'working')
        self.assertTrue(dev_member2['online'])

        # 3. Quá 3 phút không có heartbeat -> offline
        presence.last_seen = timezone.now() - timedelta(seconds=185)
        presence.save(update_fields=['last_seen'])

        res_roster3 = self.client.get('/api/office/roster/')
        dev_member3 = next(m for m in res_roster3.data['roster'] if m['name'] == self.dev_user.name)
        self.assertEqual(dev_member3['status'], 'offline')
        self.assertFalse(dev_member3['online'])

        # 4. Khi show_presence = False -> người khác thấy offline dù đang active
        presence.last_seen = timezone.now()
        presence.show_presence = False
        presence.save(update_fields=['last_seen', 'show_presence'])

        # Admin xem dev_user
        res_roster4 = self.client.get('/api/office/roster/')
        dev_member4 = next(m for m in res_roster4.data['roster'] if m['name'] == self.dev_user.name)
        self.assertEqual(dev_member4['status'], 'offline')
        self.assertFalse(dev_member4['online'])

        # Chính dev_user xem bản thân
        self.client.force_authenticate(user=self.dev_user)
        res_roster_me = self.client.get('/api/office/roster/')
        me_member = next(m for m in res_roster_me.data['roster'] if m['is_me'])
        self.assertEqual(me_member['status'], 'working')
        self.assertTrue(me_member['online'])
        self.assertFalse(me_member['show_presence'])

    def test_heartbeat_idle_type_validation_and_privacy(self):
        """
        Việc 033: Kiểm tra tính an toàn:
        - Kiểu dữ liệu không phải boolean bị từ chối với HTTP 400.
        - Không truyền idle thì mặc định idle=False.
        - Roster tuyệt đối không lộ email, số điện thoại hay mã nhân viên.
        """
        self.client.force_authenticate(user=self.dev_user)

        # Kiểu sai: chuỗi
        res_bad_str = self.client.post('/api/office/heartbeat/', {'idle': 'yes'}, format='json')
        self.assertEqual(res_bad_str.status_code, status.HTTP_400_BAD_REQUEST)

        # Kiểu sai: số nguyên
        res_bad_int = self.client.post('/api/office/heartbeat/', {'idle': 1}, format='json')
        self.assertEqual(res_bad_int.status_code, status.HTTP_400_BAD_REQUEST)

        # Kiểu sai: None/null
        res_bad_none = self.client.post('/api/office/heartbeat/', {'idle': None}, format='json')
        self.assertEqual(res_bad_none.status_code, status.HTTP_400_BAD_REQUEST)

        # Mặc định không truyền idle -> False
        res_default = self.client.post('/api/office/heartbeat/', {}, format='json')
        self.assertEqual(res_default.status_code, status.HTTP_200_OK)
        self.assertFalse(res_default.data['idle'])

        # Kiểm tra không rò rỉ thông tin cá nhân trong roster
        res_roster = self.client.get('/api/office/roster/')
        for member in res_roster.data['roster']:
            self.assertNotIn('email', member)
            self.assertNotIn('phone', member)
            self.assertNotIn('employee_code', member)
            self.assertIn(member['status'], ['working', 'idle', 'offline'])
