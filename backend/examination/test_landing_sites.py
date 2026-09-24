from django.test import TestCase
from rest_framework.test import APIClient

from authentication.models import UserProfile
from .models import LandingLead, LandingSite, LandingTemplate


class LandingSiteTests(TestCase):
    def test_siaio_starter_is_draft_with_subject_picker(self):
        site = LandingSite.objects.get(slug='siaio')
        self.assertFalse(site.published)
        self.assertEqual(site.layout, 'siaio')
        self.assertIn('Trí tuệ nhân tạo', site.content['paperSubjects'])

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

    def test_first_template_creates_independent_fimo_and_fieo_pages(self):
        templates = self.client.get('/api/landing-templates')
        self.assertEqual(templates.status_code, 200)
        self.assertEqual(templates.data['items'][0]['name'], 'Mẫu 1 · Olympic học thuật')
        self.assertTrue(templates.data['items'][0]['isSystem'])
        created = self.client.post('/api/landing-sites', {
            'title': 'FIEO mùa mới', 'slug': 'fieo-mua-moi',
            'template': 'olympiad', 'subject': 'FIEO',
        }, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data['content']['subject'], 'FIEO')
        self.assertEqual(created.data['layout'], 'olympiad')
        self.assertFalse(created.data['published'])
        self.assertEqual(LandingTemplate.objects.get(key='olympiad').content['subject'], 'FIMO')

    def test_saved_template_is_reusable_without_linking_page_content(self):
        template = self.client.post('/api/landing-templates', {
            'name': 'Mẫu hội thảo', 'content': {'headline': 'Hội thảo', 'buttons': [{'label': 'Tham gia', 'url': 'https://example.com'}]},
        }, format='json')
        self.assertEqual(template.status_code, 201, template.data)
        key = template.data['key']
        page = self.client.post('/api/landing-sites', {
            'title': 'Hội thảo tháng 10', 'slug': 'hoi-thao-thang-10', 'template': key,
        }, format='json')
        self.assertEqual(page.status_code, 201, page.data)
        self.assertEqual(page.data['content']['headline'], 'Hội thảo')
        updated = self.client.put(f'/api/landing-templates/{key}', {
            'name': 'Mẫu hội thảo mới', 'content': {'headline': 'Nội dung mới'},
        }, format='json')
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(LandingSite.objects.get(pk=page.data['id']).content['headline'], 'Hội thảo')
        self.assertEqual(self.client.delete(f'/api/landing-templates/{key}').status_code, 400)

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
