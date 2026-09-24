"""Independent, block-editable landing pages and consultation enquiries."""

import re
from uuid import uuid4
from urllib.parse import urlparse

from django.core.cache import cache
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.utils.text import slugify
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from authentication.permissions import IsAuthenticated
from .landing_templates import olympiad_content, siaio_content
from .models import CompetitionLandingPage, LandingLead, LandingSite, LandingTemplate


URL_KEYS = {'url', 'logoUrl', 'schoolUrl', 'excelUrl', 'individualUrl',
            'handbookUrl', 'zaloUrl', 'facebookFimoUrl', 'facebookFieoUrl', 'buttonUrl'}
BANK_KEYS = {'bankName', 'accountName', 'accountNumber', 'transferNote'}


def _valid_link(value):
    if not value:
        return True
    if value.startswith(('/', '#')) and not value.startswith('//'):
        return True
    parsed = urlparse(value)
    if parsed.scheme in ('http', 'https'):
        return bool(parsed.netloc)
    return parsed.scheme in ('mailto', 'tel') and bool(parsed.path)


def _clean_content(value):
    if isinstance(value, dict):
        return {str(key)[:80]: _clean_content(item) if key not in URL_KEYS else _clean_link(item)
                for key, item in list(value.items())[:100] if key not in BANK_KEYS}
    if isinstance(value, list):
        return [_clean_content(item) for item in value[:100]]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return str(value)[:4000] if isinstance(value, str) else value
    return ''


def _clean_link(value):
    link = str(value or '').strip()[:2000]
    if not _valid_link(link):
        raise ValueError('Liên kết chỉ được dùng http(s), mailto, tel hoặc đường dẫn nội bộ.')
    return link


def _without_bank_details(value):
    if isinstance(value, dict):
        return {key: _without_bank_details(item) for key, item in value.items()
                if key not in BANK_KEYS}
    if isinstance(value, list):
        return [_without_bank_details(item) for item in value]
    return value


def _payload(site):
    return {'id': site.id, 'slug': site.slug, 'title': site.title,
            'template': site.template, 'layout': site.layout, 'content': _without_bank_details(site.content),
            'published': site.published, 'updatedAt': site.updated_at.isoformat(),
            'updatedBy': site.updated_by}


def _template_payload(template):
    return {'key': template.key, 'name': template.name,
            'description': template.description, 'layout': template.layout,
            'content': _without_bank_details(template.content), 'isSystem': template.is_system,
            'updatedAt': template.updated_at.isoformat()}


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def landing_templates(request):
    if request.method == 'GET':
        return Response({'items': [_template_payload(item) for item in LandingTemplate.objects.all()]})
    data = request.data or {}
    name = str(data.get('name') or '').strip()[:160]
    if not name:
        return Response({'error': 'Cần nhập tên mẫu.'}, status=400)
    try:
        content = _clean_content(data.get('content') or {})
    except ValueError as error:
        return Response({'error': str(error)}, status=400)
    template = LandingTemplate.objects.create(
        key=f'mau-{uuid4().hex[:12]}', name=name,
        description=str(data.get('description') or '').strip()[:300],
        layout='olympiad', content=content,
        updated_by=getattr(request.user, 'email', '') or '',
    )
    return Response(_template_payload(template), status=201)


@api_view(['PUT', 'DELETE'])
@permission_classes([IsAuthenticated])
def landing_template_detail(request, key):
    template = LandingTemplate.objects.filter(key=key).first()
    if not template:
        return Response({'error': 'Mẫu không tồn tại.'}, status=404)
    if template.is_system:
        return Response({'error': 'Mẫu mặc định chỉ có thể nhân bản.'}, status=400)
    if request.method == 'DELETE':
        if LandingSite.objects.filter(template=key).exists():
            return Response({'error': 'Mẫu đang được sử dụng bởi landing page.'}, status=400)
        template.delete()
        return Response(status=204)
    data = request.data or {}
    name = str(data.get('name') or '').strip()[:160]
    if not name:
        return Response({'error': 'Cần nhập tên mẫu.'}, status=400)
    try:
        content = _clean_content(data.get('content') or {})
    except ValueError as error:
        return Response({'error': str(error)}, status=400)
    template.name = name
    template.description = str(data.get('description') or '').strip()[:300]
    template.content = content
    template.updated_by = getattr(request.user, 'email', '') or ''
    template.save()
    return Response(_template_payload(template))


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def landing_sites(request):
    if request.method == 'GET':
        return Response({'items': [_payload(site) for site in LandingSite.objects.all()]})
    data = request.data or {}
    title = str(data.get('title') or '').strip()[:300]
    slug = slugify(str(data.get('slug') or title))[:120]
    if not title or not slug:
        return Response({'error': 'Cần nhập tên trang và đường dẫn.'}, status=400)
    if LandingSite.objects.filter(slug=slug).exists() or CompetitionLandingPage.objects.filter(slug=slug).exists():
        return Response({'error': 'Đường dẫn đã được sử dụng.'}, status=400)
    template_key = str(data.get('template') or 'olympiad')
    template = LandingTemplate.objects.filter(key=template_key).first()
    if not template:
        return Response({'error': 'Mẫu trang không tồn tại.'}, status=400)
    try:
        subject = data.get('subject')
        starter = (olympiad_content(subject) if template.key == 'olympiad' and subject in ('FIMO', 'FIEO')
                   else siaio_content() if template.key == 'siaio' else template.content)
        content = _clean_content(data.get('content') if 'content' in data else starter)
    except ValueError as error:
        return Response({'error': str(error)}, status=400)
    site = LandingSite.objects.create(
        title=title, slug=slug, template=template.key, layout=template.layout, content=content,
        published=False, updated_by=getattr(request.user, 'email', '') or '',
    )
    return Response(_payload(site), status=status.HTTP_201_CREATED)


