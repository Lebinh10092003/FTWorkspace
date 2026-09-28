from django.core.management.base import BaseCommand

from examination.public_registration_sheet import sync_pending


class Command(BaseCommand):
    help = 'Export public Workspace registrations into the original 2026–2027 Form workbook.'

    def handle(self, *args, **options):
        result = sync_pending()
        self.stdout.write(f"Đồng bộ Sheet: {result['synced']} thành công, {result['failed']} lỗi.")
