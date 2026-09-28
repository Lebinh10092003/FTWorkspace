import json

from django.core.management.base import BaseCommand, CommandError

from examination.partner_contact_sync import sync_partner_contacts


class Command(BaseCommand):
    help = 'Mirror current Examination partners to the teacher contact Google Sheet tab.'

    def add_arguments(self, parser):
        parser.add_argument('--force', action='store_true')

    def handle(self, *args, **options):
        try:
            result = sync_partner_contacts(force=options['force'])
        except Exception as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(json.dumps(result, ensure_ascii=False))
