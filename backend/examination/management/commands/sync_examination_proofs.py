import json
from django.core.management.base import BaseCommand
from examination.proof_archive import archive_pending


class Command(BaseCommand):
    help = 'Archive private payment images to their configured competition/session Drive folder.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100)

    def handle(self, *args, **options):
        self.stdout.write(json.dumps(archive_pending(limit=max(1, min(options['limit'], 1000)))))
