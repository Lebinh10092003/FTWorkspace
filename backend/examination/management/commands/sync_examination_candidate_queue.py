import json

from django.core.management.base import BaseCommand, CommandError

from examination.candidate_sheet_queue import drain_candidate_sheet_queue
from examination.session_sheet_queue import drain_session_sheet_queue


class Command(BaseCommand):
    help = 'Drain pending candidate exports to the shared Google Sheet.'

    def handle(self, *args, **options):
        results = {}
        errors = []
        try:
            results['contacts'] = drain_candidate_sheet_queue()
        except Exception as exc:
            errors.append(str(exc))
        results['sessions'] = drain_session_sheet_queue()
        self.stdout.write(json.dumps(results, ensure_ascii=False))
        if errors or results['sessions']['failed']:
            raise CommandError('; '.join(errors) or 'Session Sheet queue has failed jobs; retained for retry.')
