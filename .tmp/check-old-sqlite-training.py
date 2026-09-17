import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path.cwd() / "backend"))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from django.conf import settings
settings.DATABASES["default"]["ENGINE"] = "django.db.backends.sqlite3"
settings.REST_FRAMEWORK.pop("EXCEPTION_HANDLER", None)
from django.core.management import call_command
call_command("test", "digital_training.tests.TrainingAssessmentTests.test_variant_assignment_stays_balanced_behind_one_link", interactive=False)
