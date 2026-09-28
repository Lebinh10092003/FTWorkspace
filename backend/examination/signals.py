from django.db import transaction
from django.db.models import Q
from django.db.models.signals import post_save
from django.dispatch import receiver

from authentication.models import UserProfile
from authentication.notifications import notify_workspace
from .models import CandidateParticipation, ExaminationBillingRecord


@receiver(post_save, sender=CandidateParticipation)
def registration_created(sender, instance, created, **kwargs):
    if not created:
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
