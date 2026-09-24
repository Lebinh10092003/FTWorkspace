from django.db import migrations


SCHEDULE = {
    'iaio': ('SIAIO', [('round-national', 'Vòng loại Quốc gia', ['2026-10-04']), ('round-final', 'Vòng Chung kết Quốc gia', ['2026-11-08']), ('round-international', 'Vòng Chung kết Quốc tế', ['2026-12-27'])]),
    'ibo': ('SIBO', [('round-final', 'Vòng Chung kết Quốc gia', ['2026-11-01']), ('round-international', 'Vòng Chung kết Quốc tế', ['2026-12-20'])]),
    'icho': ('SIChO', [('round-final', 'Vòng Chung kết Quốc gia', ['2026-11-01']), ('round-international', 'Vòng Chung kết Quốc tế', ['2026-12-20'])]),
    'ipho': ('SIPhO', [('round-final', 'Vòng Chung kết Quốc gia', ['2026-11-01']), ('round-international', 'Vòng Chung kết Quốc tế', ['2026-12-20'])]),
    'ilso': ('SILSO', [('round-final', 'Vòng thi Quốc gia duy nhất', ['2026-11-08'])]),
    'fimo': ('FIMO', [('round-national', 'Vòng loại Quốc gia', ['2026-10-11', '2026-12-06', '2027-02-28']), ('round-final', 'Vòng Chung kết Quốc gia', ['2027-04-25']), ('round-international', 'Vòng Chung kết Quốc tế', ['2027-07-11'])]),
    'fieo': ('FIEO', [('round-national', 'Vòng loại Quốc gia', ['2026-10-18', '2026-12-13', '2027-03-07']), ('round-final', 'Vòng Chung kết Quốc gia', ['2027-05-02']), ('round-international', 'Vòng Chung kết Quốc tế', ['2027-07-18'])]),
}


def display_date(value):
    year, month, day = value.split('-')
    return f'{day}/{month}/{year}'


def forwards(apps, schema_editor):
    Competition = apps.get_model('examination', 'Competition')
    ExamSession = apps.get_model('examination', 'ExamSession')
    LandingSite = apps.get_model('examination', 'LandingSite')

    for competition_id, (code, planned_rounds) in SCHEDULE.items():
        competition = Competition.objects.filter(pk=competition_id).first()
        if competition and competition.code != code:
            competition.code = code
            competition.save(update_fields=['code', 'updated_at'])
        session = ExamSession.objects.filter(pk=f'{competition_id}-2026-2027').first()
        if not session:
            continue
        existing = {item.get('id'): item for item in (session.rounds or []) if isinstance(item, dict)}
        rounds = []
        for round_id, name, dates in planned_rounds:
            original = existing.get(round_id, {})
            slots = []
            old_slots = original.get('slots') if isinstance(original.get('slots'), list) else []
            for index, date in enumerate(dates):
                old = old_slots[index] if index < len(old_slots) and isinstance(old_slots[index], dict) else {}
                slots.append({**old, 'id': old.get('id') or f'{round_id}-day-{index + 1}', 'date': date})
            rounds.append({**original, 'id': round_id, 'name': name,
                           'date': dates[0], 'label': '; '.join(map(display_date, dates)), 'slots': slots})
        session.code = code
        session.rounds = rounds
        national = next((item for item in rounds if item['id'] == 'round-final'), None)
        international = next((item for item in rounds if item['id'] == 'round-international'), None)
        session.national_date = national['date'] if national else ''
        session.national = national['label'] if national else ''
        session.international_date = international['date'] if international else ''
        session.international = international['label'] if international else ''
        session.save(update_fields=['code', 'rounds', 'national_date', 'national',
                                    'international_date', 'international', 'updated_at'])

    # Keep custom landing content and links. Only replace dates that came from
    # the original starter content; an editor's custom timeline remains intact.
    old_first = {'fimo': '2026-09-20', 'fieo': '2026-09-27'}
    for slug in ('fimo', 'fieo'):
        site = LandingSite.objects.filter(slug=slug).first()
        if not site:
            continue
        content = dict(site.content or {})
        timeline = content.get('timeline') or []
        if len(timeline) != 5 or timeline[0].get('date') != old_first[slug]:
            continue
        dates = [item for item in SCHEDULE[slug][1] for item in item[2]]
        content['timeline'] = [{**entry, 'date': date} for entry, date in zip(timeline, dates)]
        site.content = content
        site.save(update_fields=['content', 'updated_at'])


class Migration(migrations.Migration):
    dependencies = [('examination', '0036_landingtemplate')]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
