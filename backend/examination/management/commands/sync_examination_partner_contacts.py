import json

from django.core.management.base import BaseCommand, CommandError

from examination.candidate_roster_sync import sync_candidate_roster
from examination.partner_contact_sync import sync_partner_contacts


class Command(BaseCommand):
    help = 'Mirror Examination partners and candidate registrations to the shared Google Sheet.'

    def add_arguments(self, parser):
        parser.add_argument('--force', action='store_true')

    def handle(self, *args, **options):
        result = {}
        errors = []
        for label, sync in (('partners', sync_partner_contacts), ('candidates', sync_candidate_roster)):
            try:
                result[label] = sync(force=options['force']) if label == 'partners' else sync()
            except Exception as exc:
                errors.append(f'{label}: {exc}')
        if errors:
            raise CommandError('; '.join(errors))
        self.stdout.write(json.dumps(result, ensure_ascii=False))
