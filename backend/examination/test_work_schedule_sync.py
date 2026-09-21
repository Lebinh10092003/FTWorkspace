from datetime import date
from io import StringIO
from pathlib import Path
from unittest import mock

from django.core.management import call_command
from django.test import TestCase

from authentication.models import Department, UserProfile
from work_schedule.models import WorkItem

from .models import Competition, ExamSession
from .work_schedule_sync import RECORD_PREFIX, planned_entries, sync_examination_work_schedule

TODAY = date(2026, 9, 1)


def a_session(session_id="fieo-2026-2027", competition="fieo", name="Năm học 2026-2027", rounds=None):
    session, _ = ExamSession.objects.update_or_create(
        id=session_id,
        defaults={"competition_id": competition, "code": "FIEO", "name": name,
                  "parent": "", "organizer": "", "time": "", "sort_key": session_id,
                  "rounds": rounds if rounds is not None else []},
    )
    return session


def clear_seeded_exam_data():
    """Migrations ship the real competition catalogue; these tests want a clean
    slate so their assertions count only their own fixtures."""
    ExamSession.objects.all().delete()
    Competition.objects.all().delete()


def a_competition(competition_id, code, name):
    """The migrations ship the real catalogue, so fixtures upsert onto it."""
    competition, _ = Competition.objects.update_or_create(
        id=competition_id,
        defaults={"code": code, "name": name, "parent": name, "organizer": "",
                  "sort_key": competition_id},
    )
    return competition


class ExaminationScheduleTitleTests(TestCase):
    def setUp(self):
        clear_seeded_exam_data()
        a_competition("fieo", "FIEO", "Fermat - International English Olympiad")

    def test_a_single_dated_round_becomes_one_entry(self):
        a_session(rounds=[{"id": "round-final", "name": "Vòng Chung kết Quốc gia",
                           "label": "02/05/2027", "date": "2027-05-02", "slots": []}])
        entries = planned_entries()
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["title"],
                         "Tổ chức Vòng Chung kết Quốc gia Cuộc thi FIEO – Năm học 2026-2027")
        self.assertEqual(entries[0]["date"], date(2027, 5, 2))

    def test_a_round_with_several_đợt_becomes_one_entry_each(self):
        a_session(rounds=[{
            "id": "round-national", "name": "Vòng loại Quốc gia",
            "label": "27/09/2026; 13/12/2026", "date": "2026-09-27",
            "slots": [{"id": "d1", "date": "2026-09-27"}, {"id": "d2", "date": "2026-12-13"}],
        }])
        entries = sorted(planned_entries(), key=lambda entry: entry["date"])
        self.assertEqual([entry["date"] for entry in entries],
                         [date(2026, 9, 27), date(2026, 12, 13)])
        self.assertTrue(entries[0]["title"].endswith("(Đợt 1)"))
        self.assertTrue(entries[1]["title"].endswith("(Đợt 2)"))

    def test_rounds_without_a_date_are_skipped(self):
        a_session(rounds=[{"id": "round-national", "name": "Vòng loại Quốc gia",
                           "label": "", "date": "", "slots": []}])
        self.assertEqual(planned_entries(), [])

    def test_a_session_named_after_its_competition_is_not_repeated(self):
        a_competition("aysbc", "AYSBC", "Asia Young Scientist Badge Competition")
        a_session(session_id="aysbc", competition="aysbc", name="AYSBC",
                  rounds=[{"id": "round-region", "name": "Vòng Khu vực",
                           "label": "", "date": "2026-10-31", "slots": []}])
        titles = [entry["title"] for entry in planned_entries()]
        self.assertIn("Tổ chức Vòng Khu vực Cuộc thi AYSBC", titles)
        self.assertNotIn("Tổ chức Vòng Khu vực Cuộc thi AYSBC – AYSBC", titles)

    def test_each_entry_has_a_stable_identity(self):
        a_session(rounds=[{"id": "round-final", "name": "Vòng Chung kết Quốc gia",
                           "label": "", "date": "2027-05-02", "slots": []}])
        first = planned_entries()[0]["recordId"]
        self.assertTrue(first.startswith(RECORD_PREFIX))
        self.assertEqual(planned_entries()[0]["recordId"], first)


