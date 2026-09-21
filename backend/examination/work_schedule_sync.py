"""Puts the exam calendar on the work schedule of the Khảo thí department.

Every dated round of every exam session becomes one high-priority work item for
each member of the department, so organisers see the competition days in Lịch
làm việc without copying them across by hand. Move a round and the item moves
with it; drop the round and the item goes.

Only rows this module created are ever touched. They are tagged through
``source_record_id`` with the REC-EXAM- prefix, so anything a person wrote
themselves is left exactly as it is — including a row that happens to describe
the same day.

A person's own edits to a generated row survive a re-sync: status, progress
note and the leader's review are theirs. The date, the title and the priority
are owned here, because those are what the exam calendar decides.
"""
import hashlib
import re
import unicodedata
from datetime import date, datetime

from django.db.models import Max

from authentication.models import UserProfile
from work_schedule.models import WorkItem

from .models import Competition, ExamSession

DEPARTMENT_CODE = "EXAMINATION"
DEPARTMENT_NAME = "Khảo thí"
LABEL = "Khảo thí"
RECORD_PREFIX = "REC-EXAM-"
PRIORITY = "high"
MAX_RECORD_ID = 100


def _normalise(value):
    plain = "".join(
        char for char in unicodedata.normalize("NFD", str(value or "").casefold())
        if unicodedata.category(char) != "Mn"
    ).replace("đ", "d")
    return " ".join(plain.split())


def examination_staff():
    """Active members of Khảo thí, matched by department code or by name."""
    by_code = UserProfile.objects.filter(
        departments__code__iexact=DEPARTMENT_CODE, employment_status="ACTIVE"
    )
    by_name = UserProfile.objects.filter(
        departments__name__iexact=DEPARTMENT_NAME, employment_status="ACTIVE"
    )
    return list((by_code | by_name).distinct().order_by("email"))


def _parse_date(value):
    text = str(value or "").strip()
    if not text:
        return None
    for pattern in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    return None


def _record_id(session_id, round_id, index):
    raw = f"{RECORD_PREFIX}{session_id}-{round_id}-{index}"
    if len(raw) <= MAX_RECORD_ID:
        return raw
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]
    return f"{RECORD_PREFIX}{digest}"


def _competition_label(session, competitions):
    competition = competitions.get(session.competition_id)
    code = (competition.code if competition else "").strip()
    return code or (competition.name if competition else "").strip() or session.competition_id


def _title(round_name, competition, session_name, batch=None):
    parts = [f"Tổ chức {round_name}".strip(), f"Cuộc thi {competition}".strip()]
    title = " ".join(parts)
    # Some kỳ tổ chức are named after the competition itself, which would read
    # "Cuộc thi AYSBC – AYSBC". Say it once.
    if session_name and _normalise(session_name) != _normalise(competition):
        title = f"{title} – {session_name}"
    if batch:
        title = f"{title} (Đợt {batch})"
    return re.sub(r"\s+", " ", title).strip()


def planned_entries(sessions=None, competitions=None):
    """Every exam day that should appear on the schedule, newest data wins."""
    sessions = list(sessions if sessions is not None else ExamSession.objects.all())
    if competitions is None:
        competitions = {item.id: item for item in Competition.objects.all()}
    entries = []
    for session in sessions:
        competition = _competition_label(session, competitions)
        for round_data in session.rounds or []:
            if not isinstance(round_data, dict):
                continue
            round_id = str(round_data.get("id") or "")
            round_name = str(round_data.get("name") or "").strip()
            if not round_name:
                continue
            slots = [slot for slot in (round_data.get("slots") or []) if isinstance(slot, dict)]
            dated_slots = [(index, _parse_date(slot.get("date"))) for index, slot in enumerate(slots)]
            dated_slots = [(index, value) for index, value in dated_slots if value]

            if len(dated_slots) > 1:
                for batch, (index, when) in enumerate(dated_slots, start=1):
                    entries.append({
                        "recordId": _record_id(session.id, round_id, index),
                        "title": _title(round_name, competition, session.name, batch),
                        "date": when,
                    })
                continue

            when = dated_slots[0][1] if dated_slots else _parse_date(round_data.get("date"))
            if not when:
                continue
            index = dated_slots[0][0] if dated_slots else 0
            entries.append({
                "recordId": _record_id(session.id, round_id, index),
                "title": _title(round_name, competition, session.name),
                "date": when,
            })
    return entries


def _next_order(executor_id, work_date):
    rows = WorkItem.objects.filter(executor_id=executor_id, work_date=work_date)
    return (rows.aggregate(value=Max("daily_order"))["value"] or 0) + 1


def sync_examination_work_schedule(*, apply=True, today=None):
    """Reconcile the generated rows against the exam calendar.

    Returns a summary of what changed (or would change when ``apply`` is False).
    Past days are left alone: rewriting a schedule somebody already worked
    through helps nobody.
    """
    horizon = today or date.today()
    staff = examination_staff()
    summary = {
        "staff": [person.email for person in staff],
        "created": [], "updated": [], "deleted": [], "skippedPast": 0,
    }
    if not staff:
        return summary

    entries = [entry for entry in planned_entries() if entry["date"] >= horizon]
    wanted = {entry["recordId"]: entry for entry in entries}

    for person in staff:
        existing = {
            item.source_record_id: item
            for item in WorkItem.objects.filter(
                executor=person, source_record_id__startswith=RECORD_PREFIX
            )
        }

        for record_id, entry in wanted.items():
            item = existing.pop(record_id, None)
            if item is None:
                summary["created"].append({"email": person.email, "title": entry["title"],
                                           "date": entry["date"].isoformat()})
                if apply:
                    WorkItem.objects.create(
                        creator=person,
                        executor=person,
                        title=entry["title"],
                        work_date=entry["date"],
                        priority=PRIORITY,
                        label=LABEL,
                        source_record_id=record_id,
                        daily_order=_next_order(person.pk, entry["date"]),
                    )
                continue

            changes = {}
            if item.title != entry["title"]:
                changes["title"] = entry["title"]
            if item.work_date != entry["date"]:
                changes["work_date"] = entry["date"]
            if item.priority != PRIORITY:
                changes["priority"] = PRIORITY
            if item.label != LABEL:
                changes["label"] = LABEL
            if not changes:
                continue
            summary["updated"].append({"email": person.email, "title": entry["title"],
                                       "date": entry["date"].isoformat(),
                                       "fields": sorted(changes)})
            if apply:
                if "work_date" in changes:
                    changes["daily_order"] = _next_order(person.pk, entry["date"])
                for field, value in changes.items():
                    setattr(item, field, value)
                item.save(update_fields=[*changes, "updated_at"])

        # Whatever is left no longer exists in the exam calendar.
        for record_id, item in existing.items():
            if item.work_date < horizon:
                summary["skippedPast"] += 1
                continue
            summary["deleted"].append({"email": person.email, "title": item.title,
                                       "date": item.work_date.isoformat()})
            if apply:
                item.delete()

    return summary
