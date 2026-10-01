from django.db.models import Q
from django.conf import settings
from django.utils import timezone

from .models import TrainingCustomerMeeting, TrainingSession


def _past_schedule_filter(date_field, local_now):
    today = local_now.date()
    current_time = local_now.time().replace(tzinfo=None)
    return (
        Q(**{f"{date_field}__lt": today})
        | Q(
            **{
                date_field: today,
                "end_time__isnull": False,
                "end_time__lte": current_time,
            }
        )
    )


def schedule_has_ended(schedule_date, end_time=None, now=None):
    if not schedule_date:
        return False
    moment = now or timezone.now()
    if timezone.is_naive(moment):
        moment = timezone.make_aware(moment, timezone.get_current_timezone())
    local_now = timezone.localtime(moment)
    if schedule_date < local_now.date():
        return True
    if schedule_date > local_now.date() or end_time is None:
        return False
    return end_time <= local_now.time().replace(tzinfo=None)


def complete_past_training_schedules(now=None):
    """Mark planned training and work-calendar entries that have already ended."""
    moment = now or timezone.now()
    if timezone.is_naive(moment):
        moment = timezone.make_aware(moment, timezone.get_current_timezone())
    local_now = timezone.localtime(moment)

    sessions = TrainingSession.objects.filter(
        _past_schedule_filter("session_date", local_now),
        status="planned",
    )
    session_ids = list(sessions.values_list("id", flat=True))
    session_count = sessions.update(status="completed", updated_at=moment)
    if session_ids and settings.TRAINING_WORK_SCHEDULE_PROJECTION_ENABLED:
        from work_schedule.models import WorkItem
        WorkItem.objects.filter(training_session_id__in=session_ids).update(
            status=WorkItem.STATUS_COMPLETED,
            updated_at=moment,
        )
    meeting_count = TrainingCustomerMeeting.objects.filter(
        _past_schedule_filter("meeting_date", local_now),
        status="planned",
    ).update(status="completed", updated_at=moment)
    return {
        "sessions": session_count,
        "customer_meetings": meeting_count,
        "total": session_count + meeting_count,
    }
