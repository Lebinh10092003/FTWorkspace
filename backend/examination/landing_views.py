"""Trang giới thiệu cuộc thi: quản trị trong Workspace, hiển thị công khai.

Nội dung tiếp thị nằm trong ``CompetitionLandingPage``; lịch thi, vòng thi và
số liệu thí sinh được dựng lại từ dữ liệu Khảo thí ở mỗi lần gọi để trang công
khai không bao giờ hiển thị một lịch đã cũ.
"""

import re
import unicodedata

from django.utils.text import slugify
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from authentication.permissions import IsAuthenticated

from .models import (
    CandidateParticipation,
    Competition,
    CompetitionLandingPage,
    ExamSession,
)

DATE_PATTERN = re.compile(r'^\d{4}-\d{2}-\d{2}$')
TEXT_BLOCK_FIELDS = {
    'highlights': ('title', 'description'),
    'prizes': ('title', 'description'),
    'faqs': ('question', 'answer'),
    'organizers': ('name', 'role'),
}


def _slug_source(value):
    text = unicodedata.normalize('NFD', str(value or ''))
    text = ''.join(char for char in text if unicodedata.category(char) != 'Mn')
    return text.replace('Đ', 'D').replace('đ', 'd')


def unique_slug(competition, requested=''):
    """Đường dẫn công khai, ưu tiên giá trị người dùng nhập."""
    base = slugify(_slug_source(requested or competition.code or competition.name)) or 'cuoc-thi'
    base = base[:110]
    candidate = base
    index = 2
    while (
        CompetitionLandingPage.objects.filter(slug=candidate)
        .exclude(competition_id=competition.id)
        .exists()
    ):
        candidate = f'{base}-{index}'[:120]
        index += 1
    return candidate


def _clean_blocks(value, keys):
    if not isinstance(value, list):
        return []
    blocks = []
    for raw in value[:40]:
        if not isinstance(raw, dict):
            continue
        block = {key: str(raw.get(key) or '').strip()[:2000] for key in keys}
        if any(block.values()):
            blocks.append(block)
    return blocks


def _round_entries(session):
    """Các vòng thi của một kỳ thi, kể cả bản ghi cũ chỉ có vòng quốc gia/quốc tế."""
    configured = [
        item for item in (session.rounds or [])
        if isinstance(item, dict) and str(item.get('name') or '').strip()
    ]
    if not configured:
        legacy = []
        if session.national or session.national_date:
            legacy.append({'id': 'legacy-national', 'name': 'Vòng Chung kết Quốc gia',
                           'label': session.national or '', 'date': session.national_date or ''})
        if session.international or session.international_date:
            legacy.append({'id': 'legacy-international', 'name': 'Vòng Chung kết Quốc tế',
                           'label': session.international or '', 'date': session.international_date or ''})
        configured = legacy
    entries = []
    for item in configured:
        slots = item.get('slots') if isinstance(item.get('slots'), list) else []
        dates = [item.get('date')] + [
            slot.get('date') for slot in slots if isinstance(slot, dict)
        ]
        dates = sorted({
            str(value).strip() for value in dates
            if DATE_PATTERN.match(str(value or '').strip())
        })
        entries.append({
            'id': str(item.get('id') or ''),
            'name': str(item.get('name') or '').strip(),
            'label': str(item.get('label') or '').strip(),
            'mode': str(item.get('mode') or '').strip(),
            'dates': dates,
        })
    return entries


def _examination_data(competition):
    """Bảng thi, vòng thi và số liệu thí sinh đọc trực tiếp từ Khảo thí."""
    sessions = list(
        ExamSession.objects.filter(competition_id=competition.id).order_by('sort_key')[:200]
    )
    session_ids = [session.id for session in sessions]
    candidate_total = (
        CandidateParticipation.objects.filter(session_id__in=session_ids)
        .values('candidate_id').distinct().count()
        if session_ids else 0
    )
    session_payload = []
    every_date = []
    for session in sessions:
        rounds = _round_entries(session)
        for entry in rounds:
            every_date.extend(entry['dates'])
        session_payload.append({
            'id': session.id,
            'code': session.code,
            'name': session.name,
            'time': session.time,
            'organizer': session.organizer,
            'phase': session.phase,
            'candidates': session.candidates_count,
            'rounds': rounds,
        })
    every_date = sorted(set(every_date))
    stats = {
        'sessions': len(session_payload),
        'rounds': sum(len(item['rounds']) for item in session_payload),
        'candidates': candidate_total,
        'firstDate': every_date[0] if every_date else '',
        'lastDate': every_date[-1] if every_date else '',
    }
    return session_payload, stats


