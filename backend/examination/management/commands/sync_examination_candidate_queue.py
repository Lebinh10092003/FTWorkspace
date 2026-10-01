import json

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count

from examination.candidate_sheet_queue import drain_candidate_sheet_queue
from examination.session_sheet_queue import drain_session_sheet_queue
from examination.models import CandidateSheetOutbox, SessionSheetOutbox


class Command(BaseCommand):
    help = 'Drain pending candidate exports to the shared Google Sheet.'

    def add_arguments(self, parser):
        parser.add_argument('--audit-only', action='store_true')

    def handle(self, *args, **options):
        results = {}
        errors = []
        if not options['audit_only']:
            try:
                results['contacts'] = drain_candidate_sheet_queue()
            except Exception as exc:
                errors.append(str(exc))
            results['sessions'] = drain_session_sheet_queue()
        results['remaining'] = {
            'contacts': CandidateSheetOutbox.objects.count(),
            'sessions': SessionSheetOutbox.objects.count(),
            'bySession': list(SessionSheetOutbox.objects.values('session_id').annotate(jobs=Count('pk')).order_by('session_id')),
        }
        self.stdout.write(json.dumps(results, ensure_ascii=False))
        if errors or results.get('sessions', {}).get('failed'):
            raise CommandError('; '.join(errors) or 'Session Sheet queue has failed jobs; retained for retry.')
