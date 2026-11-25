from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from authentication.models import UserProfile
from work_schedule.models import WorkItem
from work_schedule.sheet_sync import _build_content_format_runs


class FimoFieoReportTaskTests(TestCase):
    def setUp(self):
        # Provisioned by authentication migration 0002.
        self.executor, _ = UserProfile.objects.get_or_create(email='phongnt@fermat.edu.vn', defaults={'name': 'Phong NT', 'role': 'ADMIN'})

    def test_dry_run_then_apply_creates_medium_unbolded_tasks_once(self):
        before = set(WorkItem.objects.values_list('id', flat=True))
        ours = lambda: WorkItem.objects.filter(executor=self.executor).exclude(id__in=before)
        out = StringIO()
        call_command('add_fimo_fieo_report_tasks', stdout=out)
        self.assertFalse(ours().exists(), 'dry run writes nothing')
        self.assertIn('CHẠY THỬ', out.getvalue())
        call_command('add_fimo_fieo_report_tasks', '--apply', stdout=StringIO())
        items = list(ours().order_by('work_date', 'daily_order'))
        self.assertEqual(len(items), 10)  # bảng theo dõi + 21h 25/11 + 2 × 26–29/11
        self.assertEqual({item.priority for item in items}, {'medium'})
        timed = [item for item in items if item.start_time]
        self.assertEqual(len(timed), 9)
        self.assertEqual({item.start_time.hour for item in timed}, {9, 21})
        self.assertEqual(str(items[-1].work_date), '2026-11-29')
        # Xuất ra Sheet: không có đoạn chữ nào in đậm dù tiêu đề có giờ.
        for date in {item.work_date for item in items}:
            day = list(WorkItem.objects.filter(executor=self.executor, work_date=date).order_by('daily_order'))
            content = '\n'.join(f'{index}. {item.title}' for index, item in enumerate(day, start=1))
            runs = _build_content_format_runs(content, day)
            self.assertFalse(any(run['format'].get('bold') for run in runs), (date, runs))
        call_command('add_fimo_fieo_report_tasks', '--apply', stdout=StringIO())
        self.assertEqual(ours().count(), 10, 'running again creates no duplicate')
