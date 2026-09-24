import json

from django.core.management.base import BaseCommand

from examination.sheet_scheduler import run_output_exports, run_registration_imports, scan_sheet_changes


class Command(BaseCommand):
    help = 'Run scheduled examination Sheet imports or exports.'

    def add_arguments(self, parser):
        parser.add_argument('--operation', required=True, choices=['registration-import', 'output-export', 'change-scan'])

    def handle(self, *args, **options):
        if options['operation'] == 'registration-import':
            result = run_registration_imports()
        elif options['operation'] == 'output-export':
            result = run_output_exports()
        else:
            result = scan_sheet_changes()
        self.stdout.write(json.dumps(result, ensure_ascii=False))
