import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, time, timedelta


TASK_TAGS = re.compile(r"^\s*(?:\[\s*(?:hỗ\s+trợ|(?:lịch|việc)\s+cá\s+nhân)\s*\]\s*)+", re.IGNORECASE)
# Staff write both "lịch cá nhân" and "việc cá nhân" (often in parentheses);
# both mark a personal task that must never be emphasized.
PERSONAL_PHRASE = re.compile(r"(?<!\w)(?:lịch|việc)\s+(?:cá\s+nhân|riêng)(?!\w)", re.IGNORECASE)


def is_personal_task(value: str) -> bool:
    # Some keyboards emit decomposed Vietnamese (e.g. "a" + U+0301), which
    # would otherwise slip past the precomposed pattern above.
    return bool(PERSONAL_PHRASE.search(unicodedata.normalize("NFC", str(value or ""))))


def without_task_tags(value: str) -> str:
    return TASK_TAGS.sub("", str(value or ""), count=1)


NUMBERED_LINE = re.compile(r"^\s*(\d{1,3})\s*[.,)]\s*(.*?)(?:\s*)$")
LEADING_TIME = re.compile(
    r"^\s*(\d{1,2})(?:\s*[hH]\s*(\d{1,2})?|\s*:\s*(\d{2}))(?:\s*[:;,.\-]\s*|\s+)(.+)$",
    re.DOTALL,
)
LEADING_TIME_RANGE = re.compile(
    r"^\s*(\d{1,2})(?:\s*[hH]\s*(\d{1,2})?|\s*:\s*(\d{2}))"
    r"\s*[-–—]\s*(\d{1,2})(?:\s*[hH]\s*(\d{1,2})?|\s*:\s*(\d{2}))"
    r"(?:\s*[:;,.\-]\s*|\s+)?(.*)$",
    re.DOTALL,
)


@dataclass(frozen=True)
class ParsedSheetTask:
    source_number: int
    title: str
    start_time: time | None
    end_time: time | None
    has_time_prefix: bool


def split_numbered_tasks(value: str) -> list[tuple[int, str]]:
    """Split a Sheet cell into tasks while retaining wrapped continuation lines.

    Sheet numbers are treated as visual markers only. Duplicate or skipped numbers
    are accepted and occurrence order remains authoritative.
    """
    entries: list[tuple[int, list[str]]] = []
    for raw_line in str(value or "").replace("\r\n", "\n").split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        match = NUMBERED_LINE.match(line)
        if match and match.group(2).strip():
            entries.append((int(match.group(1)), [match.group(2).strip()]))
        elif entries:
            entries[-1][1].append(line)
        else:
            entries.append((1, [line]))
    return [(number, "\n".join(parts).strip()) for number, parts in entries if "\n".join(parts).strip()]


def parse_sheet_tasks(value: str) -> list[ParsedSheetTask]:
    result: list[ParsedSheetTask] = []
    for number, raw_title in split_numbered_tasks(value):
        start = None
        end = None
        title = raw_title.strip()
        timed_title = without_task_tags(title)
        range_match = LEADING_TIME_RANGE.match(timed_title)
        match = range_match or LEADING_TIME.match(timed_title)
        if range_match:
            hour = int(range_match.group(1))
            minute = int(range_match.group(2) or range_match.group(3) or 0)
            end_hour = int(range_match.group(4))
            end_minute = int(range_match.group(5) or range_match.group(6) or 0)
            if 0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= end_hour <= 23 and 0 <= end_minute <= 59:
                start = time(hour, minute)
                end = time(end_hour, end_minute)
        elif match:
            hour = int(match.group(1))
            minute = int(match.group(2) or match.group(3) or 0)
            if 0 <= hour <= 23 and 0 <= minute <= 59:
                start = time(hour, minute)
        # The title is intentionally kept verbatim. Parsed times are metadata;
        # they must never be used to rewrite what the user typed in the cell.
        result.append(ParsedSheetTask(number, title, start, end, start is not None))
    return result


def assessment_notes(value: str, task_count: int) -> list[str]:
    raw = str(value or "").strip()
    if not raw:
        return [""] * task_count
    if NUMBERED_LINE.match(raw.splitlines()[0].strip()):
        entries: list[tuple[int, list[str]]] = []
        for raw_line in raw.replace("\r\n", "\n").split("\n"):
            line = raw_line.strip()
            match = NUMBERED_LINE.match(line)
            if match:
                entries.append((int(match.group(1)), [match.group(2).strip()]))
            elif line and entries:
                entries[-1][1].append(line)
        notes = [""] * task_count
        fallback = 0
        for number, parts in entries:
            note = "\n".join(parts).strip()
            if 1 <= number <= task_count and not notes[number - 1]:
                notes[number - 1] = note
                continue
            while fallback < task_count and notes[fallback]:
                fallback += 1
            if fallback < task_count:
                notes[fallback] = note
        return notes
    return [raw] * task_count


def status_from_note(note: str, is_future: bool) -> str:
    normalized = " ".join(str(note or "").strip().lower().split())
    if normalized in {"hoàn thành", "xong", "đã hoàn thành"}:
        return "completed"
    if normalized in {"cần làm", "chưa làm"}:
        return "todo"
    if normalized in {"đang làm", "đang thực hiện"} or normalized:
        return "doing"
    return "todo" if is_future else "doing"


def training_end(start: time | None) -> time | None:
    if not start:
        return None
    return (datetime.combine(datetime.min.date(), start) + timedelta(hours=3)).time()


def leader_assessment_notes(value: str, task_count: int) -> list[str]:
    """Map explicit review numbers without assigning invalid numbers elsewhere."""
    raw = str(value or "").strip()
    notes = [""] * task_count
    if not raw:
        return notes
    entries = []
    current = None
    for line in raw.splitlines():
        match = re.match(r"^\s*(\d{1,3})(?:\s*[.,):\-]\s*|\s+)(.*)$", line)
        if match:
            current = (int(match.group(1)), [match.group(2).strip()])
            entries.append(current)
        elif current and line.strip():
            current[1].append(line.strip())
    if not entries:
        return [raw] * task_count
    for number, parts in entries:
        if 1 <= number <= task_count:
            note = "\n".join(parts).strip()
            notes[number - 1] = "\n".join(filter(None, [notes[number - 1], note]))
    return notes


def parse_leader_review(note: str) -> tuple[int, str]:
    match = re.match(r"^\s*(\d{1,3})\s*%\s*(?:[·:\-]\s*)?(.*)$", note, re.DOTALL)
    if match:
        percent = int(match.group(1))
        if percent > 100:
            raise ValueError("Mức độ hoàn thành phải từ 0 đến 100%.")
        return percent, match.group(2).strip()
    return 100, note.strip()
