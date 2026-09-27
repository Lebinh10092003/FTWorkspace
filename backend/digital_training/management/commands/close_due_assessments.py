from django.core.management.base import BaseCommand

from digital_training.assessment_lifecycle import close_due_assessments


class Command(BaseCommand):
    help = "Close published assessments as soon as their scheduled end time is due."

    def handle(self, *args, **options):
        self.stdout.write(f"Closed {close_due_assessments()} due assessment(s).")
