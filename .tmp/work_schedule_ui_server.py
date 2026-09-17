import os, sys, time, json
from pathlib import Path
from wsgiref.simple_server import make_server, WSGIServer
from socketserver import ThreadingMixIn
root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "backend"))
os.environ.update(DJANGO_SETTINGS_MODULE="config.settings", DJANGO_DB_PATH=str(root / ".tmp/work_schedule_ui.sqlite3"), DJANGO_DEBUG="true", DJANGO_ALLOWED_HOSTS="localhost,127.0.0.1", WORK_SCHEDULE_TRAINING_PROJECTION_ENABLED="false")
import django
django.setup()
from django.core.management import call_command
from django.contrib.auth import get_user_model
from django.utils import timezone
from authentication.models import UserProfile
from work_schedule.models import WorkItem
from work_schedule import signals
signals.launch_sheet_sync_worker = lambda: None
call_command("migrate", interactive=False, verbosity=0)
for email, role, name in [("ui.manager@example.com", "MANAGER", "Quản lý kiểm thử"), ("ui.employee@example.com", "EMPLOYEE", "Nhân sự kiểm thử")]:
    user, created = get_user_model().objects.get_or_create(username=email, defaults={"email":email})
    if created:
        user.set_password("TestOnlyPass9921")
        user.save()
    UserProfile.objects.update_or_create(email=email, defaults={"name":name,"role":role,"access_modules":["attendance", "work-schedule"]})
manager = UserProfile.objects.get(email="ui.manager@example.com")
employee = UserProfile.objects.get(email="ui.employee@example.com")
employee.manager=manager
employee.save()
if not WorkItem.objects.filter(executor=employee).exists():
    for index, title in enumerate(["17h00: Kiểm thử nhiệm vụ quan trọng", "Công việc thông thường"],1):
        WorkItem.objects.create(creator=employee, executor=employee, title=title, work_date=timezone.localdate(), daily_order=index, priority="high" if index==1 else "medium", time_prefix_in_title=index==1, start_time=__import__("datetime").time(17) if index==1 else None)
from django.core.wsgi import get_wsgi_application
app = get_wsgi_application()
flags_path=root / ".tmp/ui-faults.json"
def application(environ, start_response):
    flags=json.loads(flags_path.read_text()) if flags_path.exists() else {}
    path=environ.get("PATH_INFO", "")
    if path == "/api/work-schedule/day" and environ["REQUEST_METHOD"] == "POST":
        time.sleep(flags.get("saveDelay",0))
    if path == "/api/attendance/timesheet/prefill":
        time.sleep(flags.get("prefillDelay",0))
    if flags.get("teamFail") and path == "/api/work-schedule/team":
        start_response("503 Service Unavailable", [("Content-Type","application/json")])
        return [b'{"error":"Test: refresh temporarily failed"}']
    if flags.get("saveFail") and path == "/api/work-schedule/day":
        start_response("503 Service Unavailable", [("Content-Type","application/json")])
        return [b'{"error":"Test: save temporarily failed"}']
    captured=[]
    def capture(status,headers,exc_info=None):
        captured.append(status)
        return start_response(status,headers,exc_info)
    result=app(environ,capture)
    if path == "/api/work-schedule/day":
        print("DAY_RESPONSE", captured, flush=True)
    return result
class ThreadedServer(ThreadingMixIn, WSGIServer):
    daemon_threads=True
print("LOCAL_UI_TEST_SERVER_READY 8002",flush=True)
make_server("127.0.0.1",8002,application,server_class=ThreadedServer).serve_forever()
