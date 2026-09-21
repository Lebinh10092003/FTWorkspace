import re
import unicodedata
from datetime import datetime, time, timedelta

from django.conf import settings
from django.db.models import Max

from authentication.models import UserProfile
from digital_training.models import TrainingSession

from .models import WorkItem


TRAINING_LABEL = "Tập huấn"


def _normalise(value):
    plain = "".join(
        char for char in unicodedata.normalize("NFD", str(value or "").lower())
        if unicodedata.category(char) != "Mn"
    ).replace("đ", "d")
    return re.sub(r"[^a-z0-9@]+", " ", plain).strip()


def _is_training(item):
    label = _normalise(item.label)
    title = _normalise(item.title)
    # Native Sheet rows are calendar sessions only when the user actually put
    # a time at the start of that numbered line. Previously every Liên task
    # containing the words "tập huấn" was labelled as a session and silently
    # received the default 09:00-12:00 slot.
    is_native_sheet_item = bool(
        item.source_sheet_row
        and not str(item.source_record_id or "").upper().startswith("REC-WEB-")
    )
    if is_native_sheet_item:
        return bool(
            item.time_prefix_in_title
            and "tap huan" in title
        )
    return "tap huan" in label or title.startswith(("tap huan ", "tham gia tap huan ", "ho tro tap huan "))


def _time_window(start_time, end_time=None):
    start = start_time or time(9, 0)
    if end_time:
        return start, end_time
    end_dt = datetime.combine(datetime.today(), start) + timedelta(hours=3)
    return start, end_dt.time().replace(second=0, microsecond=0)


def _matching_profile(value, fallback=None):
    source = _normalise(value)
    if not source:
        return fallback
    email = next((part for part in source.split() if "@" in part), "")
    if email:
        profile = UserProfile.objects.filter(email__iexact=email, employment_status="ACTIVE").first()
        if profile:
            return profile
    tokens = [part for part in source.split() if part not in {"mr", "mrs", "ms", "giang", "vien", "ho", "tro"}]
    profiles = list(UserProfile.objects.filter(employment_status="ACTIVE"))
    exact = [profile for profile in profiles if _normalise(profile.name) == " ".join(tokens)]
    if len(exact) == 1:
        return exact[0]
    if tokens:
        last = tokens[-1]
        suffix = [profile for profile in profiles if _normalise(profile.name).split()[-1:] == [last]]
        if len(suffix) == 1:
            return suffix[0]
    return fallback


def _profiles_from_summary(value):
    profiles = []
    for chunk in re.split(r"[,;+/]|\s+và\s+|\s+and\s+", str(value or ""), flags=re.IGNORECASE):
        profile = _matching_profile(chunk)
        if profile and profile not in profiles:
            profiles.append(profile)
    return profiles


def _next_order(executor, work_date, exclude_id=None):
    rows = WorkItem.objects.filter(executor=executor, work_date=work_date)
    if exclude_id:
        rows = rows.exclude(pk=exclude_id)
    return (rows.aggregate(value=Max("daily_order"))["value"] or 0) + 1


def _normalise_orders(executor_id, work_date):
    rows = WorkItem.objects.filter(executor_id=executor_id, work_date=work_date).order_by(
        "daily_order", "start_time", "created_at", "pk"
    )
    for order, row in enumerate(rows, start=1):
        if row.daily_order != order:
            WorkItem.objects.filter(pk=row.pk).update(daily_order=order)


