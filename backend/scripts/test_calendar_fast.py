"""Run full domain tests with fast, test-only password hashing."""
import os
import sys
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
test_temp = Path(__file__).resolve().parents[2] / '.test-temp'
test_temp.mkdir(exist_ok=True)
tempfile.tempdir = str(test_temp)
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
labels = sys.argv[1:] or ['examination', 'attendance', 'work_schedule']
sys.argv = ['manage.py', 'test']
import django
from django.conf import settings
settings.PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
django.setup()
from django.core.management import call_command
call_command('test', *labels, interactive=False)
