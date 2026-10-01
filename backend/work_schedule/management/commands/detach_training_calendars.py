import json

from django.core.management.base import BaseCommand
from django.db import transaction

from work_schedule.models import WorkItem
from work_schedule.training_sync import _normalise_orders


class Command(BaseCommand):
    help = 'Audit all staff and remove legacy training calendar projections from their work schedules.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        linked = WorkItem.objects.filter(training_session__isnull=False)
        mirrors = linked.exclude(training_session__source='work_schedule')
        result = {'employees': linked.values('executor_id').distinct().count(),
                  'mirrorsRemoved': mirrors.count(), 'linksDetached': linked.filter(training_session__source='work_schedule').count(),
                  'applied': options['apply']}
        if options['apply']:
            with transaction.atomic():
                groups = set(mirrors.values_list('executor_id', 'work_date'))
                # Deleting the projection queues removal from the work Sheet;
                # the original TrainingSession remains in its own calendar.
                mirrors.delete()
                linked.update(training_session=None)
                for group in groups:
                    _normalise_orders(*group)
        self.stdout.write(json.dumps(result, ensure_ascii=False))
