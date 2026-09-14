from collections import defaultdict
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from .models import UserProfile, WorkspaceNotification, WorkspaceNotificationRead


READ_NOTIFICATION_RETENTION_DAYS = 7
MAX_NOTIFICATION_RETENTION_DAYS = 21


def notify_workspace(*, event_key, title, message, severity='info', category='workspace',
                     action_url='', target_roles=None, target_modules=None, target_emails=None,
                     expires_at=None):
    """Create an idempotent notification so scheduled jobs can safely retry."""
    notification, created = WorkspaceNotification.objects.get_or_create(
        event_key=str(event_key)[:255],
        defaults={
            'title': str(title)[:255],
            'message': str(message),
            'severity': severity,
            'category': str(category)[:80],
            'action_url': str(action_url)[:1000],
            'target_roles': list(target_roles or []),
            'target_modules': list(target_modules or []),
            'target_emails': [str(value).strip().lower() for value in (target_emails or []) if str(value).strip()],
            'expires_at': expires_at,
        },
    )
    return notification, created


def notification_visible_to(notification, profile):
    if notification.expires_at and notification.expires_at <= timezone.now():
        return False
    if str(profile.role).upper() == 'ADMIN':
        return True
    email = str(profile.email).strip().lower()
    emails = {str(value).strip().lower() for value in (notification.target_emails or [])}
    roles = {str(value).upper() for value in (notification.target_roles or [])}
    targets = set(notification.target_modules or [])
    if not emails and not roles and not targets:
        return True
    if email in emails:
        return True
    if roles and str(profile.role).upper() in roles:
        return True
    modules = set(profile.access_modules or [])
    return bool(targets and modules.intersection(targets))


def read_notification_cutoff(now=None):
    return (now or timezone.now()) - timedelta(days=READ_NOTIFICATION_RETENTION_DAYS)


def max_notification_cutoff(now=None):
    return (now or timezone.now()) - timedelta(days=MAX_NOTIFICATION_RETENTION_DAYS)


def purge_read_workspace_notifications(now=None):
    """Delete notifications only when no active recipient still needs them.

    A shared notification may target several people, roles, or modules. It is
    therefore unsafe to delete it seven days after the first person reads it.
    We delete it after every currently eligible active recipient has had a full
    seven days since reading. Explicitly expired notices are already invisible
    and can be removed immediately.
    """
    now = now or timezone.now()
    cutoff = read_notification_cutoff(now)
    absolute_cutoff = max_notification_cutoff(now)
    expired_or_old = WorkspaceNotification.objects.filter(
        Q(expires_at__lte=now) | Q(created_at__lte=absolute_cutoff)
    )
    expired_or_old_count = expired_or_old.count()
    expired_or_old.delete()

    profiles = list(UserProfile.objects.filter(employment_status='ACTIVE'))
    old_readers_by_notification = defaultdict(set)
    for notification_id, user_id in WorkspaceNotificationRead.objects.filter(
        read_at__lte=cutoff
    ).values_list('notification_id', 'user_id'):
        old_readers_by_notification[notification_id].add(user_id)
    notifications = WorkspaceNotification.objects.filter(expires_at__isnull=True)
    removable_ids = []
    for notification in notifications.iterator(chunk_size=250):
        target_emails = {str(value).strip().lower() for value in (notification.target_emails or [])}
        target_roles = {str(value).upper() for value in (notification.target_roles or [])}
        target_modules = set(notification.target_modules or [])
        has_explicit_audience = bool(target_emails or target_roles or target_modules)
        recipients = set()
        for profile in profiles:
            email = str(profile.email).strip().lower()
            if not has_explicit_audience:
                recipients.add(profile.email)
            elif (
                email in target_emails
                or str(profile.role).upper() in target_roles
                or bool(set(profile.access_modules or []).intersection(target_modules))
            ):
                recipients.add(profile.email)
        old_readers = old_readers_by_notification[notification.pk]
        if recipients and recipients.issubset(old_readers):
            removable_ids.append(notification.pk)
        elif not recipients and notification.created_at <= cutoff:
            removable_ids.append(notification.pk)

    read_deleted, _ = WorkspaceNotification.objects.filter(pk__in=removable_ids).delete()
    return {
        'expiredOrMaxAgeDeleted': expired_or_old_count,
        'readDeleted': read_deleted,
        'notificationsDeleted': len(removable_ids),
    }