class ExaminationScheduleSyncTests(TestCase):
    def setUp(self):
        clear_seeded_exam_data()
        self.department = Department.objects.create(name="Khảo thí", code="EXAMINATION")
        self.staff = UserProfile.objects.create(email="exam@example.com", name="Exam Staff",
                                                role="EMPLOYEE", access_modules=[])
        self.staff.departments.add(self.department)
        self.outsider = UserProfile.objects.create(email="other@example.com", name="Other",
                                                   role="EMPLOYEE", access_modules=[])
        a_competition("fieo", "FIEO", "Fermat - International English Olympiad")
        self.session = a_session(rounds=[{"id": "round-final", "name": "Vòng Chung kết Quốc gia",
                                          "label": "", "date": "2027-05-02", "slots": []}])

    def items(self, person=None):
        return WorkItem.objects.filter(executor=person or self.staff,
                                       source_record_id__startswith=RECORD_PREFIX)

    def test_the_exam_day_lands_on_the_department_schedule(self):
        sync_examination_work_schedule(today=TODAY)
        item = self.items().get()
        self.assertEqual(item.work_date, date(2027, 5, 2))
        self.assertEqual(item.priority, "high")
        self.assertEqual(item.label, "Khảo thí")
        self.assertIn("Tổ chức Vòng Chung kết Quốc gia Cuộc thi FIEO", item.title)

    def test_people_outside_the_department_get_nothing(self):
        sync_examination_work_schedule(today=TODAY)
        self.assertFalse(self.items(self.outsider).exists())

    def test_running_twice_does_not_duplicate(self):
        sync_examination_work_schedule(today=TODAY)
        sync_examination_work_schedule(today=TODAY)
        self.assertEqual(self.items().count(), 1)

    def test_moving_the_exam_moves_the_schedule_entry(self):
        sync_examination_work_schedule(today=TODAY)
        self.session.rounds = [{"id": "round-final", "name": "Vòng Chung kết Quốc gia",
                                "label": "", "date": "2027-06-13", "slots": []}]
        self.session.save(update_fields=["rounds"])
        sync_examination_work_schedule(today=TODAY)
        self.assertEqual(self.items().get().work_date, date(2027, 6, 13))
        self.assertEqual(self.items().count(), 1)

    def test_renaming_the_round_rewrites_the_title(self):
        sync_examination_work_schedule(today=TODAY)
        self.session.rounds = [{"id": "round-final", "name": "Vòng Chung kết Quốc tế",
                                "label": "", "date": "2027-05-02", "slots": []}]
        self.session.save(update_fields=["rounds"])
        sync_examination_work_schedule(today=TODAY)
        self.assertIn("Vòng Chung kết Quốc tế", self.items().get().title)

    def test_removing_the_round_removes_the_entry(self):
        sync_examination_work_schedule(today=TODAY)
        self.session.rounds = []
        self.session.save(update_fields=["rounds"])
        sync_examination_work_schedule(today=TODAY)
        self.assertFalse(self.items().exists())

    def test_a_persons_own_progress_survives_a_resync(self):
        sync_examination_work_schedule(today=TODAY)
        item = self.items().get()
        item.status = "completed"
        item.progress_note = "Đã chuẩn bị phòng thi"
        item.save(update_fields=["status", "progress_note"])

        self.session.rounds = [{"id": "round-final", "name": "Vòng Chung kết Quốc gia",
                                "label": "", "date": "2027-05-09", "slots": []}]
        self.session.save(update_fields=["rounds"])
        sync_examination_work_schedule(today=TODAY)

        item.refresh_from_db()
        self.assertEqual(item.work_date, date(2027, 5, 9))
        self.assertEqual(item.status, "completed")
        self.assertEqual(item.progress_note, "Đã chuẩn bị phòng thi")

    def test_rows_a_person_wrote_themselves_are_never_touched(self):
        mine = WorkItem.objects.create(creator=self.staff, executor=self.staff,
                                       title="Việc tôi tự ghi", work_date=date(2027, 5, 2))
        self.session.rounds = []
        self.session.save(update_fields=["rounds"])
        sync_examination_work_schedule(today=TODAY)
        mine.refresh_from_db()
        self.assertEqual(mine.title, "Việc tôi tự ghi")

    def test_past_exam_days_are_left_alone(self):
        self.session.rounds = [{"id": "round-old", "name": "Vòng loại Quốc gia",
                                "label": "", "date": "2020-01-01", "slots": []}]
        self.session.save(update_fields=["rounds"])
        sync_examination_work_schedule(today=TODAY)
        self.assertFalse(self.items().exists())

    def test_dry_run_reports_without_writing(self):
        summary = sync_examination_work_schedule(apply=False, today=TODAY)
        self.assertEqual(len(summary["created"]), 1)
        self.assertFalse(self.items().exists())

    def test_the_command_runs_end_to_end(self):
        out = StringIO()
        call_command("sync_examination_work_schedule", "--apply", stdout=out)
        self.assertIn("Đã ghi thay đổi.", out.getvalue())
        self.assertEqual(self.items().count(), 1)


