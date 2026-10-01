import json

from django.core.management.base import BaseCommand
from work_schedule.models import WorkItem


class Command(BaseCommand):
    help = 'Detach training links for all staff while preserving every work item and assessment.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        linked = WorkItem.objects.filter(training_session__isnull=False)
        result = {'employees': linked.values('executor_id').distinct().count(),
                  'mirrorsRemoved': 0, 'linksDetached': linked.count(),
                  'applied': options['apply']}
        if options['apply']:
            # A link alone cannot establish that a task is disposable. Linked
            # tasks may contain independent Sheet edits and manager reviews.
            linked.update(training_session=None)
        self.stdout.write(json.dumps(result, ensure_ascii=False))