@api_view(['PUT', 'DELETE'])
@permission_classes([IsAuthenticated])
def landing_site_detail(request, site_id):
    site = LandingSite.objects.filter(pk=site_id).first()
    if not site:
        return Response({'error': 'Trang không tồn tại.'}, status=404)
    if request.method == 'DELETE':
        site.delete()
        return Response(status=204)
    data = request.data or {}
    slug = slugify(str(data.get('slug') or site.slug))[:120]
    if not slug or LandingSite.objects.filter(slug=slug).exclude(pk=site.pk).exists() or CompetitionLandingPage.objects.filter(slug=slug).exists():
        return Response({'error': 'Đường dẫn không hợp lệ hoặc đã được sử dụng.'}, status=400)
    try:
        content = _clean_content(data.get('content') or {})
    except ValueError as error:
        return Response({'error': str(error)}, status=400)
    site.slug = slug
    site.title = str(data.get('title') or '').strip()[:300] or site.title
    site.content = content
    site.published = data.get('published') is True
    site.updated_by = getattr(request.user, 'email', '') or ''
    site.save()
    return Response(_payload(site))


@api_view(['GET'])
@permission_classes([AllowAny])
def public_landing_site(request, slug):
    site = LandingSite.objects.filter(slug=slug, published=True).first()
    if not site:
        return Response({'error': 'Trang không tồn tại hoặc chưa công bố.'}, status=404)
    return Response(_payload(site))


@api_view(['POST'])
@permission_classes([AllowAny])
def landing_site_lead(request, slug):
    site = LandingSite.objects.filter(slug=slug, published=True).first()
    if not site:
        return Response({'error': 'Trang không tồn tại.'}, status=404)
    data = request.data or {}
    if data.get('website'):
        return Response({'ok': True}, status=201)
    name = str(data.get('fullName') or '').strip()[:200]
    phone = str(data.get('phone') or '').strip()[:40]
    email = str(data.get('email') or '').strip()[:254]
    if not name or not re.fullmatch(r'[+\d\s().-]{9,40}', phone) or len(re.sub(r'\D', '', phone)) < 9:
        return Response({'error': 'Vui lòng nhập họ tên và số điện thoại hợp lệ.'}, status=400)
    if email:
        try:
            validate_email(email)
        except ValidationError:
            return Response({'error': 'Email không hợp lệ.'}, status=400)
    ip = request.META.get('REMOTE_ADDR', '')
    key = f'landing-lead:{site.pk}:{ip}'
    if not cache.add(key, 1, timeout=3600):
        try:
            count = cache.incr(key)
        except ValueError:
            cache.set(key, 1, timeout=3600)
            count = 1
        if count > 5:
            return Response({'error': 'Bạn đã gửi quá nhiều lần. Vui lòng thử lại sau.'}, status=429)
    LandingLead.objects.create(
        site=site, full_name=name, phone=phone, email=email,
        school_city=str(data.get('schoolCity') or '').strip()[:300],
        message=str(data.get('message') or '').strip()[:4000],
    )
    return Response({'ok': True}, status=201)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def landing_site_leads(request, site_id):
    return Response({'items': [
        {'fullName': lead.full_name, 'phone': lead.phone, 'email': lead.email,
         'schoolCity': lead.school_city, 'message': lead.message,
         'createdAt': lead.created_at.isoformat()}
        for lead in LandingLead.objects.filter(site_id=site_id).order_by('-created_at')[:200]
    ]})
