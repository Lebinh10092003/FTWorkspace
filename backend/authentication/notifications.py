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
    event_str = str(event_key)[:255]
    clean_title = str(title)[:255]
    clean_message = str(message)
    clean_category = str(category)[:80]
    clean_action_url = str(action_url)[:1000]
    roles_list = list(target_roles or [])
    modules_list = list(target_modules or [])
    emails_list = [str(value).strip().lower() for value in (target_emails or []) if str(value).strip()]

    # 1. Look up by exact event_key first
    notification = WorkspaceNotification.objects.filter(event_key=event_str).first()
    if notification:
        updated_fields = []
        if notification.title != clean_title:
            notification.title = clean_title
            updated_fields.append('title')
        if notification.message != clean_message:
            notification.message = clean_message
            updated_fields.append('message')
        if notification.severity != severity:
            notification.severity = severity
            updated_fields.append('severity')
        if notification.action_url != clean_action_url:
            notification.action_url = clean_action_url
            updated_fields.append('action_url')
        if notification.category != clean_category:
            notification.category = clean_category
            updated_fields.append('category')
        if notification.target_roles != roles_list:
            notification.target_roles = roles_list
            updated_fields.append('target_roles')
        if notification.target_modules != modules_list:
            notification.target_modules = modules_list
            updated_fields.append('target_modules')
        if notification.target_emails != emails_list:
            notification.target_emails = emails_list
            updated_fields.append('target_emails')
        if expires_at and notification.expires_at != expires_at:
            notification.expires_at = expires_at
            updated_fields.append('expires_at')
        if updated_fields:
            notification.save(update_fields=updated_fields)
        return notification, False

    # 2. Prevent content duplicate within active retention window (category + title + message)
    existing_duplicate = WorkspaceNotification.objects.filter(
        category=clean_category,
        title=clean_title,
        message=clean_message,
        created_at__gt=max_notification_cutoff(),
    ).first()
    if existing_duplicate:
        return existing_duplicate, False

    # 3. Create new notification
    notification = WorkspaceNotification.objects.create(
        event_key=event_str,
        title=clean_title,
        message=clean_message,
        severity=severity,
        category=clean_category,
        action_url=clean_action_url,
        target_roles=roles_list,
        target_modules=modules_list,
        target_emails=emails_list,
        expires_at=expires_at,
    )
    return notification, True



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
