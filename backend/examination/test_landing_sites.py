from django.test import TestCase
from rest_framework.test import APIClient

from authentication.models import UserProfile
from .models import LandingLead, LandingSite


class LandingSiteTests(TestCase):
    def setUp(self):
        self.admin = UserProfile.objects.create(email='landing-studio@example.com', name='Landing Studio', role='ADMIN')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_two_olympiad_pages_are_public_with_separate_urls(self):
        for slug in ('fimo', 'fieo'):
            response = APIClient().get(f'/api/public/landing-sites/{slug}')
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data['slug'], slug)
            self.assertEqual(len(response.data['content']['papers'][slug.upper()]), 9)

    def test_custom_page_can_be_created_edited_and_published(self):
        response = self.client.post('/api/landing-sites', {
            'title': 'Hội thảo mẫu', 'slug': 'hoi-thao-mau',
            'content': {'headline': 'Hội thảo mẫu', 'buttons': [{'label': 'Đăng ký', 'url': 'https://example.com/form'}]},
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        page_id = response.data['id']
        self.assertEqual(APIClient().get('/api/public/landing-sites/hoi-thao-mau').status_code, 404)
        updated = self.client.put(f'/api/landing-sites/{page_id}', {
            'title': 'Hội thảo mẫu', 'slug': 'hoi-thao-mau', 'published': True,
            'content': response.data['content'],
        }, format='json')
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(APIClient().get('/api/public/landing-sites/hoi-thao-mau').status_code, 200)

    def test_unsafe_button_link_is_rejected(self):
        site = LandingSite.objects.get(slug='fimo')
        response = self.client.put(f'/api/landing-sites/{site.pk}', {
            'title': site.title, 'slug': site.slug, 'published': True,
            'content': {'buttons': [{'label': 'Unsafe', 'url': 'javascript:alert(1)'}]},
        }, format='json')
        self.assertEqual(response.status_code, 400)

    def test_consultation_form_saves_a_lead(self):
        response = APIClient().post('/api/public/landing-sites/fimo/leads', {
            'fullName': 'Nguyễn An', 'phone': '0969627162', 'email': 'an@example.com',
            'schoolCity': 'Hà Nội', 'message': 'Tư vấn đăng ký',
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(LandingLead.objects.get().site.slug, 'fimo')
        self.assertEqual(self.client.get(f'/api/landing-sites/{LandingSite.objects.get(slug="fimo").pk}/leads').data['items'][0]['fullName'], 'Nguyễn An')
