import json

from django.core.management.base import BaseCommand

from authentication.notifications import purge_read_workspace_notifications
from digital_training.assessment_lifecycle import run_assessment_lifecycle
from digital_training.product_lifecycle import run_product_subscription_lifecycle


class Command(BaseCommand):
    help = "Maintain assessment retention and product subscription expiry notifications."

    def handle(self, *args, **options):
        self.stdout.write(json.dumps({
            "assessments": run_assessment_lifecycle(),
            "products": run_product_subscription_lifecycle(),
            "notifications": purge_read_workspace_notifications(),
        }, ensure_ascii=False))
