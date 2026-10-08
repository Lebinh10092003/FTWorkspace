import json

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count

from examination.candidate_sheet_queue import drain_candidate_sheet_queue
from examination.candidate_roster_sync import LAYOUT_VERSION, SYNC_CONFIG_KEY, audit_candidate_roster, sync_candidate_roster
from authentication.models import SystemConfig
from examination.session_sheet_queue import drain_session_sheet_queue
from examination.invigilation import drain_invigilation_sheet_queue
from examination.models import CandidateSheetOutbox, SessionSheetOutbox
from examination.public_registration_sheet import sync_pending


class Command(BaseCommand):
    help = 'Drain pending candidate exports to the shared Google Sheet.'

    def add_arguments(self, parser):
        parser.add_argument('--audit-only', action='store_true')
        parser.add_argument('--verify-roster', action='store_true')

    def handle(self, *args, **options):
        results = {}
        errors = []
        if not options['audit_only']:
            try:
                results['invigilation'] = drain_invigilation_sheet_queue()
            except Exception as exc:
                results['invigilation'] = {'failed': 1, 'error': str(exc)}
            try:
                config = SystemConfig.objects.filter(key=SYNC_CONFIG_KEY).first()
                if not config or (config.data or {}).get('layoutVersion') != LAYOUT_VERSION:
                    results['roster'] = sync_candidate_roster(force=True)
                results['contacts'] = drain_candidate_sheet_queue()
            except Exception as exc:
                errors.append(str(exc))
            results['sessions'] = drain_session_sheet_queue()
            results['registrationRefresh'] = sync_pending(refresh_only=True)
        if options['verify_roster']:
            results['rosterAudit'] = audit_candidate_roster()
        results['remaining'] = {
            'contacts': CandidateSheetOutbox.objects.count(),
            'sessions': SessionSheetOutbox.objects.count(),
            'bySession': list(SessionSheetOutbox.objects.values('session_id').annotate(jobs=Count('pk')).order_by('session_id')),
        }
        self.stdout.write(json.dumps(results, ensure_ascii=False))
        if errors or results.get('sessions', {}).get('failed') or results.get('registrationRefresh', {}).get('failed'):
            raise CommandError('; '.join(errors) or 'Session Sheet queue has failed jobs; retained for retry.')
