import json

from django.core.management.base import BaseCommand

from examination.partner_contact_sync import sync_partner_contacts


class Command(BaseCommand):
    help = 'Mirror Examination partners to the shared Google Sheet.'

    def add_arguments(self, parser):
        parser.add_argument('--force', action='store_true')

    def handle(self, *args, **options):
        self.stdout.write(json.dumps(sync_partner_contacts(force=options['force']), ensure_ascii=False))
