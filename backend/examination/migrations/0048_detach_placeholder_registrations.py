from django.db import migrations


def detach_placeholders(apps, schema_editor):
    Candidate = apps.get_model('examination', 'Candidate')
    Participation = apps.get_model('examination', 'CandidateParticipation')
    Billing = apps.get_model('examination', 'ExaminationBillingRecord')
    Session = apps.get_model('examination', 'ExamSession')
    # Keep original profiles. Detach only empty symbol-only imports without
    # submissions, billing or round history; real records remain reviewable.
    for candidate in Candidate.objects.all().iterator():
        if any(char.isalpha() for char in candidate.name):
            continue
        if any(getattr(candidate, field) for field in ('birth_date', 'identity', 'email', 'phone')):
            continue
        if candidate.public_registrations.exists():
            continue
        memberships = Participation.objects.filter(candidate=candidate)
        if memberships.filter(round_results__isnull=False).exists():
            continue
        billing_rows = Billing.objects.filter(participation__in=memberships)
        if any(row.amount is not None or row.transfer_status != 'pending' or row.invoice_status != 'pending'
               or row.transfer_reference or row.invoice_number or row.note or row.seen_by_accountant
               or row.transfer_confirmed_at or row.invoice_checked_at for row in billing_rows):
            continue
        memberships.delete()
        candidate.session_ids = []
        candidate.save(update_fields=['session_ids'])
    memberships_by_session = {}
    for candidate_id, session_id in Participation.objects.values_list('candidate_id', 'session_id'):
        memberships_by_session.setdefault(session_id, set()).add(candidate_id)
    for candidate in Candidate.objects.all().iterator():
        if any(char.isalpha() for char in candidate.name):
            for session_id in candidate.session_ids or []:
                memberships_by_session.setdefault(session_id, set()).add(candidate.pk)
    for session in Session.objects.all():
        session.candidates_count = len(memberships_by_session.get(session.pk, set()))
        session.save(update_fields=['candidates_count'])


class Migration(migrations.Migration):
    dependencies = [('examination', '0047_editable_registration_page')]
    operations = [migrations.RunPython(detach_placeholders, migrations.RunPython.noop)]
