"""Attach the supplied public reference material to existing landing pages."""

from copy import deepcopy

from django.db import migrations

from examination.landing_templates import olympiad_content, siaio_content


OLD_INTROS = {
    'FIMO': 'Khám phá năng lực Toán học, rèn tư duy logic và giải quyết vấn đề trong môi trường học thuật hiện đại.',
    'FIEO': 'Phát triển năng lực tiếng Anh toàn diện qua thử thách học thuật theo định hướng CEFR.',
    'SIAIO': 'Một hành trình học thuật để học sinh thể hiện tư duy, khả năng sáng tạo và ứng dụng AI.',
}
OLD_OVERVIEW = [
    {'title': 'FIMO · Toán học', 'body': 'Đề thi song ngữ, chú trọng tư duy logic, giải quyết vấn đề và tư duy AI.', 'url': '/cuoc-thi/fimo'},
    {'title': 'FIEO · Tiếng Anh', 'body': 'Bài thi 100% tiếng Anh, phát triển bốn kỹ năng theo định hướng CEFR.', 'url': '/cuoc-thi/fieo'},
]
OLD_SIAIO_OVERVIEW = [
    {'title': 'Tư duy AI cho thế hệ mới', 'body': 'Khám phá các môn thi và nội dung phù hợp với từng khối lớp.', 'url': ''},
]
OLD_HIGHLIGHTS = [
    {'value': 'Lớp 1–9', 'label': 'Đối tượng dự thi'},
    {'value': '3 vòng', 'label': 'Vòng loại trực tuyến'},
    {'value': 'Google for Education', 'label': 'Đối tác giáo dục'},
]
OLD_ADDRESS = 'Eurowindow Multi Complex, 27 Trần Duy Hưng, Hà Nội'
OLD_NAMES = {
    'FIMO': 'Fermat International Mathematics Olympiad',
    'FIEO': 'Fermat International English Olympiad',
}


def enrich(content, subject):
    current = deepcopy(content or {})
    starter = siaio_content() if subject == 'SIAIO' else olympiad_content(subject)
    if current.get('intro') in ('', None, OLD_INTROS[subject]):
        current['intro'] = starter['intro']
    if subject == 'SIAIO' and current.get('overview') == OLD_SIAIO_OVERVIEW:
        current['overview'] = starter['overview']
    if subject != 'SIAIO':
        if current.get('headline') == f'{subject} — {OLD_NAMES[subject]}':
            current['headline'] = starter['headline']
        if current.get('overview') == OLD_OVERVIEW:
            current['overview'] = starter['overview']
        if current.get('highlights') == OLD_HIGHLIGHTS:
            current['highlights'] = starter['highlights']
    if not current.get('resources'):
        current['resources'] = starter['resources']
    papers = current.setdefault('papers', {})
    paper_key = 'Trí tuệ nhân tạo' if subject == 'SIAIO' else subject
    paper_map = papers.setdefault(paper_key, {})
    for grade, url in starter['papers'][paper_key].items():
        if not paper_map.get(grade):
            paper_map[grade] = url
    registration = current.setdefault('registration', {})
    for key in ('excelUrl', 'handbookUrl'):
        if not registration.get(key):
            registration[key] = starter['registration'][key]
    contact = current.setdefault('contact', {})
    if not contact.get('email'):
        contact['email'] = starter['contact']['email']
    if contact.get('address') in ('', None, OLD_ADDRESS):
        contact['address'] = starter['contact']['address']
    return current


def update_landing_materials(apps, schema_editor):
    LandingSite = apps.get_model('examination', 'LandingSite')
    LandingTemplate = apps.get_model('examination', 'LandingTemplate')
    for slug, subject in [('fimo', 'FIMO'), ('fieo', 'FIEO'), ('siaio', 'SIAIO')]:
        for site in LandingSite.objects.filter(slug=slug):
            site.content = enrich(site.content, subject)
            fields = ['content']
            if subject != 'SIAIO' and site.title == f'{subject} · {OLD_NAMES[subject]}':
                site.title = f'{subject} · {olympiad_content(subject)["headline"].split(" — ", 1)[1]}'
                fields.append('title')
            site.save(update_fields=fields)
    for key, subject in [('olympiad', 'FIMO'), ('siaio', 'SIAIO')]:
        for template in LandingTemplate.objects.filter(key=key, is_system=True):
            template.content = enrich(template.content, subject)
            template.save(update_fields=['content'])


class Migration(migrations.Migration):
    dependencies = [('examination', '0045_publicexamregistration')]
    operations = [migrations.RunPython(update_landing_materials, migrations.RunPython.noop)]
