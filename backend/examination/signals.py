from django.db import transaction
from django.db.models import Q
from django.db.models.signals import post_save, post_delete, pre_save
from django.dispatch import receiver

from authentication.models import UserProfile
from authentication.notifications import notify_workspace
from .models import Candidate, CandidateParticipation, ExaminationBillingRecord, ExaminationSheet, RoundResult
from .candidate_sheet_queue import enqueue_candidate
from .session_sheet_queue import enqueue_session_candidate


@receiver(pre_save, sender=Candidate)
def normalize_candidate_identifiers(sender, instance, **kwargs):
    from .sync import format_identity, format_phone
    instance.identity = format_identity(instance.identity)
    instance.phone = format_phone(instance.phone)


@receiver(post_save, sender=Candidate)
def candidate_changed(sender, instance, **kwargs):
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
        label = f'{instance.candidate.name} · {instance.session.code}'
        accounting_emails = list(UserProfile.objects.filter(
            Q(job_title__name__icontains='Kế toán') |
            Q(department__name__icontains='Kế toán') |
            Q(departments__name__icontains='Kế toán'),
            employment_status='ACTIVE',
        ).values_list('email', flat=True).distinct())
        notify_workspace(
            event_key=f'examination:new-registration:finance:{instance.pk}',
            title='Thí sinh mới cần đối soát', message=label,
            category='examination', action_url='/finance-report/examination-billing',
            target_emails=accounting_emails,
            target_modules=[] if accounting_emails else ['finance-report'],
        )
        notify_workspace(
            event_key=f'examination:new-registration:exam:{instance.pk}',
            title='Thí sinh mới đăng ký', message=label,
            category='examination', action_url='/examination/candidates',
            target_modules=['examination'],
        )

    transaction.on_commit(alert)
