from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from .models import ExamSession


def session(pk, code, rounds, phase='Tuyển sinh'):
    return ExamSession.objects.create(id=pk, competition_id=code, code=code, name=pk, parent=code,
                                      organizer='Test', time='', sort_key=pk, phase=phase, rounds=rounds)


class SetRegistrationFeesTests(TestCase):
    def test_fills_only_empty_fees_by_programme_rule(self):
        sco = session('sco-test', 'SIZZO', [{'id': 'a', 'name': 'Vòng loại Quốc gia'},
                                            {'id': 'b', 'name': 'Vòng Chung kết Quốc gia', 'fee': 500000},
                                            {'id': 'c', 'name': 'Vòng Chung kết Quốc tế'}])
        single = session('single-test', 'SIZZL', [{'id': 'a', 'name': 'Vòng thi Quốc gia duy nhất'}])
        fimo = ExamSession.objects.get(pk='fimo-2026-2027') if ExamSession.objects.filter(pk='fimo-2026-2027').exists() else session(
            'fimo-2026-2027', 'FIMO', [])
        ExamSession.objects.filter(pk=fimo.pk).update(phase='Tuyển sinh', rounds=[
            {'id': 'q', 'name': 'Vòng loại Quốc gia', 'slots': [{'id': 's1', 'date': '2026-10-11'}, {'id': 's2', 'date': '2026-12-06'}, {'id': 's3', 'date': '2027-01-01'}]},
            {'id': 'f', 'name': 'Vòng Chung kết Quốc gia'}, {'id': 'i', 'name': 'Vòng Chung kết Quốc tế'}])
        other = session('aysbc-test', 'AYSBC', [{'id': 'a', 'name': 'Vòng Quốc gia'}])
        call_command('set_registration_fees', stdout=StringIO())
        sco.refresh_from_db()
        self.assertNotIn('fee', sco.rounds[0])
        call_command('set_registration_fees', '--apply', stdout=StringIO())
        for item in (sco, single, fimo, other):
            item.refresh_from_db()
        self.assertEqual([item.get('fee') for item in sco.rounds], [250000, 500000, 0])
        self.assertEqual(single.rounds[0]['fee'], 450000)
        self.assertEqual([item.get('fee') for item in fimo.rounds], [250000, 450000, None])
        self.assertEqual([slot.get('registrationDeadline') for slot in fimo.rounds[0]['slots']], ['2026-10-04', '2026-11-29', None])
        self.assertNotIn('fee', other.rounds[0])
