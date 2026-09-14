from datetime import datetime, time, timedelta
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.authtoken.models import Token

from authentication.models import Department, UserProfile
from digital_training.models import TrainingSession

from .models import AttendanceRecord, TimesheetEditLog, TimesheetEntry
from .views import _worked_minutes
from work_schedule.models import WorkItem, WorkScheduleSheetChange


class AttendanceApiTests(TestCase):
    def setUp(self):
        django_user = get_user_model().objects.create_user(
            username="attendance@example.com",
            email="attendance@example.com",
            password="StrongPassword9921",
        )
        self.profile = UserProfile.objects.create(
            email=django_user.email,
            name="Nhân viên chấm công",
            role="EMPLOYEE",
            access_modules=["attendance"],
        )
        self.token = Token.objects.create(user=django_user).key

    def request(self, method, path, payload=None):
        return getattr(self.client, method)(
            path,
            payload or {},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.token}",
        )

    def test_employee_can_clock_in_and_out_and_data_is_persisted(self):
        clock_in = self.request("post", "/api/attendance/clock", {"action": "IN", "shiftCode": "OFFICE", "note": "Làm tại văn phòng"})
        self.assertEqual(clock_in.status_code, 201)
        self.assertEqual(clock_in.json()["record"]["shiftCode"], "OFFICE")
        self.assertEqual(AttendanceRecord.objects.count(), 1)

        duplicate = self.request("post", "/api/attendance/clock", {"action": "IN", "shiftCode": "MORNING"})
        self.assertEqual(duplicate.status_code, 400)

        clock_out = self.request("post", "/api/attendance/clock", {"action": "OUT"})
        self.assertEqual(clock_out.status_code, 200)
        self.assertIsNotNone(clock_out.json()["record"]["clockOut"])
        self.assertIsNotNone(AttendanceRecord.objects.get().clock_out)

        listing = self.request("get", f"/api/attendance/records?month={timezone.localdate():%Y-%m}")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(len(listing.json()["records"]), 1)
        self.assertIsNone(listing.json()["current"])

    def test_guest_cannot_read_or_write_attendance(self):
        self.assertEqual(self.client.get("/api/attendance/records").status_code, 401)
        self.assertEqual(self.client.post("/api/attendance/clock", {"action": "IN"}, content_type="application/json").status_code, 401)

    def test_employee_only_sees_their_own_records(self):
        other = UserProfile.objects.create(email="other@example.com", name="Other", role="EMPLOYEE")
        AttendanceRecord.objects.create(
            employee=other,
            work_date=timezone.localdate(),
            shift_code="MORNING",
            shift_name="Ca sáng",
            scheduled_start="08:00",
            scheduled_end="12:00",
            expected_minutes=240,
            clock_in=timezone.now(),
        )
        listing = self.request("get", f"/api/attendance/records?month={timezone.localdate():%Y-%m}&scope=team")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.json()["records"], [])
        self.assertEqual(listing.json()["scope"], "mine")

    def test_office_duration_excludes_lunch_break(self):
        local_tz = timezone.get_current_timezone()
        item = AttendanceRecord(
            employee=self.profile,
            work_date=timezone.localdate(),
            shift_code="OFFICE",
            shift_name="Ca hành chính",
            scheduled_start="08:00",
            scheduled_end="17:30",
            expected_minutes=480,
            clock_in=timezone.make_aware(datetime.combine(timezone.localdate(), datetime.strptime("08:00", "%H:%M").time()), local_tz),
            clock_out=timezone.make_aware(datetime.combine(timezone.localdate(), datetime.strptime("17:30", "%H:%M").time()), local_tz),
        )
        self.assertEqual(_worked_minutes(item), 480)

    def test_admin_first_timesheet_request_lists_active_employees_without_entries(self):
        self.profile.role = "ADMIN"
        self.profile.save(update_fields=["role", "updated_at"])
        employee = UserProfile.objects.create(
            email="no-timesheet@example.com",
            name="Nhân viên chưa có ca",
            role="EMPLOYEE",
            employment_status="ACTIVE",
        )

        response = self.request("get", f"/api/attendance/timesheet?month={timezone.localdate():%Y-%m}&scope=all")

        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["isPrivileged"])
        self.assertIn(employee.email, [row["email"] for row in response.json()["employees"]])

    def test_saving_timesheet_queues_background_sheet_update(self):
        work_date = timezone.localdate().isoformat()

        response = self.request("post", "/api/attendance/timesheet/save", {
            "workDate": work_date,
            "isDayOff": False,
            "shifts": [{"start": "09:30", "end": "12:00", "workMode": "direct", "notes": ""}],
        })

        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(WorkScheduleSheetChange.objects.filter(
            executor_email=self.profile.email,
            work_date=work_date,
            status=WorkScheduleSheetChange.STATUS_PENDING,
        ).exists())

    def test_weekends_and_fixed_holidays_default_to_day_off(self):
        for work_date in ("2026-09-12", "2027-01-01", "2027-04-30", "2027-05-01", "2027-09-02"):
            with self.subTest(work_date=work_date):
                response = self.request("get", f"/api/attendance/timesheet/prefill?date={work_date}")
                self.assertEqual(response.status_code, 200, response.content)
                self.assertTrue(response.json()["defaultDayOff"])
                self.assertEqual(response.json()["shifts"], [])

    @mock.patch("attendance.views.timezone.localdate", return_value=datetime(2026, 9, 14).date())
    def test_busy_weekend_requires_timesheet_and_triggers_yesterday_warning(self, _localdate):
        sunday = datetime(2026, 9, 13).date()
        for order in range(1, 4):
            WorkItem.objects.create(
                creator=self.profile,
                executor=self.profile,
                title=f"Nhiệm vụ cuối tuần {order}",
                work_date=sunday,
                daily_order=order,
            )

        prefill = self.request("get", "/api/attendance/timesheet/prefill")
        sunday_prefill = self.request("get", f"/api/attendance/timesheet/prefill?date={sunday}")
        listing = self.request("get", "/api/attendance/timesheet?month=2026-09&scope=all")

        self.assertEqual(prefill.status_code, 200, prefill.content)
        self.assertTrue(prefill.json()["yesterdayWarning"])
        self.assertFalse(sunday_prefill.json()["defaultDayOff"])
        self.assertIn(
            sunday.isoformat(),
            listing.json()["requiredTimesheetDatesByEmployee"][self.profile.email],
        )

    @mock.patch("attendance.views.timezone.localdate", return_value=datetime(2026, 9, 14).date())
    def test_normal_weekend_stays_day_off_and_does_not_warn(self, _localdate):
        sunday = datetime(2026, 9, 13).date()

        prefill_today = self.request("get", "/api/attendance/timesheet/prefill")
        prefill_sunday = self.request("get", f"/api/attendance/timesheet/prefill?date={sunday}")

        self.assertFalse(prefill_today.json()["yesterdayWarning"])
        self.assertTrue(prefill_sunday.json()["defaultDayOff"])

    def test_weekend_training_session_requires_timesheet(self):
        sunday = datetime(2026, 9, 13).date()
        session = TrainingSession.objects.create(
            title="Tập huấn cuối tuần",
            session_date=sunday,
            status="planned",
        )
        WorkItem.objects.create(
            creator=self.profile,
            executor=self.profile,
            title=session.title,
            work_date=sunday,
            daily_order=1,
            training_session=session,
        )

        prefill = self.request("get", f"/api/attendance/timesheet/prefill?date={sunday}")

        self.assertFalse(prefill.json()["defaultDayOff"])

    def test_edit_log_is_created_only_when_working_times_change(self):
        work_date = timezone.localdate().isoformat()
        initial = {
            "workDate": work_date,
            "isDayOff": False,
            "shifts": [{"start": "09:30", "end": "12:00", "workMode": "direct", "notes": ""}],
        }
        self.assertEqual(self.request("post", "/api/attendance/timesheet/save", initial).status_code, 200)

        same_times = {
            **initial,
            "shifts": [{"start": "09:30", "end": "12:00", "workMode": "online", "notes": "Không tạo log"}],
        }
        unchanged = self.request("post", "/api/attendance/timesheet/save", same_times)
        self.assertEqual(unchanged.status_code, 200, unchanged.content)
        self.assertEqual(TimesheetEditLog.objects.count(), 0)

        changed_times = {
            **initial,
            "shifts": [{"start": "09:00", "end": "12:30", "workMode": "online", "notes": ""}],
        }
        changed = self.request("post", "/api/attendance/timesheet/save", changed_times)
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertEqual(TimesheetEditLog.objects.count(), 1)

    def test_day_off_is_saved_for_only_the_target_employee(self):
        other = UserProfile.objects.create(email="other-day-off@example.com", name="Người khác", role="EMPLOYEE")
        work_date = "2026-09-10"
        response = self.request("post", "/api/attendance/timesheet/save", {
            "workDate": work_date,
            "isDayOff": True,
        })
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(TimesheetEntry.objects.filter(employee=self.profile, work_date=work_date, is_day_off=True).exists())
        self.assertFalse(TimesheetEntry.objects.filter(employee=other, work_date=work_date).exists())

    def test_future_timesheet_cannot_be_created_or_edited_even_by_admin(self):
        future_date = timezone.localdate() + timedelta(days=1)
        existing = TimesheetEntry.objects.create(
            employee=self.profile,
            work_date=future_date,
            shift_number=1,
            shift_start=time(8, 0),
            shift_end=time(12, 0),
            work_mode="direct",
        )
        payload = {
            "workDate": future_date.isoformat(),
            "isDayOff": True,
        }

        employee_response = self.request("post", "/api/attendance/timesheet/save", payload)
        self.profile.role = "ADMIN"
        self.profile.save(update_fields=["role", "updated_at"])
        admin_response = self.request("post", "/api/attendance/timesheet/save", payload)
        prefill = self.request("get", f"/api/attendance/timesheet/prefill?date={future_date}")

        self.assertEqual(employee_response.status_code, 400, employee_response.content)
        self.assertEqual(admin_response.status_code, 400, admin_response.content)
        self.assertIn("tương lai", employee_response.json()["error"])
        self.assertFalse(prefill.json()["canEdit"])
        existing.refresh_from_db()
        self.assertFalse(existing.is_day_off)

    def test_training_summary_is_limited_by_employee_department_and_role(self):
        training = Department.objects.create(name="Phòng Đào tạo số")
        accounting = Department.objects.create(name="Kế toán")
        self.profile.department = training
        self.profile.save(update_fields=["department", "updated_at"])
        self.profile.departments.add(training)
        # Summaries stop at the end of yesterday, so anchor the sessions there.
        counted_day = timezone.localdate() - timedelta(days=1)
        TrainingSession.objects.create(
            title="Buổi giảng", session_date=counted_day, status="completed", instructor_name=self.profile.name,
        )
        TrainingSession.objects.create(
            title="Buổi hỗ trợ", session_date=counted_day, status="planned", support_staff_name=self.profile.name,
        )
        response = self.request("get", f"/api/attendance/timesheet?month={counted_day:%Y-%m}&scope=all")
        self.assertEqual(response.status_code, 200, response.content)
        summaries = response.json()["trainingSummaryByEmployee"]
        self.assertEqual(summaries[self.profile.email], {"instructorSessions": 1, "supportSessions": 1})

        self.profile.role = "ADMIN"
        self.profile.department = accounting
        self.profile.save(update_fields=["role", "department", "updated_at"])
        self.profile.departments.clear()
        self.profile.departments.add(accounting)
        accounting_response = self.request("get", f"/api/attendance/timesheet?month={counted_day:%Y-%m}&scope=all")
        self.assertEqual(accounting_response.json()["trainingSummaryByEmployee"], {})

        self.profile.role = "MANAGER"
        self.profile.department = None
        self.profile.save(update_fields=["role", "department", "updated_at"])
        self.profile.departments.clear()
        leader_response = self.request("get", f"/api/attendance/timesheet?month={counted_day:%Y-%m}&scope=all")
        self.assertEqual(leader_response.json()["trainingSummaryByEmployee"], {})

    def test_training_summary_ignores_today_and_future_sessions(self):
        training = Department.objects.create(name="Phòng Đào tạo số")
        self.profile.department = training
        self.profile.save(update_fields=["department", "updated_at"])
        self.profile.departments.add(training)
        today = timezone.localdate()
        TrainingSession.objects.create(
            title="Buổi hôm nay", session_date=today, status="planned", instructor_name=self.profile.name,
        )
        TrainingSession.objects.create(
            title="Buổi tương lai", session_date=today + timedelta(days=1), status="planned", support_staff_name=self.profile.name,
        )

        response = self.request("get", f"/api/attendance/timesheet?month={today:%Y-%m}&scope=all")

        self.assertEqual(response.status_code, 200, response.content)
        summaries = response.json()["trainingSummaryByEmployee"]
        self.assertEqual(summaries[self.profile.email], {"instructorSessions": 0, "supportSessions": 0})

    def test_summary_hours_stop_at_the_end_of_yesterday(self):
        today = timezone.localdate()
        TimesheetEntry.objects.create(
            employee=self.profile, work_date=today, shift_number=1,
            shift_start=time(8, 0), shift_end=time(12, 0), work_mode="direct",
        )
        counted = TimesheetEntry.objects.create(
            employee=self.profile, work_date=today - timedelta(days=1), shift_number=1,
            shift_start=time(8, 0), shift_end=time(11, 0), work_mode="direct",
        )

        response = self.request("get", f"/api/attendance/timesheet?month={today:%Y-%m}&scope=all")

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        expected = counted.worked_minutes if counted.work_date.month == today.month else 0
        self.assertEqual(body["summary"]["totalMinutes"], expected)
        self.assertEqual(body["summaryCutoff"], (today - timedelta(days=1)).isoformat())

    def test_only_admins_can_delete_a_timesheet_note(self):
        log = TimesheetEditLog.objects.create(
            employee=self.profile, work_date=timezone.localdate(), edited_by=self.profile, note="Ghi chú cần xóa",
        )

        forbidden = self.request("delete", f"/api/attendance/timesheet/log/{log.id}")
        self.assertEqual(forbidden.status_code, 403, forbidden.content)
        self.assertTrue(TimesheetEditLog.objects.filter(pk=log.id).exists())

        self.profile.role = "ADMIN"
        self.profile.save(update_fields=["role", "updated_at"])
        allowed = self.request("delete", f"/api/attendance/timesheet/log/{log.id}")
        self.assertEqual(allowed.status_code, 200, allowed.content)
        self.assertFalse(TimesheetEditLog.objects.filter(pk=log.id).exists())

        missing = self.request("delete", f"/api/attendance/timesheet/log/{log.id}")
        self.assertEqual(missing.status_code, 404, missing.content)
