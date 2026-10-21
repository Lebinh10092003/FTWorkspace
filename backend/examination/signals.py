from django.db import transaction
from django.db.models import Q
from django.db.models.signals import post_save, post_delete, pre_save
from django.dispatch import receiver
from django.utils import timezone

from authentication.models import UserProfile, WorkspaceNotification
from authentication.notifications import notify_workspace
from .models import Candidate, CandidateParticipation, ExaminationBillingRecord, ExaminationSheet, RoundResult
from .candidate_sheet_queue import enqueue_candidate
from .session_sheet_queue import enqueue_session_candidate


@receiver(pre_save, sender=Candidate)
def normalize_candidate_identifiers(sender, instance, **kwargs):
    from .sync import clean_profile_text, format_identity, format_phone, normalize_grade
    instance.identity = format_identity(instance.identity)
    instance.phone = format_phone(instance.phone)
    for field in ('parent', 'email', 'city', 'ward', 'address', 'nationality', 'class_name', 'school'):
        setattr(instance, field, clean_profile_text(getattr(instance, field)))
    instance.grade = normalize_grade(instance.grade, instance.class_name)


@receiver(post_save, sender=Candidate)
def candidate_changed(sender, instance, **kwargs):
    from .models import PublicExamRegistration
    PublicExamRegistration.objects.filter(candidate=instance, sheet_status='synced').update(sheet_status='refresh')
    enqueue_candidate(instance.pk)
    session_ids = set(instance.session_ids or []) | set(instance.participations.values_list('session_id', flat=True))
    for session_id in session_ids:
        enqueue_session_candidate(instance.pk, session_id)


@receiver(post_save, sender=CandidateParticipation)
@receiver(post_delete, sender=CandidateParticipation)
def participation_changed(sender, instance, **kwargs):
    enqueue_candidate(instance.candidate_id)
    enqueue_session_candidate(instance.candidate_id, instance.session_id)


@receiver(pre_save, sender=CandidateParticipation)
def preserve_school_accounting_metadata(sender, instance, **kwargs):
    if instance._state.adding:
        return
    previous = CandidateParticipation.objects.filter(pk=instance.pk).values_list('registration_data', flat=True).first() or {}
    data = dict(instance.registration_data or {})
    if previous.get('historicalImport') is True:
        data['historicalImport'] = True
    for key in ('registeredAt', 'registrationProfile'):
        if key in previous and key not in data:
            data[key] = previous[key]
    if instance.school_registration_id:
        for key in ('schoolFee', 'schoolPartnerId'):
            if key in previous:
                data[key] = previous[key]
    instance.registration_data = data


@receiver(post_save, sender=RoundResult)
@receiver(post_delete, sender=RoundResult)
def round_result_changed(sender, instance, **kwargs):
    candidate_id = CandidateParticipation.objects.filter(pk=instance.participation_id).values_list('candidate_id', flat=True).first()
    if candidate_id:
        enqueue_candidate(candidate_id)
        if getattr(instance, '_room_sheet_only', False):
            # Attendance only: the session tab no longer carries it (room Sheet does).
            return
        session_id = CandidateParticipation.objects.filter(pk=instance.participation_id).values_list('session_id', flat=True).first()
        enqueue_session_candidate(candidate_id, session_id)


@receiver(pre_save, sender=ExaminationSheet)
def linked_sheet_configuration_changed(sender, instance, **kwargs):
    fields = ('session_id', 'url', 'sheet_tab', 'stage')
    previous = ExaminationSheet.objects.filter(pk=instance.pk).values_list(*fields).first()
    instance._queue_memberships = previous is None or previous != tuple(getattr(instance, field) for field in fields)


@receiver(post_save, sender=ExaminationSheet)
def linked_sheet_created(sender, instance, created, **kwargs):
    if not created and not getattr(instance, '_queue_memberships', False):
        return
    candidate_ids = set(CandidateParticipation.objects.filter(session_id=instance.session_id).values_list('candidate_id', flat=True))
    for candidate in Candidate.objects.all().only('id', 'session_ids'):
        if instance.session_id in (candidate.session_ids or []):
            candidate_ids.add(candidate.pk)
    for candidate_id in candidate_ids:
        enqueue_session_candidate(candidate_id, instance.session_id)


@receiver(post_save, sender=CandidateParticipation)
def registration_created(sender, instance, created, **kwargs):
    if not created or instance.school_registration_id or (instance.registration_data or {}).get('historicalImport') is True:
        return
    ExaminationBillingRecord.objects.get_or_create(participation=instance)

    def alert():
        # Một lượt đăng ký là một thông báo, cho cả Khảo thí lẫn kế toán, liệt
        # kê mọi cuộc thi của thí sinh trong ngày. Trước đây mỗi cuộc thi sinh
        # hai thông báo ("cần đối soát" và "mới đăng ký"): 740 thông báo trong
        # 21 ngày tới 21/10/2026. Kế toán đều có quyền vào Khảo thí.
        registered_on = timezone.localdate(instance.created_at)
        codes = []
        for code, data in CandidateParticipation.objects.filter(
            candidate_id=instance.candidate_id, school_registration__isnull=True,
            created_at__date=registered_on,
        ).order_by('created_at', 'pk').values_list('session__code', 'registration_data'):
            if (data or {}).get('historicalImport') is not True and code not in codes:
                codes.append(code)
        message = f"{instance.candidate.name} · {', '.join(codes or [instance.session.code])} · cần đối soát lệ phí"
        accounting_emails = list(UserProfile.objects.filter(
            Q(job_title__name__icontains='Kế toán') |
            Q(department__name__icontains='Kế toán') |
            Q(departments__name__icontains='Kế toán'),
            employment_status='ACTIVE',
        ).values_list('email', flat=True).distinct())
        notification, created = notify_workspace(
            event_key=f'examination:new-registration:{instance.candidate_id}:{registered_on.isoformat()}',
            title='Thí sinh mới đăng ký', message=message,
            category='examination', action_url='/examination/candidates',
            target_modules=['examination'], target_emails=accounting_emails,
        )
        if not created and notification.message != message:
            WorkspaceNotification.objects.filter(pk=notification.pk).update(message=message)

    transaction.on_commit(alert)
