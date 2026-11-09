"""Publish the confirmed November dates and advertise FT qualifying batch 2.

Only the six named landing pages are changed. Other content, registration
records and examination sessions are left intact. Production deploy.sh backs
up the database before running migrations.
"""

from copy import deepcopy

from django.db import migrations
from django.utils import timezone


SCIENCE_DATES = {
    'sipho': ('2026-11-01', '2026-11-22'),
    'sicho': ('2026-11-01', '2026-11-22'),
    'sibo': ('2026-11-01', '2026-11-22'),
    'silso': ('2026-11-08', '2026-11-29'),
}
FT_DATES = {'fimo': '06/12/2026', 'fieo': '13/12/2026'}


def refreshed_content(slug, original):
    """Return a copy so the proposed data changes can also be dry-run locally."""
    content = deepcopy(original)
    if slug in SCIENCE_DATES:
        old, new = SCIENCE_DATES[slug]
        for item in content.get('timeline', []):
            if ('quốc gia' in str(item.get('title', '')).lower()
                    and item.get('date') == old):
                item['date'] = new
        old_short, new_short = old[8:10] + '/' + old[5:7], new[8:10] + '/' + new[5:7]
        for item in content.get('highlights', []):
            if ('quốc gia' in str(item.get('label', '')).lower()
                    and item.get('value') == old_short):
                item['value'] = new_short
    elif slug in FT_DATES:
        content['badge'] = 'MỞ ĐĂNG KÝ · VÒNG LOẠI QUỐC GIA ĐỢT 2 · LỚP 1–9'
        note = f"Vòng loại Quốc gia đợt 2 diễn ra vào Chủ nhật, ngày {FT_DATES[slug]}."
        if note not in content.get('intro', ''):
            content['intro'] = (content.get('intro', '').rstrip() + ' ' + note).strip()
        url = f'/dang-ky-du-thi?cuoc-thi={slug.upper()}'
        registration = content.setdefault('registration', {})
        registration['individualUrl'] = url
        buttons = content.setdefault('buttons', [])
        for button in buttons:
            if 'đăng ký' in str(button.get('label', '')).lower():
                button.update(label='Đăng ký đợt 2', url=url)
                break
        else:
            buttons.insert(0, {'label': 'Đăng ký đợt 2', 'url': url})
    return content


def refresh_landings(apps, schema_editor):
    LandingSite = apps.get_model('examination', 'LandingSite')
    db = schema_editor.connection.alias
    for page in LandingSite.objects.using(db).filter(slug__in=[*SCIENCE_DATES, *FT_DATES]):
        content = refreshed_content(page.slug, page.content)
        if content != page.content:
            page.content = content
            page.updated_at = timezone.now()
            page.save(using=db, update_fields=['content', 'updated_at'])


class Migration(migrations.Migration):
    dependencies = [('examination', '0060_invigilation_guest_opened')]
    operations = [migrations.RunPython(refresh_landings, migrations.RunPython.noop)]