def sync_training_from_work_item(item):
    # A TrainingSession created inside Digital Training (manually or from a
    # customer) owns its data. Sheet synchronization must never delete or
    # rewrite it merely because its mirrored WorkItem later changes.
    if (
        item.training_session_id
        and item.training_session.source != TrainingSession.SOURCE_WORK_SCHEDULE
    ):
        return item.training_session

    if not _is_training(item):
        if item.training_session_id:
            session = item.training_session
            WorkItem.objects.filter(pk=item.pk).update(training_session=None)
            session.delete()
            item.training_session = None
        return None

    # A work-schedule entry is not sufficient evidence to create an official
    # Digital Training session: several staff can describe the same session
    # with different titles/times. Until a reconciliation candidate is
    # confirmed, keep the work item only and do not place another event on the
    # training calendar. Existing projections can still be reconciled/deleted.
    if (
        not item.training_session_id
        and not settings.WORK_SCHEDULE_TRAINING_PROJECTION_ENABLED
    ):
        return None

    start_time, end_time = _time_window(item.start_time, item.end_time)
    if item.start_time != start_time or item.end_time != end_time:
        WorkItem.objects.filter(pk=item.pk).update(start_time=start_time, end_time=end_time)
        item.start_time, item.end_time = start_time, end_time

    status = "completed" if item.status in {WorkItem.STATUS_COMPLETED, WorkItem.STATUS_REVIEWED} else "planned"
    supporters = list(item.supporters.all())
    staff_name = item.executor.name or item.executor.email
    support_name = ", ".join(profile.name or profile.email for profile in supporters)
    defaults = {
        "title": item.title,
        "session_date": item.work_date,
        "start_time": start_time,
        "end_time": end_time,
        "category": TRAINING_LABEL,
        "contents": [item.description or item.title],
        "status": status,
        "staff_name": staff_name,
        "instructor_name": staff_name,
        "support_staff_name": support_name,
    }
    if item.training_session_id:
        TrainingSession.objects.filter(pk=item.training_session_id).update(**defaults)
        return item.training_session
    session = TrainingSession.objects.create(
        source=TrainingSession.SOURCE_WORK_SCHEDULE,
        **defaults,
    )
    WorkItem.objects.filter(pk=item.pk).update(training_session=session)
    item.training_session = session
    return session


def sync_work_item_from_training(session, actor):
    try:
        item = session.work_schedule_item
    except WorkItem.DoesNotExist:
        item = None
    if not session.session_date:
        if item:
            old_group = (item.executor_id, item.work_date)
            item.delete()
            _normalise_orders(*old_group)
        return None

    executor = _matching_profile(session.instructor_name or session.staff_name, actor)
    if not executor:
        return None
    start_time, end_time = _time_window(session.start_time, session.end_time)
    if session.start_time != start_time or session.end_time != end_time:
        TrainingSession.objects.filter(pk=session.pk).update(start_time=start_time, end_time=end_time)
        session.start_time, session.end_time = start_time, end_time
    work_status = WorkItem.STATUS_COMPLETED if session.status == "completed" else WorkItem.STATUS_TODO
    previous_group = (item.executor_id, item.work_date) if item else None
    if not item:
        item = WorkItem(
            creator=actor,
            executor=executor,
            work_date=session.session_date,
            title=session.title,
            training_session=session,
            daily_order=_next_order(executor, session.session_date),
        )
    item.executor = executor
    item.work_date = session.session_date
    item.title = session.title
    item.description = " · ".join(session.contents or []) or session.notes
    item.start_time = start_time
    item.end_time = end_time
    item.status = work_status
    item.label = TRAINING_LABEL
    if previous_group and previous_group != (executor.email, session.session_date):
        item.daily_order = _next_order(executor, session.session_date, item.pk)
    item.save()
    item.supporters.set(_profiles_from_summary(session.support_staff_name))
    if actor.email != executor.email:
        item.managers.add(actor)
    if previous_group and previous_group != (executor.email, session.session_date):
        _normalise_orders(*previous_group)
    return item


def delete_training_for_work_item(item):
    # Only a session this work item produced is the work schedule's to remove.
    # A session authored in Đào tạo số outlives the mirrored row, so deleting a
    # stray row from Lịch cá nhân just unlinks it. This matches the ownership
    # rule sync_training_from_work_item already applies.
    if not item.training_session_id:
        return
    session = item.training_session
    WorkItem.objects.filter(pk=item.pk).update(training_session=None)
    item.training_session = None
    if session.source == TrainingSession.SOURCE_WORK_SCHEDULE:
        session.delete()


def delete_work_item_for_training(session):
    try:
        item = session.work_schedule_item
    except WorkItem.DoesNotExist:
        return
    old_group = (item.executor_id, item.work_date)
    item.delete()
    _normalise_orders(*old_group)