class ExaminationSessionHooksTests(TestCase):
    """Saving a kỳ tổ chức must reach the schedule without waiting for 05:30."""

    def setUp(self):
        clear_seeded_exam_data()
        self.department = Department.objects.create(name="Khảo thí", code="EXAMINATION")
        self.staff = UserProfile.objects.create(email="exam@example.com", name="Exam Staff",
                                                role="EMPLOYEE", access_modules=[])
        self.staff.departments.add(self.department)
        a_competition("fieo", "FIEO", "Fermat - International English Olympiad")

    def refresh_calls(self):
        return mock.patch("examination.views.sync_examination_work_schedule")

    def test_the_helper_is_wired_into_create_update_and_delete(self):
        source = (Path(__file__).resolve().parent / "views.py").read_text(encoding="utf-8")
        # One definition plus the three save paths.
        self.assertEqual(source.count("_refresh_examination_work_schedule"), 4, source.count(
            "_refresh_examination_work_schedule"))

    def test_a_failure_does_not_break_the_exam_save(self):
        with mock.patch("examination.work_schedule_sync.sync_examination_work_schedule",
                        side_effect=RuntimeError("sheet down")):
            # The helper swallows the failure; the caller carries on.
            from examination.views import _refresh_examination_work_schedule
            _refresh_examination_work_schedule()


class RenameScoCompetitionsTests(TestCase):
    def setUp(self):
        clear_seeded_exam_data()
        for code, name in [
            ("IEO", "International English Olympiad"),
            ("IMO", "International Math Olympiad"),
            ("FIEO", "Fermat - International English Olympiad"),
            ("AYSBC", "Asia Young Scientist Badge Competition"),
            ("SIEO", "SCO International English Olympiad"),
        ]:
            a_competition(code.lower(), code, name)

    def run_command(self, *args):
        out = StringIO()
        call_command("rename_sco_competitions", *args, stdout=out)
        return out.getvalue()

    def test_dry_run_changes_nothing(self):
        self.run_command()
        self.assertTrue(Competition.objects.filter(code="IEO").exists())

    def test_it_renames_only_the_international_family(self):
        self.run_command("--apply")
        self.assertEqual(Competition.objects.get(pk="ieo").code, "SIEO")
        self.assertEqual(Competition.objects.get(pk="ieo").name, "SCO International English Olympiad")
        self.assertEqual(Competition.objects.get(pk="imo").code, "SIMO")
        # Fermat family and AYSBC keep their names.
        self.assertEqual(Competition.objects.get(pk="fieo").code, "FIEO")
        self.assertEqual(Competition.objects.get(pk="aysbc").code, "AYSBC")

    def test_an_already_renamed_competition_is_skipped(self):
        self.run_command("--apply")
        self.assertEqual(Competition.objects.get(pk="sieo").code, "SIEO")
        self.assertEqual(Competition.objects.get(pk="sieo").name, "SCO International English Olympiad")

    def test_running_twice_does_not_double_the_prefix(self):
        self.run_command("--apply")
        self.run_command("--apply")
        self.assertEqual(Competition.objects.get(pk="imo").code, "SIMO")
        self.assertEqual(Competition.objects.get(pk="imo").name, "SCO International Math Olympiad")

    def test_only_narrows_the_scope(self):
        self.run_command("--apply", "--only", "IMO")
        self.assertEqual(Competition.objects.get(pk="imo").code, "SIMO")
        self.assertEqual(Competition.objects.get(pk="ieo").code, "IEO")

    def test_a_running_session_follows_the_new_competition_name(self):
        a_session(session_id="imo-2026", competition="imo", name="Năm học 2026-2027")
        ExamSession.objects.filter(pk="imo-2026").update(
            parent="International Math Olympiad", phase="Vòng loại Quốc gia")
        self.run_command("--apply")
        self.assertEqual(ExamSession.objects.get(pk="imo-2026").parent, "SCO International Math Olympiad")

    def test_a_finished_session_keeps_the_name_it_was_held_under(self):
        a_session(session_id="imo-2025", competition="imo", name="Năm học 2025-2026")
        ExamSession.objects.filter(pk="imo-2025").update(
            parent="International Math Olympiad", phase="Hoàn thành")
        self.run_command("--apply")
        # The competition itself moves on, the record of the past kỳ does not.
        self.assertEqual(Competition.objects.get(pk="imo").code, "SIMO")
        self.assertEqual(ExamSession.objects.get(pk="imo-2025").parent, "International Math Olympiad")

    def test_finished_and_running_sessions_of_one_competition_diverge(self):
        a_session(session_id="imo-2025", competition="imo", name="Năm học 2025-2026")
        a_session(session_id="imo-2026", competition="imo", name="Năm học 2026-2027")
        ExamSession.objects.filter(pk="imo-2025").update(
            parent="International Math Olympiad", phase="Hoàn thành")
        ExamSession.objects.filter(pk="imo-2026").update(
            parent="International Math Olympiad", phase="Chuẩn bị/Truyền thông")
        self.run_command("--apply")
        self.assertEqual(ExamSession.objects.get(pk="imo-2025").parent, "International Math Olympiad")
        self.assertEqual(ExamSession.objects.get(pk="imo-2026").parent, "SCO International Math Olympiad")

    def test_the_phase_check_ignores_case_and_accents(self):
        a_session(session_id="imo-2025", competition="imo", name="Năm học 2025-2026")
        ExamSession.objects.filter(pk="imo-2025").update(
            parent="International Math Olympiad", phase="HOÀN THÀNH")
        self.run_command("--apply")
        self.assertEqual(ExamSession.objects.get(pk="imo-2025").parent, "International Math Olympiad")


