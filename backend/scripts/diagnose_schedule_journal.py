"""Print only anonymous error categories and application code locations."""
import re
import subprocess
from collections import Counter
from pathlib import Path

args = ["journalctl", "-u", "workspace-django.service", "--since", "48 hours ago", "--no-pager", "-n", "20000"]
result = subprocess.run(args, capture_output=True, text=True)
if result.returncode or not result.stdout.strip():
    result = subprocess.run(["sudo", "-n", *args], capture_output=True, text=True)
if result.returncode:
    print("Journal access unavailable")
else:
    log = result.stdout
    print("Exception type counts", dict(Counter(re.findall(r"\b([A-Za-z]+Error):", log))))
    for label, marker in [("Database lock error count", "database is locked"), ("Worker timeout count", "WORKER TIMEOUT"), ("Out of memory count", "out of memory")]:
        print(label, log.lower().count(marker.lower()))
    frames = re.findall(r'File "(/var/www/ft-workspace/[^"\n]+\.py)", line (\d+), in (\w+)', log)
    print("Application stack locations", dict(Counter(f"{Path(file).name}:{line}:{function}" for file, line, function in frames)))
    paths = ["/api/work-schedule/day", "/api/work-schedule/items", "/api/attendance"]
    counts = Counter()
    for line in log.splitlines():
        for path in paths:
            if path in line and re.search(r'HTTP/\d(?:\.\d)?"\s+5\d\d\b', line):
                counts[path] += 1
    print("HTTP 5xx counts by known endpoint", dict(counts))