def _public_payload(landing):
    competition = landing.competition
    session_payload, stats = _examination_data(competition)
    return {
        'slug': landing.slug,
        'competition': {
            'id': competition.id,
            'code': competition.code,
            'name': competition.name,
            'organizer': competition.organizer,
        },
        'tagline': landing.tagline,
        'heroDescription': landing.hero_description,
        'heroImageUrl': landing.hero_image_url,
        'aboutTitle': landing.about_title,
        'aboutBody': landing.about_body,
        'registrationUrl': landing.registration_url,
        'registrationNote': landing.registration_note,
        'contact': {
            'email': landing.contact_email,
            'phone': landing.contact_phone,
            'address': landing.contact_address,
        },
        'highlights': landing.highlights or [],
        'prizes': landing.prizes or [],
        'faqs': landing.faqs or [],
        'organizers': landing.organizers or [],
        'sessions': session_payload,
        'stats': stats,
        'updatedAt': landing.updated_at.isoformat(),
    }


def _admin_payload(competition, landing):
    # Bản xem trước trong Workspace dùng đúng dữ liệu của trang công khai, kể cả
    # khi trang chưa được công bố và chưa mở được bằng đường dẫn.
    session_payload, stats = _examination_data(competition)
    return {
        'sessions': session_payload,
        'stats': stats,
        'competitionId': competition.id,
        'competitionCode': competition.code,
        'competitionName': competition.name,
        'organizer': competition.organizer,
        'sessionCount': stats['sessions'],
        'slug': landing.slug if landing else '',
        'published': bool(landing and landing.published),
        'tagline': landing.tagline if landing else '',
        'heroDescription': landing.hero_description if landing else '',
        'heroImageUrl': landing.hero_image_url if landing else '',
        'aboutTitle': landing.about_title if landing else '',
        'aboutBody': landing.about_body if landing else '',
        'registrationUrl': landing.registration_url if landing else '',
        'registrationNote': landing.registration_note if landing else '',
        'contactEmail': landing.contact_email if landing else '',
        'contactPhone': landing.contact_phone if landing else '',
        'contactAddress': landing.contact_address if landing else '',
        'highlights': (landing.highlights if landing else []) or [],
        'prizes': (landing.prizes if landing else []) or [],
        'faqs': (landing.faqs if landing else []) or [],
        'organizers': (landing.organizers if landing else []) or [],
        'updatedAt': landing.updated_at.isoformat() if landing else '',
        'updatedBy': landing.updated_by if landing else '',
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def landing_pages(request):
    landing_by_competition = {
        item.competition_id: item
        for item in CompetitionLandingPage.objects.select_related('competition')
    }
    rows = [
        _admin_payload(competition, landing_by_competition.get(competition.id))
        for competition in Competition.objects.order_by('sort_key')[:500]
    ]
    return Response({'items': rows})


@api_view(['PUT'])
@permission_classes([IsAuthenticated])
def landing_page_detail(request, competition_id):
    competition = Competition.objects.filter(id=competition_id).first()
    if not competition:
        return Response({'error': 'Cuộc thi không tồn tại.'}, status=status.HTTP_404_NOT_FOUND)
    data = request.data or {}
    landing = CompetitionLandingPage.objects.filter(competition_id=competition.id).first()
    if not landing:
        landing = CompetitionLandingPage(competition=competition)
    requested_slug = str(data.get('slug') or '').strip()
    if requested_slug or not landing.slug:
        landing.slug = unique_slug(competition, requested_slug)
    landing.published = bool(data.get('published'))
    landing.tagline = str(data.get('tagline') or '').strip()[:300]
    landing.hero_description = str(data.get('heroDescription') or '').strip()[:4000]
    landing.hero_image_url = str(data.get('heroImageUrl') or '').strip()[:2000]
    landing.about_title = str(data.get('aboutTitle') or '').strip()[:300]
    landing.about_body = str(data.get('aboutBody') or '').strip()[:8000]
    landing.registration_url = str(data.get('registrationUrl') or '').strip()[:2000]
    landing.registration_note = str(data.get('registrationNote') or '').strip()[:500]
    landing.contact_email = str(data.get('contactEmail') or '').strip()[:255]
    landing.contact_phone = str(data.get('contactPhone') or '').strip()[:100]
    landing.contact_address = str(data.get('contactAddress') or '').strip()[:500]
    for field, keys in TEXT_BLOCK_FIELDS.items():
        setattr(landing, field, _clean_blocks(data.get(field), keys))
    landing.updated_by = getattr(request.user, 'email', '') or ''
    landing.save()
    return Response(_admin_payload(competition, landing))


@api_view(['GET'])
@permission_classes([AllowAny])
def public_competition_landing(request, slug):
    landing = (
        CompetitionLandingPage.objects.select_related('competition')
        .filter(slug=slug, published=True).first()
    )
    if not landing:
        return Response(
            {'error': 'Trang giới thiệu không tồn tại hoặc chưa được công bố.'},
            status=status.HTTP_404_NOT_FOUND,
        )
    return Response(_public_payload(landing))