class SetExamRoundDateTests(TestCase):
    def setUp(self):
        clear_seeded_exam_data()
        a_competition("fimo", "FIMO", "Fermat - International Mathematic Olympiad")
        self.session = a_session(session_id="fimo-2026-2027", competition="fimo", rounds=[{
            "id": "round-national", "name": "Vòng loại Quốc gia",
            "label": "20/09/2026; 06/12/2026; 28/02/2027", "date": "2026-09-20",
            "slots": [{"id": "d1", "date": "2026-09-20"}, {"id": "d2", "date": "2026-12-06"},
                      {"id": "d3", "date": "2027-02-28"}],
        }])

    def run_command(self, *args):
        out = StringIO()
        call_command("set_exam_round_date", *args, stdout=out)
        return out.getvalue()

    def test_it_moves_the_chosen_đợt_and_rebuilds_the_label(self):
        self.run_command("--session", "fimo-2026-2027", "--round", "round-national",
                         "--batch", "1", "--date", "2026-10-11", "--apply")
        round_data = ExamSession.objects.get(pk="fimo-2026-2027").rounds[0]
        self.assertEqual(round_data["slots"][0]["date"], "2026-10-11")
        self.assertEqual(round_data["date"], "2026-10-11")
        self.assertEqual(round_data["label"], "11/10/2026; 06/12/2026; 28/02/2027")

    def test_the_other_đợt_are_untouched(self):
        self.run_command("--session", "fimo-2026-2027", "--round", "round-national",
                         "--batch", "1", "--date", "2026-10-11", "--apply")
        slots = ExamSession.objects.get(pk="fimo-2026-2027").rounds[0]["slots"]
        self.assertEqual([slot["date"] for slot in slots[1:]], ["2026-12-06", "2027-02-28"])

    def test_dry_run_changes_nothing(self):
        self.run_command("--session", "fimo-2026-2027", "--round", "round-national",
                         "--batch", "1", "--date", "2026-10-11")
        self.assertEqual(ExamSession.objects.get(pk="fimo-2026-2027").rounds[0]["date"], "2026-09-20")

    def test_it_accepts_a_vietnamese_date(self):
        self.run_command("--session", "fimo-2026-2027", "--round", "round-national",
                         "--batch", "1", "--date", "11/10/2026", "--apply")
        self.assertEqual(ExamSession.objects.get(pk="fimo-2026-2027").rounds[0]["date"], "2026-10-11")

    def test_an_unknown_round_is_refused(self):
        with self.assertRaises(Exception):
            self.run_command("--session", "fimo-2026-2027", "--round", "nope",
                             "--date", "2026-10-11", "--apply")

    def test_a_đợt_beyond_the_round_is_refused(self):
        with self.assertRaises(Exception):
            self.run_command("--session", "fimo-2026-2027", "--round", "round-national",
                             "--batch", "9", "--date", "2026-10-11", "--apply")
