from authentication.models import Department, UserProfile, WorkspaceNotification
from importlib import import_module
from django.apps import apps as django_apps
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient
from unittest.mock import MagicMock, patch

from .models import Candidate, CandidateParticipation, Competition, ExamRoom, ExamSession, ExaminationSheet, LogNote, RoundResult


class AysbcOrganisationBatchMigrationTests(TestCase):
    def test_consolidation_keeps_both_attempts_of_one_profile(self):
        canonical, _ = ExamSession.objects.get_or_create(
            id='aysbc',
            defaults={'competition_id': 'aysbc', 'code': 'AYSBC', 'name': 'AYSBC', 'parent': 'AYSBC', 'organizer': 'SCSG & MK', 'time': '', 'sort_key': 'aysbc_aysbc'},
        )
        legacy = ExamSession.objects.create(
            id='session-351ba22f9c', competition_id='aysbc', code='AYSBC', name='AYSBC',
            parent='AYSBC', organizer='SCSG & MK', time='', sort_key='aysbc_session-351ba22f9c',
        )
        shared = Candidate.objects.create(id='AYSBC-SHARED', code='AYSBC-SHARED', name='Nguyễn Thị Phúc An', session_ids=[canonical.id, legacy.id], sort_key='shared')
        june_only = Candidate.objects.create(id='AYSBC-JUNE', code='AYSBC-JUNE', name='Thí sinh tháng 6', session_ids=[legacy.id], sort_key='june')
        current = CandidateParticipation.objects.create(candidate=shared, session=canonical)
        source_shared = CandidateParticipation.objects.create(candidate=shared, session=legacy)
        source_june = CandidateParticipation.objects.create(candidate=june_only, session=legacy)
        RoundResult.objects.create(participation=current, round_id='legacy-national', round_name='Vòng 1', exam_date='2026-07-26')
        RoundResult.objects.create(participation=source_shared, round_id='round-final', round_name='Vòng 1', exam_date='2026-06-21')
        RoundResult.objects.create(participation=source_june, round_id='round-final', round_name='Vòng 1', exam_date='2026-06-21')

        migration = import_module('examination.migrations.0031_round_organization_batches_and_merge_aysbc')
        migration.consolidate_aysbc(django_apps, None)

        self.assertFalse(ExamSession.objects.filter(id=legacy.id).exists())
        canonical.refresh_from_db()
        self.assertEqual([slot['id'] for slot in canonical.rounds[0]['slots']], ['aysbc-national-final-2026-06', 'aysbc-national-final-2026-07'])
        results = RoundResult.objects.filter(participation__candidate=shared, participation__session=canonical)
        self.assertEqual(results.count(), 2)
        self.assertEqual(set(results.values_list('occurrence_id', flat=True)), {'aysbc-national-final-2026-06', 'aysbc-national-final-2026-07'})
        june_only.refresh_from_db()
        self.assertEqual(june_only.session_ids, [canonical.id])


class ExistingSessionRoundBackfillTests(TestCase):
    def test_blank_legacy_session_receives_common_editable_rounds(self):
        session = ExamSession.objects.create(
            id='fieo-legacy', competition_id='fieo', code='FIEO', name='FIEO legacy',
            parent='FIEO', organizer='FermatTech', time='', sort_key='fieo-legacy',
        )

        from .views import ensure_examination_seed
        ensure_examination_seed()

        session.refresh_from_db()
        self.assertEqual(
            [round_config['name'] for round_config in session.rounds],
            ['Vòng loại Quốc gia', 'Vòng Chung kết Quốc gia', 'Vòng Quốc tế'],
        )
        self.assertTrue(all('slots' in round_config for round_config in session.rounds))

    def test_backfill_preserves_legacy_final_and_international_dates(self):
        session = ExamSession.objects.create(
            id='fimo-legacy', competition_id='fimo', code='FIMO', name='FIMO legacy',
            parent='FIMO', organizer='FermatTech', time='', sort_key='fimo-legacy',
            national='26/7/2026', national_date='2026-07-26',
            international='Tháng 9/2026', international_date='',
        )

        from .views import ensure_examination_seed, sync_legacy_round_milestones
        ensure_examination_seed()
        session.refresh_from_db()
        sync_legacy_round_milestones(session, session.rounds)

        self.assertEqual(session.rounds[1]['date'], '2026-07-26')
        self.assertEqual(session.rounds[1]['label'], '26/7/2026')
        self.assertEqual(session.rounds[2]['label'], 'Tháng 9/2026')
        self.assertEqual(session.national_date, '2026-07-26')
        self.assertEqual(session.national, '26/7/2026')

    def test_legacy_summary_prefers_national_final_and_clears_removed_international_round(self):
        session = ExamSession.objects.create(
            id='round-summary', competition_id='aysbc', code='AYSBC', name='Round summary',
            parent='AYSBC', organizer='SCS', time='', sort_key='round-summary',
            international='Stale date', international_date='2026-09-01',
        )
        from .views import sync_legacy_round_milestones

        sync_legacy_round_milestones(session, [
            {'id': 'qualifier', 'name': 'V\u00f2ng lo\u1ea1i Qu\u1ed1c gia', 'label': '17/5/2026', 'date': '2026-05-17'},
            {'id': 'final', 'name': 'V\u00f2ng Chung k\u1ebft Qu\u1ed1c gia', 'label': '7/6/2026', 'date': '2026-06-07'},
            {'id': 'regional', 'name': 'V\u00f2ng Khu v\u1ef1c', 'label': 'Th\u00e1ng 10/2026', 'date': ''},
        ])

        self.assertEqual(session.national, '7/6/2026')
        self.assertEqual(session.national_date, '2026-06-07')
        self.assertEqual(session.international, '')
        self.assertEqual(session.international_date, '')

class LogNoteApiTests(TestCase):
    def setUp(self):
        self.user = UserProfile.objects.create(email='lognote-admin@example.com', name='LogNote Admin', role='ADMIN')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = '/api/examination/lognotes/session-demo'

    def test_each_note_keeps_its_own_saved_timestamp(self):
        first = self.client.post(self.url, {'content': 'Tạo kỳ tổ chức.', 'actor': 'Quản trị viên'}, format='json')
        self.assertEqual(first.status_code, 201)
        first_id = first.data['note']['id']
        first_time = first.data['note']['time']

        second = self.client.post(self.url, {'content': 'Bổ sung ghi chú.', 'actor': 'Quản trị viên'}, format='json')
        self.assertEqual(second.status_code, 201)
        self.assertNotEqual(first_id, second.data['note']['id'])

        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 2)
        persisted_first = next(item for item in response.data if item['id'] == first_id)
        self.assertEqual(persisted_first['time'], first_time)
        self.assertEqual(LogNote.objects.filter(entity_key='session-demo').count(), 2)

    def test_partners_are_persisted_and_returned_in_bootstrap(self):
        payload = {'partners': [{
            'id': 'partner-persisted', 'province': 'Hà Nội', 'ward': 'Yên Hòa', 'school': 'Trường A', 'level': 'THCS',
            'representative': 'Nguyễn A', 'phone': '0900000000', 'email': 'a@example.com', 'contests': ['AYSBC'],
            'studentCounts': [{'session': 'AYSBC', 'count': 8}],
        }]}
        saved = self.client.put('/api/examination/partners', payload, format='json')
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.data['partners'][0]['school'], 'Trường A')
        bootstrap = self.client.get('/api/examination/bootstrap')
        self.assertEqual(bootstrap.status_code, 200)
        self.assertEqual(bootstrap.data['partners'][0]['studentCounts'][0]['count'], 8)
    def test_get_does_not_create_or_retime_a_log_note(self):
        self.assertEqual(self.client.get(self.url).data, [])
        self.assertFalse(LogNote.objects.exists())

    def test_manual_note_uses_authenticated_identity_and_cannot_spoof_system_event(self):
        response = self.client.post(
            self.url,
            {'content': 'Ghi chú kiểm tra.', 'actor': 'Người khác', 'system': True},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        note = LogNote.objects.get(entity_key='session-demo')
        self.assertEqual(note.updated_by, 'LogNote Admin')
        self.assertEqual(note.actor_email, self.user.email)
        self.assertFalse(note.system)
        self.assertEqual(response.data['note']['createdAt'], note.created_at.isoformat())

    def test_nested_partner_values_are_written_as_readable_text(self):
        response = self.client.put('/api/examination/partners', {'partners': [{
            'id': 'partner-readable', 'school': 'Trường A', 'contests': ['AYSBC'],
            'studentCounts': [{'session': 'AYSBC 2026', 'count': 8}],
        }]}, format='json')

        self.assertEqual(response.status_code, 200)
        content = LogNote.objects.get(entity_key='partner-partner-readable').content
        self.assertIn('Kỳ tổ chức: AYSBC 2026; Số lượng: 8', content)
        self.assertNotIn(chr(123) + chr(39) + 'session', content)

    def test_legacy_dictionary_change_log_is_humanized_when_read(self):
        before = {'name': 'Lớp A', 'studentCounts': [{'session': 'FIMO 2025', 'count': 4}]}
        after = {'name': 'Lớp B', 'studentCounts': [{'session': 'FIMO 2026', 'count': 8}]}
        LogNote.objects.create(
            key='legacy-change',
            entity_key='session-demo',
            updated_by='Legacy User',
            content=f'Cập nhật lớp. Thông tin trước: {before}. Thông tin sau: {after}.',
        )

        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        content = response.data[0]['content']
        quoted_change = f'Đã đổi Tên từ {chr(34)}Lớp A{chr(34)} thành {chr(34)}Lớp B{chr(34)}.'
        self.assertIn(quoted_change, content)
        self.assertIn('Kỳ tổ chức: FIMO 2026; Số lượng: 8', content)
        self.assertNotIn(chr(123) + chr(39) + 'name', content)

    def test_partner_recovery_accepts_python_dictionary_legacy_log(self):
        partner = {
            'id': 'partner-legacy',
            'school': 'Trường Legacy',
            'contests': ['FIMO'],
            'studentCounts': [{'session': 'FIMO 2026', 'count': 12}],
        }
        LogNote.objects.create(
            key='legacy-partner',
            entity_key='partner-partner-legacy',
            updated_by='Legacy User',
            content=f'Cập nhật đối tác. Thông tin trước: {dict()}. Thông tin sau: {partner}.',
        )

        response = self.client.get('/api/examination/partners')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['partners'][0]['school'], 'Trường Legacy')
        self.assertEqual(response.data['partners'][0]['studentCounts'][0]['count'], 12)


class CandidateRoundHistoryTests(TestCase):
    def setUp(self):
        self.session = ExamSession.objects.create(
            id='simo-2026', competition_id='simo', code='SIMO', name='SIMO 2026',
            parent='SCO - IMO', organizer='SCO', time='2026', sort_key='simo-2026',
        )
        self.candidate = Candidate.objects.create(
            id='FT26-9001', code='FT26-9001', name='Candidate One', sort_key='candidate-one',
        )
        email = 'round-admin@example.com'
        self.user = UserProfile.objects.create(email=email, name='Round Admin', role='ADMIN')
        django_user = get_user_model().objects.create_user(username=email, email=email, password='RoundAdmin9921')
        token = Token.objects.create(user=django_user).key
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')

    def test_candidate_update_writes_full_before_after_audit_to_candidate_and_session(self):
        self.candidate.session_ids = [self.session.id]
        self.candidate.school = 'Trường cũ'
        self.candidate.phone = '0900000000'
        self.candidate.save()

        response = self.client.put(
            f'/api/examination/candidates/{self.candidate.code}',
            {'school': 'Trường mới', 'phone': '0911222333'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        candidate_note = LogNote.objects.filter(entity_key=f'candidate-{self.candidate.code}').latest('created_at')
        self.assertIn('Đã đổi Trường học từ "Trường cũ" thành "Trường mới".', candidate_note.content)
        self.assertIn('Đã đổi Điện thoại từ "0900000000" thành "0911222333".', candidate_note.content)
        self.assertEqual(candidate_note.updated_by, 'round-admin@example.com')
        self.assertFalse(candidate_note.system)
        self.assertTrue(LogNote.objects.filter(entity_key=f'session-{self.session.id}', content__contains='Cập nhật hồ sơ thí sinh').exists())

    def test_one_session_tab_keeps_multiple_rounds_without_duplicates(self):
        from .views import serialize_candidate, upsert_participation_history

        upsert_participation_history(
            self.candidate,
            self.session.id,
            [
                {'round': 'Round 1', 'sbd': 'A-001', 'password': 'secret-round-1', 'score': '82'},
                {'round': 'Round 2', 'sbd': 'B-001', 'score': '91'},
            ],
            'https://docs.google.com/spreadsheets/d/example#gid=1',
        )
        upsert_participation_history(
            self.candidate,
            self.session.id,
            [{'round': 'Round 1', 'sbd': 'A-001', 'score': '86'}],
            'https://docs.google.com/spreadsheets/d/example#gid=1',
        )

        self.assertEqual(CandidateParticipation.objects.count(), 1)
        self.assertEqual(RoundResult.objects.count(), 2)
        self.assertEqual(RoundResult.objects.get(round_name='Round 1').score, '86')
        history = serialize_candidate(self.candidate)['examHistory']
        self.assertEqual(len(history), 2)
        self.assertEqual({item['sessionId'] for item in history}, {'simo-2026'})
        self.assertEqual(next(item for item in history if item['round'] == 'Round 1')['password'], 'secret-round-1')


    def test_export_rows_keep_all_rounds_in_one_session_row(self):
        from .views import upsert_participation_history
        from .sync import session_export_rows

        upsert_participation_history(
            self.candidate,
            self.session.id,
            [
                {'round': 'Round 1', 'sbd': 'A-001', 'password': 'secret-round-1', 'score': '82'},
                {'round': 'Round 2', 'sbd': 'B-001', 'score': '91'},
            ],
        )
        rows = session_export_rows(self.session.id)
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0][0], 'HỒ SƠ THÍ SINH')
        self.assertEqual(rows[1][1], 'Mã hồ sơ')
        self.assertEqual(rows[2][1], 'FT26-9001')
        self.assertIn('A-001', rows[2])
        self.assertIn('B-001', rows[2])

    def test_official_template_headers_keep_registration_and_all_rounds(self):
        from .sync import EXPORT_GROUP_HEADERS, EXPORT_HEADERS, history_from_sheet_row, merged_headers, resolve_column_indices

        headers = merged_headers([EXPORT_GROUP_HEADERS, EXPORT_HEADERS], 1)
        columns = resolve_column_indices(headers)
        self.assertEqual(columns['code'], 1)
        self.assertEqual(columns['subject'], 15)
        self.assertEqual(columns['highestRound'], 66)
        self.assertEqual(columns['achievement'], 67)
        self.assertEqual(columns['certificateLink'], 68)
        self.assertEqual(columns['generalNote'], 20)

        row = [''] * len(headers)
        row[21] = 'Đủ điều kiện'
        row[22] = 'SBD-001'
        row[31] = '91'
        row[37] = 'SBD-002'
        history = history_from_sheet_row(headers, row)
        self.assertEqual(len(history), 2)
        self.assertEqual(history[0]['eligibility'], 'Đủ điều kiện')
        self.assertEqual(history[0]['sbd'], 'SBD-001')
        self.assertEqual(history[0]['score'], '91')
        self.assertEqual(history[1]['sbd'], 'SBD-002')
    def test_round_score_does_not_match_exam_location(self):
        from .sync import history_from_sheet_row
        headers = [
            'V\u00f2ng 1: \u0110\u1ecba \u0111i\u1ec3m/Ph\u00f2ng thi', 'V\u00f2ng 1: \u0110i\u1ec3m',
            'V\u00f2ng 1: Tr\u1ea1ng th\u00e1i d\u1ef1 thi', 'V\u00f2ng 1: Link thi',
        ]
        history = history_from_sheet_row(headers, ['Room 1', '91/105', '\u0110\u00e3 c\u00f3 k\u1ebft qu\u1ea3', 'https://exam.example.test'])
        self.assertEqual(history[0]['location'], 'Room 1')
        self.assertEqual(history[0]['score'], '91/105')
        self.assertEqual(history[0]['attendance'], '\u0110\u00e3 c\u00f3 k\u1ebft qu\u1ea3')
        self.assertEqual(history[0]['link'], 'https://exam.example.test')

    def test_sbd_column_is_never_used_as_profile_code(self):
        from .sync import resolve_column_indices
        columns = resolve_column_indices(['Hồ sơ thí sinh: Họ và tên thí sinh', 'Vòng 1: Số báo danh (SBD)'])
        self.assertNotIn('code', columns)

    def test_manual_template_import_links_the_selected_competition(self):
        response = self.client.post('/api/examination/import/candidates', {
            'sessionId': self.session.id,
            'source': 'Template XLSX',
            'records': [{
                'code': 'HS-0001', 'name': 'Candidate Template', 'school': 'School A', 'birthDate': '2014',
                'subject': 'Toán', 'category': 'Bảng A', 'teamName': 'Nhóm 1', 'highestRound': 'Vòng 2',
            }],
        }, format='json')
        self.assertEqual(response.status_code, 200)
        candidate = Candidate.objects.get(code='HS-0001')
        self.assertEqual(candidate.contests, 'SIMO')
        participation = CandidateParticipation.objects.get(candidate=candidate, session=self.session)
        self.assertEqual(participation.subject, 'Toán')
        self.assertEqual(participation.category, 'Bảng A')
        self.assertEqual(participation.team_name, 'Nhóm 1')
    def test_import_assigns_ft_code_and_preserves_all_template_fields(self):
        response = self.client.post('/api/examination/import/candidates', {
            'sessionId': self.session.id,
            'source': 'Template XLSX',
            'records': [{
                'code': '', 'name': 'Candidate Imported', 'birthDate': '20/03/2014',
                'city': 'Hà Nội', 'ward': 'Phường Giảng Võ', 'school': 'School A',
                'examHistory': [{
                    'round': 'Vòng 1', 'date': '6/21/26', 'time': '09:00 - 10:00',
                    'mode': 'Trực tuyến', 'link': 'https://example.test/room',
                    'account': 'candidate.account', 'password': 'candidate.password',
                }],
            }],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        candidate = Candidate.objects.get(name='Candidate Imported')
        self.assertRegex(candidate.code, r'^FT-\d{5}$')
        self.assertEqual(candidate.birth_date, '2014-03-20')
        self.assertEqual(candidate.city, 'Hà Nội')
        result = RoundResult.objects.get(participation__candidate=candidate, round_name='Vòng 1')
        self.assertEqual(result.exam_date, '2026-06-21')
        self.assertEqual(result.time_slot, '09:00 - 10:00')
        self.assertEqual(result.account, 'candidate.account')
        self.assertEqual(result.password, 'candidate.password')
    def test_round_slots_persist_and_removal_updates_candidate_participation(self):
        from .views import upsert_participation_history

        update = self.client.put(
            f'/api/examination/sessions/{self.session.id}',
            {'rounds': [{'id': 'r1', 'name': 'V\u00f2ng Chung k\u1ebft Qu\u1ed1c gia', 'label': '26/7/2026', 'date': '2026-07-26', 'slots': [
                {'id': 'slot-1', 'date': '2026-07-26', 'time': '09:00 - 10:00', 'mode': 'Trực tuyến', 'link': 'https://example.test/room', 'location': ''},
                {'id': 'slot-2', 'date': '2026-07-27', 'time': '13:00 - 14:00', 'mode': 'Trực tiếp', 'link': '', 'location': 'Hà Nội'},
            ]}]},
            format='json',
        )
        self.assertEqual(update.status_code, 200)
        self.assertEqual(len(update.data['rounds'][0]['slots']), 2)
        session_note = LogNote.objects.filter(entity_key=f'session-{self.session.id}').latest('created_at')
        self.assertIn('Đã bổ sung Thông tin các vòng thi: Vòng Chung kết Quốc gia (26/7/2026).', session_note.content)
        self.assertNotIn('"id"', session_note.content)
        self.assertEqual(update.data['nationalDate'], '2026-07-26')
        self.assertEqual(update.data['national'], '26/7/2026')

        self.candidate.session_ids = [self.session.id]
        self.candidate.contests = 'SIMO'
        self.candidate.save()
        upsert_participation_history(self.candidate, self.session.id, [
            {'round': 'Round 1', 'sbd': 'A-001'},
            {'round': 'Round 2', 'sbd': 'B-001'},
        ])
        second = RoundResult.objects.get(round_name='Round 2')
        response = self.client.delete(f'/api/examination/round-results/{second.id}?removeFromSession=0')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(CandidateParticipation.objects.filter(candidate=self.candidate, session=self.session).exists())

        first = RoundResult.objects.get(round_name='Round 1')
        response = self.client.delete(f'/api/examination/round-results/{first.id}?removeFromSession=1')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(CandidateParticipation.objects.filter(candidate=self.candidate, session=self.session).exists())
        self.assertEqual(response.data['candidate']['sessionIds'], [])

class ExamRoomAllocationTests(TestCase):
    def setUp(self):
        self.user = UserProfile.objects.create(email='rooms-admin@example.com', name='Rooms Admin', role='ADMIN')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.competition = Competition.objects.create(
            id='room-comp', code='ROOM', name='Room Competition', parent='ROOM',
            organizer='FermatTech', sort_key='room-comp',
        )
        self.session = ExamSession.objects.create(
            id='room-session', competition_id=self.competition.id, code='ROOM', name='Room Session',
            parent='ROOM', organizer='FermatTech', time='', sort_key='room-session',
            rounds=[{'id': 'round-1', 'name': 'Vòng 1', 'label': '', 'date': '', 'slots': []}],
        )
        for index in range(5):
            candidate = Candidate.objects.create(
                id=f'ROOM-{index + 1:03d}', code=f'ROOM-{index + 1:03d}', name=f'Thí sinh {index + 1}',
                school='Trường A', session_ids=[self.session.id], contests='ROOM',
                sort_key=f'candidate-{index + 1:03d}',
            )
            participation = CandidateParticipation.objects.create(candidate=candidate, session=self.session)
            RoundResult.objects.create(
                participation=participation,
                round_id='round-1',
                round_name='Round 1' if index == 0 else 'Vòng 1',
            )
        self.url = f'/api/examination/sessions/{self.session.id}/rounds/round-1/rooms'

    def test_balanced_allocation_persists_rooms_and_candidate_round_data(self):
        response = self.client.post(self.url, {
            'commonName': 'Phòng thi A',
            'mode': 'IN_PERSON',
            'allocationStrategy': 'BALANCED',
            'rooms': [
                {'number': '101', 'location': 'Tầng 1, 10 Trần Phú'},
                {'number': '102', 'location': 'Tầng 1, 10 Trần Phú'},
            ],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['candidateCount'], 5)
        self.assertEqual(response.data['assignedCount'], 5)
        self.assertEqual(sorted(room.assignments.count() for room in ExamRoom.objects.all()), [2, 3])
        self.assertEqual(len(response.data['updatedCandidates']), 5)
        first_round = response.data['updatedCandidates'][0]['participations'][0]['rounds'][0]
        self.assertTrue(first_round['roomId'])
        self.assertTrue(first_round['roomName'].startswith('Phòng thi A'))
        self.assertIn('10 Trần Phú', first_round['location'])
        self.assertEqual(first_round['mode'], 'Trực tiếp')

        listing = self.client.get(self.url)
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.data['candidateCount'], 5)
        self.assertEqual(listing.data['assignedCount'], 5)
        self.assertEqual(len(listing.data['rooms']), 2)

    def test_reallocation_clears_rooms_for_candidates_no_longer_eligible(self):
        first = self.client.post(self.url, {
            'commonName': 'Phòng cũ',
            'mode': 'IN_PERSON',
            'allocationStrategy': 'BALANCED',
            'rooms': [{'number': '101', 'location': 'Hà Nội'}],
        }, format='json')
        self.assertEqual(first.status_code, 200)
        excluded = RoundResult.objects.get(participation__candidate_id='ROOM-001')
        excluded.eligibility = 'Không đủ điều kiện'
        excluded.save(update_fields=['eligibility'])

        second = self.client.post(self.url, {
            'commonName': 'Phòng mới',
            'mode': 'IN_PERSON',
            'allocationStrategy': 'BALANCED',
            'rooms': [{'number': '201', 'location': 'Hà Nội'}],
        }, format='json')

        self.assertEqual(second.status_code, 200)
        excluded.refresh_from_db()
        self.assertIsNone(excluded.exam_room)
        self.assertEqual(excluded.room_name, '')
        self.assertEqual(excluded.location, '')
        self.assertEqual(ExamRoom.objects.get().label, 'Phòng mới 201')
    def test_capacity_allocation_rejects_insufficient_rooms_without_replacing_data(self):
        ExamRoom.objects.create(
            session=self.session, round_id='round-1', round_name='Vòng 1', common_name='Phòng cũ',
            room_number='A', label='Phòng cũ A', mode=ExamRoom.MODE_IN_PERSON, location='Địa chỉ cũ',
        )

        response = self.client.post(self.url, {
            'commonName': 'Phòng mới',
            'mode': 'IN_PERSON',
            'allocationStrategy': 'CAPACITY',
            'maxCandidates': 2,
            'rooms': [
                {'number': '1', 'location': 'Hà Nội'},
                {'number': '2', 'location': 'Hà Nội'},
            ],
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('chỉ có 4 chỗ', response.data['error'])
        self.assertTrue(ExamRoom.objects.filter(label='Phòng cũ A').exists())

    def test_online_room_assignment_is_ready_for_google_sheet_export(self):
        from .sync import PROFILE_EXPORT_HEADERS, REGISTRATION_EXPORT_HEADERS, session_export_rows

        RoundResult.objects.update(link='https://exam.example.test/start')

        response = self.client.post(self.url, {
            'commonName': 'Zoom',
            'mode': 'ONLINE',
            'allocationStrategy': 'CAPACITY',
            'maxCandidates': 3,
            'rooms': [
                {'number': '01', 'link': 'https://meet.example.test/room-01'},
                {'number': '02', 'link': 'https://meet.example.test/room-02'},
            ],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        results = list(RoundResult.objects.order_by('participation__candidate__sort_key'))
        self.assertEqual([result.room_name for result in results[:3]], ['Zoom 01'] * 3)
        self.assertEqual([result.room_name for result in results[3:]], ['Zoom 02'] * 2)
        self.assertTrue(all(result.mode == 'Trực tuyến' for result in results))
        self.assertEqual([result.location for result in results[:3]], ['Zoom 01:\nhttps://meet.example.test/room-01'] * 3)
        self.assertEqual([result.location for result in results[3:]], ['Zoom 02:\nhttps://meet.example.test/room-02'] * 2)
        self.assertTrue(all(result.link == 'https://exam.example.test/start' for result in results))

        exported = session_export_rows(self.session.id)
        round_start = len(PROFILE_EXPORT_HEADERS) + len(REGISTRATION_EXPORT_HEADERS)
        self.assertEqual(exported[2][round_start + 4], 'Trực tuyến')
        self.assertEqual(exported[2][round_start + 5], 'Zoom 01:\nhttps://meet.example.test/room-01')
        self.assertEqual(exported[2][round_start + 6], 'https://exam.example.test/start')


    def test_room_specific_exam_links_are_assigned_separately(self):
        response = self.client.post(self.url, {
            'commonName': 'Zoom',
            'mode': 'ONLINE',
            'allocationStrategy': 'CAPACITY',
            'maxCandidates': 3,
            'rooms': [
                {'number': '01', 'link': 'https://meet.example.test/room-01', 'examLink': 'https://exam.example.test/start-a'},
                {'number': '02', 'link': 'https://meet.example.test/room-02', 'examLink': 'https://exam.example.test/start-b'},
            ],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        results = list(RoundResult.objects.order_by('participation__candidate__sort_key'))
        self.assertEqual([result.link for result in results[:3]], ['https://exam.example.test/start-a'] * 3)
        self.assertEqual([result.link for result in results[3:]], ['https://exam.example.test/start-b'] * 2)
        self.assertEqual(
            list(ExamRoom.objects.order_by('room_number').values_list('exam_link', flat=True)),
            ['https://exam.example.test/start-a', 'https://exam.example.test/start-b'],
        )
    def test_meet_and_facebook_links_without_protocol_are_normalized(self):
        response = self.client.post(self.url, {
            'commonName': 'Phòng trực tuyến',
            'mode': 'ONLINE',
            'allocationStrategy': 'BALANCED',
            'rooms': [
                {'number': 'Meet', 'link': 'meet.google.com/abc-defg-hij'},
                {'number': 'Facebook', 'link': 'm.facebook.com/groups/example'},
            ],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            set(ExamRoom.objects.values_list('link', flat=True)),
            {'https://meet.google.com/abc-defg-hij', 'https://m.facebook.com/groups/example'},
        )
    def test_import_uses_stable_round_id_when_round_name_changes(self):
        from .views import upsert_participation_history

        candidate = Candidate.objects.get(id='ROOM-001')
        upsert_participation_history(candidate, self.session.id, [{
            'roundId': 'round-1',
            'round': 'Renamed round',
            'sbd': 'ROOM-UPDATED',
        }])

        participation = CandidateParticipation.objects.get(candidate=candidate, session=self.session)
        self.assertEqual(participation.round_results.count(), 1)
        result = participation.round_results.get()
        self.assertEqual(result.round_id, 'round-1')
        self.assertEqual(result.sbd, 'ROOM-UPDATED')

    def test_sheet_location_creates_room_and_assigns_candidate_automatically(self):
        from .views import upsert_participation_history

        candidate = Candidate.objects.get(id='ROOM-001')
        location = 'ISO 2026 – International Final Round Room 03:\nhttps://meet.google.com/mka-jxig-ade'
        upsert_participation_history(candidate, self.session.id, [{
            'roundId': 'round-1',
            'round': 'Vòng 1',
            'mode': 'Trực tuyến',
            'location': location,
        }])

        result = RoundResult.objects.get(participation__candidate=candidate, round_id='round-1')
        self.assertIsNotNone(result.exam_room)
        self.assertEqual(result.room_name, 'ISO 2026 – International Final Round Room 03')
        self.assertEqual(result.exam_room.mode, ExamRoom.MODE_ONLINE)
        self.assertEqual(result.exam_room.link, 'https://meet.google.com/mka-jxig-ade')

        other_candidate = Candidate.objects.get(id='ROOM-002')
        upsert_participation_history(other_candidate, self.session.id, [{
            'roundId': 'round-1',
            'round': 'Vòng 1',
            'mode': 'Trực tuyến',
            'location': location,
        }])
        self.assertEqual(ExamRoom.objects.count(), 1)
        self.assertEqual(
            RoundResult.objects.get(participation__candidate=other_candidate, round_id='round-1').exam_room_id,
            result.exam_room_id,
        )


    def test_room_counts_and_manual_updates_use_only_the_two_eligibility_states(self):
        result = RoundResult.objects.get(participation__candidate_id='ROOM-001')
        result.eligibility = 'Không đủ điều kiện tham gia Vòng 1'
        result.save(update_fields=['eligibility'])

        listing = self.client.get(self.url)
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.data['candidateCount'], 4)

        response = self.client.put(
            f'/api/examination/round-results/{result.id}',
            {'eligibility': 'Đủ điều kiện tham gia Vòng 1'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        result.refresh_from_db()
        self.assertEqual(result.eligibility, 'Đủ điều kiện')


    def test_apply_configured_slot_updates_schedule_without_touching_room(self):
        self.session.rounds = [{
            'id': 'round-1', 'name': 'Vòng 1', 'label': '', 'date': '',
            'slots': [
                {'id': 'morning', 'date': '2026-08-09', 'time': '10:30 - 11:30', 'mode': 'Trực tuyến', 'link': 'https://exam.example.test/common'},
                {'id': 'afternoon', 'date': '2026-08-09', 'time': '14:00 - 15:00', 'mode': 'Trực tuyến', 'link': 'https://exam.example.test/afternoon'},
            ],
        }]
        self.session.save(update_fields=['rounds'])
        first = RoundResult.objects.get(participation__candidate_id='ROOM-001')
        first.location = 'Room 101: https://meet.example.test/room'
        first.room_name = 'Room 101'
        first.save(update_fields=['location', 'room_name'])
        endpoint = f'/api/examination/sessions/{self.session.id}/rounds/round-1/apply-slot'

        response = self.client.post(endpoint, {'slotId': 'morning', 'slotIndex': 0, 'applyLink': True}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['candidateCount'], 5)
        self.assertEqual(response.data['updatedCount'], 5)
        results = list(RoundResult.objects.order_by('participation__candidate__code'))
        self.assertTrue(all(result.exam_date == '2026-08-09' for result in results))
        self.assertTrue(all(result.time_slot == '10:30 - 11:30' for result in results))
        self.assertTrue(all(result.link == 'https://exam.example.test/common' for result in results))
        first.refresh_from_db()
        self.assertEqual(first.location, 'Room 101: https://meet.example.test/room')
        self.assertEqual(first.room_name, 'Room 101')

        response = self.client.post(endpoint, {'slotId': 'afternoon', 'slotIndex': 1, 'applyLink': False}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(all(result.time_slot == '14:00 - 15:00' for result in RoundResult.objects.all()))
        self.assertTrue(all(result.link == 'https://exam.example.test/common' for result in RoundResult.objects.all()))


    def test_legacy_round_rooms_are_listed_for_sessions_without_round_config(self):
        legacy = ExamSession.objects.create(
            id='legacy-room-session', competition_id=self.competition.id, code='LEGACY', name='Legacy rooms',
            parent='Legacy', organizer='FermatTech', time='', sort_key='legacy-room-session',
            national='26/07/2026', national_date='2026-07-26',
        )
        candidate = Candidate.objects.create(
            id='LEGACY-001', code='LEGACY-001', name='Legacy Candidate', sort_key='legacy-candidate',
            session_ids=[legacy.id], contests='LEGACY',
        )
        participation = CandidateParticipation.objects.create(candidate=candidate, session=legacy)
        result = RoundResult.objects.create(
            participation=participation, round_id='legacy-national', round_name='Vòng Chung kết Quốc gia',
        )
        room = ExamRoom.objects.create(
            session=legacy, round_id='legacy-national', round_name='Vòng Chung kết Quốc gia',
            common_name='Phòng legacy', room_number='101', label='Phòng legacy 101',
            mode=ExamRoom.MODE_IN_PERSON, location='Hà Nội',
        )
        result.exam_room = room
        result.room_name = room.label
        result.save(update_fields=['exam_room', 'room_name'])

        response = self.client.get(f'/api/examination/sessions/{legacy.id}/rounds/legacy-national/rooms')

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['assignedCount'], 1)
        self.assertEqual(response.data['rooms'][0]['label'], 'Phòng legacy 101')

    def test_manager_can_move_one_candidate_to_another_room_and_slot(self):
        self.session.rounds = [{
            'id': 'round-1', 'name': 'Vòng 1', 'label': '', 'date': '',
            'slots': [
                {'id': 'morning', 'date': '2026-08-09', 'time': '08:00 - 09:00', 'mode': 'Trực tuyến', 'link': ''},
                {'id': 'afternoon', 'date': '2026-08-09', 'time': '14:00 - 15:00', 'mode': 'Trực tuyến', 'link': ''},
            ],
        }]
        self.session.save(update_fields=['rounds'])
        allocated = self.client.post(self.url, {
            'commonName': 'Phòng thi', 'mode': 'IN_PERSON', 'allocationStrategy': 'BALANCED',
            'rooms': [
                {'number': '101', 'location': 'Hà Nội'},
                {'number': '102', 'location': 'Hà Nội'},
            ],
        }, format='json')
        self.assertEqual(allocated.status_code, 200, allocated.data)
        rooms = list(ExamRoom.objects.order_by('room_number'))
        result = RoundResult.objects.get(participation__candidate_id='ROOM-001')

        response = self.client.put(
            f'/api/examination/round-results/{result.id}',
            {'roundId': 'round-1', 'roomId': str(rooms[1].id), 'slotId': 'afternoon'},
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        result.refresh_from_db()
        self.assertEqual(result.exam_room_id, rooms[1].id)
        self.assertEqual(result.room_name, rooms[1].label)
        self.assertEqual(result.time_slot, '14:00 - 15:00')

class CandidateImportReuseTests(TestCase):
    def setUp(self):
        self.user = UserProfile.objects.create(email='reuse-admin@example.com', name='Reuse Admin', role='ADMIN')
        self.client = APIClient()
        django_user = get_user_model().objects.create_user(username='reuse-admin@example.com', email='reuse-admin@example.com', password='ReuseAdmin9921')
        token = Token.objects.create(user=django_user).key
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        self.competition = Competition.objects.create(
            id='aysbc-reuse', code='AYSBC', name='Huy hiệu các Nhà khoa học trẻ Châu Á',
            parent='AYSBC', organizer='SCS và META Knowledge', sort_key='aysbc-reuse',
        )
        self.previous = ExamSession.objects.create(
            id='aysbc-2026', competition_id=self.competition.id, code='AYSBC', name='T6/2026',
            parent='AYSBC', organizer='SCS', time='', sort_key='aysbc-2026',
        )
        self.target = ExamSession.objects.create(
            id='aysbc-2027', competition_id=self.competition.id, code='AYSBC', name='T6/2027',
            parent='AYSBC', organizer='SCS', time='', sort_key='aysbc-2027',
        )
        self.candidate = Candidate.objects.create(
            id='FT-00001', code='FT-00001', name='Nguyễn Minh Anh', identity='001214066182',
            school='Trường A', birth_date='2014-03-20', session_ids=[self.previous.id],
            contests='AYSBC', sort_key='nguyen-minh-anh',
        )
        CandidateParticipation.objects.create(candidate=self.candidate, session=self.previous)

    def test_import_reuses_existing_profile_and_adds_new_session_history(self):
        response = self.client.post('/api/examination/import/candidates', {
            'sessionId': self.target.id,
            'source': 'Danh sách AYSBC 2027.xlsx',
            'records': [{
                'code': '', 'name': 'Nguyễn Minh Anh', 'identity': '001214066182',
                'school': 'Trường A', 'birthDate': '20/03/2014', 'city': 'Hà Nội',
                'examHistory': [{'round': 'Vòng 1', 'account': 'minh.anh.2027'}],
            }],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created'], 0)
        self.assertEqual(response.data['linkedExisting'], 1)
        self.assertEqual(Candidate.objects.count(), 1)
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.code, 'FT-00001')
        self.assertIn(self.target.id, self.candidate.session_ids)
        self.assertTrue(CandidateParticipation.objects.filter(candidate=self.candidate, session=self.target).exists())
        note = LogNote.objects.filter(entity_key='candidate-FT-00001').latest('created_at')
        self.assertIn('Hệ thống tự nhận diện hồ sơ trùng', note.content)
        self.assertIn('T6/2026', note.content)

    def test_confirmed_possible_match_reuses_selected_profile_and_records_audit(self):
        self.candidate.email = 'parent@example.com'
        self.candidate.save(update_fields=['email'])
        response = self.client.post('/api/examination/import/candidates', {
            'sessionId': self.target.id,
            'source': 'Danh sách xác nhận.xlsx',
            'confirmedMatches': {'1': 'FT-00001'},
            'records': [{
                'name': 'Nguyen Ngoc An', 'email': 'parent@example.com',
                'school': 'Trường B', 'birthDate': '20/03/2014',
            }],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created'], 0)
        self.assertEqual(Candidate.objects.count(), 1)
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.name, 'Nguyen Ngoc An')
        self.assertEqual(self.candidate.school, 'Trường B')
        note = LogNote.objects.filter(entity_key='candidate-FT-00001').latest('created_at')
        self.assertIn('Người dùng đã xác nhận', note.content)

    def test_year_only_import_does_not_overwrite_a_full_birth_date(self):
        response = self.client.post('/api/examination/import/candidates', {
            'sessionId': self.target.id,
            'source': 'Danh sách bổ sung.xlsx',
            'records': [{
                'name': 'Nguyễn Minh Anh', 'identity': '001214066182', 'birthDate': '2014',
            }],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.candidate.refresh_from_db()
        self.assertEqual(self.candidate.birth_date, '2014-03-20')

class SessionCompetitionConsistencyTests(TestCase):
    def test_legacy_session_is_relinked_and_serialized_with_the_competition_name(self):
        competition = Competition.objects.create(
            id='aysbc-consistent', code='AYSBC', name='Huy hiệu các Nhà khoa học trẻ Châu Á',
            parent='AYSBC', organizer='SCS và META Knowledge', sort_key='aysbc-consistent',
        )
        session = ExamSession.objects.create(
            id='aysbc-legacy-name', competition_id='', code='AYSBC', name='T10/2026',
            parent='AYSBC', organizer='', time='', sort_key='legacy',
        )

        from .views import ensure_examination_seed, serialize_session
        ensure_examination_seed()
        session.refresh_from_db()
        payload = serialize_session(session)

        self.assertEqual(session.competition_id, competition.id)
        self.assertEqual(session.parent, competition.name)
        self.assertEqual(session.organizer, competition.organizer)
        self.assertEqual(payload['competitionName'], competition.name)
class ImportDuplicatePreviewTests(TestCase):
    def setUp(self):
        email = 'duplicate-preview@example.com'
        UserProfile.objects.create(email=email, name='Duplicate Preview', role='ADMIN')
        django_user = get_user_model().objects.create_user(username=email, email=email, password='DuplicatePreview9921')
        token = Token.objects.create(user=django_user).key
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        Candidate.objects.create(
            id='FT-00042', code='FT-00042', name='Nguyễn Minh Anh', identity='001214066182',
            school='Trường A', birth_date='2014-03-20', city='Hà Nội', sort_key='nguyen-minh-anh',
        )

    def test_duplicate_preview_returns_existing_profile_without_exposing_exam_credentials(self):
        response = self.client.post('/api/examination/import/candidates/duplicates', {
            'records': [{
                'name': 'nguyễn MINH anh', 'identity': '001214066182',
                'birthDate': '20/03/2014', 'school': 'Trường A',
            }],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['duplicates']), 1)
        duplicate = response.data['duplicates'][0]
        self.assertEqual(duplicate['importedName'], 'Nguyễn Minh Anh')
        self.assertEqual(duplicate['existing']['code'], 'FT-00042')
        self.assertEqual(duplicate['matchBy'], 'Họ tên và CCCD/Hộ chiếu trùng')
        self.assertNotIn('password', duplicate['existing'])
        self.assertEqual(duplicate['status'], 'confirmed')

    def test_duplicate_preview_does_not_match_same_name_with_a_different_birth_date(self):
        response = self.client.post('/api/examination/import/candidates/duplicates', {
            'records': [{
                'name': 'Nguyen Minh Anh', 'birthDate': '21/03/2014',
                'school': 'Truong A', 'city': 'Ha Noi',
            }],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['duplicates'], [])

    def test_manual_candidate_update_normalizes_person_name(self):
        response = self.client.put('/api/examination/candidates/FT-00042', {
            'name': 'nguyễn  MINH-ANH', 'parent': 'trần THỊ bình',
        }, format='json')

        self.assertEqual(response.status_code, 200)
        candidate = Candidate.objects.get(code='FT-00042')
        self.assertEqual(candidate.name, 'Nguyễn Minh-Anh')
        self.assertEqual(candidate.parent, 'Trần Thị Bình')
class CandidateIdentityMatchingTests(TestCase):
    def test_same_name_and_shared_identifier_are_confirmed_even_when_other_fields_changed(self):
        from .sync import candidate_match_assessment, same_candidate

        previous = {
            'name': 'Nguyen Thi Phuc An', 'birth_date': '2014-03-21',
            'identity': '001214056485', 'email': 'old@example.com', 'phone': '0981111111',
        }
        incoming = {
            'name': 'Nguyen Thi Phuc An', 'birth_date': '2014-09-21',
            'identity': '001214056485', 'email': 'new@example.com', 'phone': '0982222222',
        }

        assessment = candidate_match_assessment(previous, incoming)
        self.assertEqual(assessment['status'], 'confirmed')
        self.assertIn('CCCD', assessment['reason'])
        self.assertTrue(same_candidate(previous, incoming))

    def test_shared_identifier_but_different_name_requires_confirmation(self):
        from .sync import candidate_match_assessment, same_candidate

        previous = {'name': 'Nguyen Thi Phuc An', 'email': 'parent@example.com'}
        incoming = {'name': 'Nguyen Ngoc An', 'email': 'parent@example.com'}

        assessment = candidate_match_assessment(previous, incoming)
        self.assertEqual(assessment['status'], 'possible')
        self.assertFalse(same_candidate(previous, incoming))

    def test_missing_identifiers_use_strict_name_birth_school_and_class_fallback(self):
        from .sync import candidate_match_assessment, same_candidate

        previous = {
            'name': 'Nguyen Thi Phuc An', 'birth_date': '2014-03-21',
            'school': 'THCS Trung Vuong', 'class_name': '7A1',
        }
        incoming = {
            'name': 'Nguyen Thi Phuc An', 'birth_date': '2014-03-21',
            'school': 'THCS Trung Vuong', 'class_name': '7A1',
        }

        assessment = candidate_match_assessment(previous, incoming)
        self.assertEqual(assessment['status'], 'confirmed')
        self.assertTrue(same_candidate(previous, incoming))

    def test_same_name_school_but_different_full_birth_dates_do_not_match(self):
        from .sync import candidate_match_assessment, same_candidate

        previous = {
            'name': 'Nguyen Thi Phuc An', 'birth_date': '2014-03-21',
            'school': 'THCS Trung Vuong', 'class_name': '7A1',
        }
        incoming = {
            'name': 'Nguyen Thi Phuc An', 'birth_date': '2014-09-21',
            'school': 'THCS Trung Vuong', 'class_name': '7A1',
        }

        self.assertIsNone(candidate_match_assessment(previous, incoming))
        self.assertFalse(same_candidate(previous, incoming))

class AutomaticSessionPhaseTests(TestCase):
    def setUp(self):
        self.session = ExamSession.objects.create(
            id='phase-rules', competition_id='', code='TEST', name='Phase rules',
            parent='Test', organizer='FT', time='', sort_key='phase-rules', phase='Tuyển sinh',
            rounds=[
                {'id': 'national', 'name': 'Vòng Chung kết Quốc gia', 'date': '2026-07-26', 'label': '26/7/2026'},
                {'id': 'international', 'name': 'Vòng Quốc tế', 'date': '2026-08-09', 'label': '9/8/2026'},
            ],
        )

    def test_phase_moves_from_national_to_international_preparation_and_round(self):
        from datetime import date
        from .views import automatic_session_phase

        self.assertEqual(automatic_session_phase(self.session, date(2026, 7, 27)), 'Ôn tập Vòng quốc tế')
        self.assertEqual(automatic_session_phase(self.session, date(2026, 8, 2)), 'Vòng Quốc tế')

    def test_undated_later_round_blocks_false_results_and_completion(self):
        from datetime import date
        from .views import automatic_session_phase

        self.session.rounds = [
            {'id': 'national', 'name': 'Vòng Chung kết Quốc gia', 'date': '2026-07-26', 'label': '26/7/2026'},
            {'id': 'regional', 'name': 'Vòng Khu vực', 'date': '', 'label': 'Dự kiến Tháng 10/2026'},
        ]
        self.session.phase = 'Hoàn thành'
        self.assertEqual(automatic_session_phase(self.session, date(2026, 7, 27)), 'Ôn tập Vòng quốc tế')
        self.assertEqual(automatic_session_phase(self.session, date(2026, 9, 15)), 'Ôn tập Vòng quốc tế')
    def test_final_round_moves_through_results_honouring_and_completion(self):
        from datetime import date
        from .views import automatic_session_phase

        self.assertEqual(automatic_session_phase(self.session, date(2026, 8, 10)), 'Vòng Quốc tế')
        self.assertEqual(automatic_session_phase(self.session, date(2026, 8, 23)), 'Tổng hợp kết quả')
        self.assertEqual(automatic_session_phase(self.session, date(2026, 8, 30)), 'Công bố kết quả, phúc khảo')
        self.assertEqual(automatic_session_phase(self.session, date(2026, 9, 6)), 'Vinh danh')
        self.assertEqual(automatic_session_phase(self.session, date(2026, 9, 13)), 'Hoàn thành')

    def test_special_post_final_phase_is_not_automatically_completed(self):
        from datetime import date
        from .views import automatic_session_phase

        self.session.phase = 'Chờ quyết định Hội đồng'
        self.assertEqual(automatic_session_phase(self.session, date(2026, 11, 1)), 'Chờ quyết định Hội đồng')


class ExaminationNotificationTests(TestCase):
    def setUp(self):
        department = Department.objects.create(name='Khảo thí', code='EXAM')
        self.manager = UserProfile.objects.create(
            email='exam-manager@example.com', name='Exam Manager', role='MANAGER',
            department=department, access_modules=['examination'],
        )
        UserProfile.objects.create(
            email='other@example.com', name='Other', role='EMPLOYEE',
            access_modules=['work-schedule'],
        )
        self.client = APIClient()
        self.client.force_authenticate(self.manager)

    def test_create_and_update_competition_notify_examination_department(self):
        created = self.client.post('/api/examination/competitions', {
            'code': 'NEW', 'name': 'New Olympiad', 'organizer': 'International Board',
        }, format='json')
        self.assertEqual(created.status_code, 201)
        notification = WorkspaceNotification.objects.get(event_key=f"examination-competition-created:{created.data['id']}")
        self.assertEqual(notification.target_emails, ['exam-manager@example.com'])
        self.assertEqual(notification.action_url, f"/examination/competitions/{created.data['id']}")

        updated = self.client.put(
            f"/api/examination/competitions/{created.data['id']}",
            {'organizer': 'Updated International Board'}, format='json',
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(WorkspaceNotification.objects.filter(event_key__startswith='examination-competition-updated:').count(), 1)

    def test_automatic_phase_change_creates_targeted_notification(self):
        from datetime import date
        from .views import refresh_automatic_session_phase

        session = ExamSession.objects.create(
            id='notify-phase', competition_id='', code='NOTICE', name='Notice session',
            parent='Notice', organizer='FT', time='', sort_key='notify-phase', phase='Vinh danh',
            rounds=[{'id': 'international', 'name': 'Vòng Quốc tế', 'date': '2026-08-09'}],
        )
        refresh_automatic_session_phase(session, date(2026, 9, 13))

        notification = WorkspaceNotification.objects.get(event_key='examination-session-phase:notify-phase:Hoàn thành:2026-09-13')
        self.assertEqual(notification.target_emails, ['exam-manager@example.com'])
        self.assertEqual(notification.severity, 'success')
        self.assertEqual(notification.action_url, '/examination/sessions/notify-phase')

    def test_create_and_important_session_update_create_notifications(self):
        competition = Competition.objects.create(
            id='notification-comp', code='NTF', name='Notification Olympiad',
            parent='NTF', organizer='FT', sort_key='notification-comp',
        )
        created = self.client.post('/api/examination/sessions', {
            'competitionId': competition.id,
            'name': 'NTF 2027',
            'national': {'label': 'T5/2027', 'date': '2027-05-10'},
            'international': {'label': 'T8/2027', 'date': '2027-08-10'},
            'rounds': [],
        }, format='json')
        self.assertEqual(created.status_code, 201)
        self.assertTrue(WorkspaceNotification.objects.filter(event_key=f"examination-session-created:{created.data['id']}").exists())

        updated = self.client.put(
            f"/api/examination/sessions/{created.data['id']}",
            {'phase': 'Ôn tập Vòng quốc tế'}, format='json',
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(WorkspaceNotification.objects.filter(event_key__startswith='examination-session-updated:').count(), 1)

class SheetPublicationTests(TestCase):
    def setUp(self):
        self.user = UserProfile.objects.create(email='sheets-admin@example.com', name='Sheets Admin', role='ADMIN')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_publication_configuration_is_persisted(self):
        response = self.client.get('/api/examination/sheet-publication')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['spreadsheetUrl'], '')

        updated = self.client.put('/api/examination/sheet-publication', {
            'spreadsheetUrl': 'https://docs.google.com/spreadsheets/d/demo-sheet-id/edit',
            'enabled': True,
        }, format='json')
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data['spreadsheetUrl'], 'https://docs.google.com/spreadsheets/d/demo-sheet-id/edit')

    def test_publication_rows_use_the_fixed_partner_and_session_layout(self):
        from .sheet_publication import PARTNERS_TAB, SUMMARY_TAB, partner_rows, session_tab_name, summary_rows

        session = ExamSession.objects.create(
            id='sheet-session', competition_id='sheet-competition', code='IMO', name='IMO 2026',
            parent='International Maths Olympiad', organizer='SCO', time='T5/2026 - T8/2026',
            phase='Ôn tập Vòng quốc tế', candidates_count=12, sort_key='sheet-session',
        )
        rows = summary_rows([session])
        self.assertEqual(rows[0][0], 'STT')
        self.assertEqual(rows[1][7], 12)
        self.assertTrue(session_tab_name(session).startswith('TS — IMO'))
        partner_values = partner_rows([{
            'province': 'Hà Nội', 'school': 'THCS FT', 'contests': ['IMO'],
            'studentCounts': [{'session': 'sheet-session', 'count': 8}],
        }])
        self.assertEqual(PARTNERS_TAB, 'ĐỐI TÁC')
        self.assertEqual(SUMMARY_TAB, 'TỔNG QUAN KỲ THI')
        self.assertEqual(partner_values[1][-1], 8)


class SessionOutputSheetTests(TestCase):
    def setUp(self):
        user = get_user_model().objects.create_user(
            username='manager@example.com', email='manager@example.com', password='StrongPassword9921'
        )
        UserProfile.objects.create(
            email='manager@example.com', name='Manager', role='MANAGER', access_modules=['examination']
        )
        token = Token.objects.create(user=user).key
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        self.session = ExamSession.objects.create(
            id='output-only-session', competition_id='demo', code='DEMO', name='Output only',
            parent='Demo', organizer='Fermat', time='', sort_key='demo-output-only'
        )

    def test_output_sheet_can_be_saved_without_registration_sheet(self):
        response = self.client.put(
            f'/api/examination/sessions/{self.session.id}',
            {'outputSheetUrl': 'https://docs.google.com/spreadsheets/d/output-only', 'outputSheetTab': 'SCO - IEO'},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.session.refresh_from_db()
        self.assertEqual(self.session.registration_sheet_url, '')
        output = ExaminationSheet.objects.get(session_id=self.session.id, stage='session-output')
        self.assertEqual(output.url, 'https://docs.google.com/spreadsheets/d/output-only')
        self.assertEqual(output.sheet_tab, 'SCO - IEO')


    def test_output_export_uses_vietnamese_date_and_percentage_display(self):
        from .sync import PROFILE_EXPORT_HEADERS, REGISTRATION_EXPORT_HEADERS, format_sheet_percentage, session_export_rows

        candidate = Candidate.objects.create(
            id='FT-OUTPUT-001', code='FT-OUTPUT-001', name='Output Candidate',
            birth_date='2018-11-08', sort_key='output-candidate',
        )
        participation = CandidateParticipation.objects.create(candidate=candidate, session=self.session)
        RoundResult.objects.create(
            participation=participation, round_name='Round 1',
            exam_date='2026-08-09', score_rate='97.14%',
        )

        row = session_export_rows(self.session.id)[2]
        round_start = len(PROFILE_EXPORT_HEADERS) + len(REGISTRATION_EXPORT_HEADERS)
        self.assertEqual(row[3], '08/11/2018')
        self.assertEqual(row[round_start + 2], '09/08/2026')
        self.assertEqual(row[round_start + 11], '97,14%')
        self.assertEqual(format_sheet_percentage('97,14%'), '97,14%')
        self.assertEqual(format_sheet_percentage('77.1400%'), '77,1400%')

    def test_percentage_separator_is_not_a_data_change_or_rounding(self):
        from .sync import format_sheet_percentage
        from .views import audit_values

        self.assertEqual(format_sheet_percentage('77.1400%'), '77,1400%')
        self.assertEqual(
            audit_values(
                {'scoreRate': '77.1400%'},
                {'scoreRate': '77,1400%'},
                {'scoreRate': 'Tỷ lệ điểm'},
            ),
            '',
        )

    def test_unmatched_sheet_row_is_blocked_with_exact_row_and_identity(self):
        from .sync import _aligned_export_rows

        CandidateParticipation.objects.create(
            candidate=Candidate.objects.create(
                id='FT-OUTPUT-002', code='FT-OUTPUT-002', name='Known Candidate', sort_key='known-candidate',
            ),
            session=self.session,
        )
        alignment = _aligned_export_rows([['1', 'OLD-001', 'Unknown Candidate', '08/11/2018']], self.session.id)

        self.assertEqual(alignment['matchConflicts'][0]['row'], 3)
        self.assertIn('Unknown Candidate', alignment['matchConflicts'][0]['sheetIdentity'])
        self.assertIn('Kh\u00f4ng t\u00ecm th\u1ea5y', alignment['matchConflicts'][0]['reason'])


    @patch('examination.sync._output_sheet_target')
    @patch('examination.sync.build_sheets_service')
    def test_preview_does_not_require_review_for_empty_sheet_cells(self, build_service, target):
        from .sync import output_sheet_export_preview

        candidate = Candidate.objects.create(
            id='FT-OUTPUT-003', code='FT-OUTPUT-003', name='Preview Candidate',
            birth_date='2018-11-08', sort_key='preview-candidate',
        )
        CandidateParticipation.objects.create(candidate=candidate, session=self.session)
        output = ExaminationSheet.objects.create(
            id='output-preview', name='Output preview',
            url='https://docs.google.com/spreadsheets/d/output-preview/edit?gid=7',
            session_id=self.session.id, stage='session-output', sheet_tab='SCO - ISO',
            created_at=timezone.now(), updated_at=timezone.now(),
        )
        target.return_value = {'title': 'SCO - ISO'}
        build_service.return_value.spreadsheets.return_value.values.return_value.get.return_value.execute.return_value = {
            'values': [['1', '', 'Preview Candidate', '08/11/2018']]
        }

        preview = output_sheet_export_preview(output)

        self.assertTrue(preview['hasChanges'])
        self.assertFalse(preview['hasReviewChanges'])
        self.assertEqual(preview['changedCells'], 0)
        self.assertGreater(preview['writeChangedCells'], 0)


    def test_round_template_slot_controls_import_and_export_column(self):
        from .sync import EXPORT_GROUP_HEADERS, EXPORT_HEADERS, history_from_sheet_row, merged_headers, session_export_rows
        from .views import upsert_participation_history

        self.session.rounds = [
            {'id': 'screening', 'name': 'Screening'},
            {'id': 'national-final', 'name': 'National Final'},
            {'id': 'international-final', 'name': 'International Final'},
        ]
        self.session.save(update_fields=['rounds'])
        candidate = Candidate.objects.create(
            id='FT-ROUND-SLOT', code='FT-ROUND-SLOT', name='Round Slot Candidate',
            highest_round='V\u00f2ng 1 \u2013 Screening', sort_key='round-slot-candidate',
        )
        headers = merged_headers([EXPORT_GROUP_HEADERS, EXPORT_HEADERS], 1)
        imported_row = [''] * len(headers)
        imported_row[36] = 'Eligible'
        imported_row[38] = '09/08/2026'
        history = history_from_sheet_row(headers, imported_row)

        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]['templateSlot'], 2)
        self.assertEqual(history[0]['templateColumns']['eligibility'], 'AK')
        self.assertEqual(history[0]['templateColumns']['date'], 'AM')
        upsert_participation_history(candidate, self.session.id, history)
        result = RoundResult.objects.get(participation__candidate=candidate)
        self.assertEqual(result.round_id, 'national-final')

        exported = session_export_rows(self.session.id)[2]
        self.assertEqual(exported[21], '')
        self.assertEqual(exported[36], '\u0110\u1ee7 \u0111i\u1ec1u ki\u1ec7n')
        self.assertEqual(exported[66], 'V\u00f2ng 2 \u2013 National Final')


class ExaminationSheetAutomationTests(TestCase):
    def setUp(self):
        self.session = ExamSession.objects.create(
            id='sheet-auto-session', competition_id='iso', code='ISO', name='ISO automatic sheets',
            parent='ISO', organizer='SCO', time='2026', sort_key='sheet-auto-session',
        )

    @patch('examination.sheet_scheduler.sync_single_sheet')
    def test_registration_schedule_only_imports_enabled_input_sheets(self, sync_sheet):
        sync_sheet.return_value = {'success': True, 'created': 2, 'updated': 3, 'total': 5}
        source = ExaminationSheet.objects.create(
            id='registration-auto', name='Sheet đầu vào', url='https://docs.google.com/spreadsheets/d/input',
            session_id=self.session.id, stage='registration-source', automation_enabled=True,
            created_at=timezone.now(), updated_at=timezone.now(),
        )
        ExaminationSheet.objects.create(
            id='output-auto-off', name='Sheet tổng hợp', url='https://docs.google.com/spreadsheets/d/output',
            session_id=self.session.id, stage='session-output', automation_enabled=True,
            created_at=timezone.now(), updated_at=timezone.now(),
        )

        from .sheet_scheduler import run_registration_imports
        result = run_registration_imports()

        self.assertEqual(result['success'], 1)
        sync_sheet.assert_called_once()
        self.assertEqual(sync_sheet.call_args.args[2], source.id)
        source.refresh_from_db()
        self.assertIsNotNone(source.last_import_at)

    @patch('examination.sheet_scheduler.export_session_to_google_sheet')
    @patch('examination.sheet_scheduler.output_sheet_export_preview')
    @patch('examination.sheet_scheduler.output_sheet_has_unreviewed_changes')
    def test_output_schedule_exports_only_when_sheet_has_no_pending_edit(self, changed, preview, export_sheet):
        changed.return_value = (False, 'same')
        preview.return_value = {'appendedRows': 0, 'unmatchedSheetRows': []}
        export_sheet.return_value = {'success': True, 'exported': 5, 'fingerprint': 'new-fingerprint'}
        output = ExaminationSheet.objects.create(
            id='output-auto', name='Sheet tổng hợp', url='https://docs.google.com/spreadsheets/d/output',
            session_id=self.session.id, stage='session-output', automation_enabled=True,
            last_content_fingerprint='old-fingerprint', created_at=timezone.now(), updated_at=timezone.now(),
        )

        from .sheet_scheduler import run_output_exports
        result = run_output_exports()

        self.assertEqual(result['success'], 1)
        export_sheet.assert_called_once_with(output)
        output.refresh_from_db()
        self.assertEqual(output.last_content_fingerprint, 'new-fingerprint')
        self.assertFalse(output.pending_manual_import)

    @patch('examination.sheet_scheduler.export_session_to_google_sheet')
    @patch('examination.sheet_scheduler.output_sheet_export_preview')
    @patch('examination.sheet_scheduler.output_sheet_has_unreviewed_changes')
    def test_output_schedule_blocks_roster_mismatch_for_manual_resolution(self, changed, preview, export_sheet):
        changed.return_value = (False, 'same')
        preview.return_value = {'appendedRows': 2, 'unmatchedSheetRows': []}
        output = ExaminationSheet.objects.create(
            id='output-mismatch', name='Sheet tổng hợp', url='https://docs.google.com/spreadsheets/d/output',
            session_id=self.session.id, stage='session-output', automation_enabled=True,
            created_at=timezone.now(), updated_at=timezone.now(),
        )

        from .sheet_scheduler import run_output_exports
        result = run_output_exports()

        self.assertEqual(result['blocked'], 1)
        export_sheet.assert_not_called()
        output.refresh_from_db()
        self.assertTrue(output.pending_manual_import)
        self.assertEqual(output.status, 'attention')

    @patch('examination.sheet_scheduler.export_session_to_google_sheet')
    @patch('examination.sheet_scheduler.output_sheet_has_unreviewed_changes')
    def test_output_schedule_blocks_export_when_people_edited_sheet(self, changed, export_sheet):
        changed.return_value = (True, 'changed')
        output = ExaminationSheet.objects.create(
            id='output-edited', name='Sheet tổng hợp', url='https://docs.google.com/spreadsheets/d/output',
            session_id=self.session.id, stage='session-output', automation_enabled=True,
            last_content_fingerprint='old-fingerprint', created_at=timezone.now(), updated_at=timezone.now(),
        )

        from .sheet_scheduler import run_output_exports
        result = run_output_exports()

        self.assertEqual(result['blocked'], 1)
        export_sheet.assert_not_called()
        output.refresh_from_db()
        self.assertTrue(output.pending_manual_import)
        self.assertEqual(output.status, 'attention')


class SheetCandidateImportPreviewTests(TestCase):
    def setUp(self):
        self.user = UserProfile.objects.create(email='iso-import-admin@example.com', name='ISO Import Admin', role='ADMIN')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.session = ExamSession.objects.create(
            id='iso-upcoming', competition_id='iso', code='ISO', name='Olympic Khoa học Quốc tế',
            parent='ISO', organizer='SCO', time='2026-2027', sort_key='iso-upcoming',
            rounds=[
                {'id': 'national', 'name': 'Vòng Chung kết Quốc gia'},
                {'id': 'international', 'name': 'Vòng Quốc tế'},
            ],
        )

    def test_preview_lists_nonempty_values_that_will_be_replaced(self):
        from .sync import build_sheet_preview

        candidate = Candidate.objects.create(
            id='FT-PREVIEW-CHANGED', code='FT-PREVIEW-CHANGED', name='Preview Candidate',
            email='preview@example.com', sort_key='preview-candidate',
        )
        participation = CandidateParticipation.objects.create(candidate=candidate, session=self.session)
        RoundResult.objects.create(
            participation=participation, round_id='international', round_name='International',
            score='5', result='Old award',
        )

        preview = build_sheet_preview([{
            'name': 'Preview Candidate', 'email': 'preview@example.com',
            'exam_history': [{'round': 'International', 'score': '9', 'result': 'New award'}],
        }], [], {}, '', self.session.id, 'https://docs.google.com/spreadsheets/d/example/edit')

        changes = {item['field']: item for item in preview['records'][0]['_preview']['changes']}
        self.assertEqual(preview['records'][0]['_preview']['status'], 'changed')
        self.assertEqual(changes['round.International.score']['current'], '5')
        self.assertEqual(changes['round.International.score']['next'], '9')
        self.assertEqual(changes['round.International.result']['next'], 'New award')
    @patch('examination.sync.requests.get')
    def test_preview_reads_two_row_schema_without_mutating_candidates(self, mock_get):
        csv_text = (
            'HỒ SƠ THÍ SINH,,,,,,,VÒNG 2 – VÒNG QUỐC TẾ,\n'
            'Mã hồ sơ,Họ và tên thí sinh,Ngày sinh,Email,Số điện thoại,Trường,Lớp đang học,Ngày thi,Số báo danh (SBD)\n'
            ',Nguyễn An,12/03/2014,an@example.com,0901000000,THCS Fermat,6A1,09/08/2026,ISO-001\n'
        )
        response_mock = MagicMock(status_code=200, text=csv_text, url='https://docs.google.com/export.csv')
        response_mock.raise_for_status.return_value = None
        mock_get.return_value = response_mock

        response = self.client.post('/api/examination/sheets/preview', {
            'url': 'https://docs.google.com/spreadsheets/d/example/edit?gid=1114066817',
            'sheetTab': 'SCO - ISO',
            'sessionId': self.session.id,
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['summary']['total'], 1)
        self.assertEqual(response.data['summary']['new'], 1)
        self.assertEqual(response.data['records'][0]['_preview']['sourceRow'], 3)
        self.assertEqual(response.data['records'][0]['examHistory'][0]['round'], 'VÒNG QUỐC TẾ')
        self.assertIn('VÒNG 2 – VÒNG QUỐC TẾ', response.data['mapping']['roundGroups'])
        self.assertEqual(Candidate.objects.count(), 0)
        requested_url = mock_get.call_args.args[0]
        self.assertIn('export?format=csv&gid=1114066817', requested_url)

    @patch('examination.sync.build_sheets_service')
    def test_preview_resolves_selected_tab_to_gid_before_reading_csv(self, build_service):
        from .sync import canonical_import_sheet_url, get_google_sheet_csv_urls

        build_service.return_value.spreadsheets.return_value.get.return_value.execute.return_value = {
            'sheets': [
                {'properties': {'sheetId': 3, 'title': 'SCO - ISO'}},
                {'properties': {'sheetId': 1396296876, 'title': 'SCO - IEO'}},
            ]
        }

        resolved = canonical_import_sheet_url(
            'https://docs.google.com/spreadsheets/d/example/edit', 'SCO - IEO',
        )
        urls = get_google_sheet_csv_urls(resolved, 'SCO - IEO')

        self.assertIn('gid=1396296876', resolved)
        self.assertTrue(urls[0].endswith('export?format=csv&gid=1396296876'))

    def test_fill_empty_policy_preserves_existing_values_and_adds_missing_values(self):
        Candidate.objects.create(
            id='FT-ISO-001', code='FT-ISO-001', name='Nguyễn An', school='Trường đang dùng',
            identity='001214000001', email='', sort_key='nguyen-an',
        )

        response = self.client.post('/api/examination/import/candidates', {
            'sessionId': self.session.id,
            'source': 'ISO Sheet preview',
            'updateMode': 'fill-empty',
            'records': [{
                'code': 'FT-ISO-001', 'name': 'Nguyễn An', 'identity': '001214000001',
                'school': 'Trường trong Sheet', 'email': 'an@example.com',
            }],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        candidate = Candidate.objects.get(code='FT-ISO-001')
        self.assertEqual(candidate.school, 'Trường đang dùng')
        self.assertEqual(candidate.email, 'an@example.com')
        self.assertTrue(CandidateParticipation.objects.filter(candidate=candidate, session=self.session).exists())

    def test_replace_nonempty_policy_updates_values_but_never_uses_blank_to_erase(self):
        Candidate.objects.create(
            id='FT-ISO-002', code='FT-ISO-002', name='Nguyễn Bình', school='Trường cũ',
            email='keep@example.com', identity='001214000002', sort_key='nguyen-binh',
        )

        response = self.client.post('/api/examination/import/candidates', {
            'sessionId': self.session.id,
            'source': 'ISO Sheet preview',
            'updateMode': 'replace-nonempty',
            'records': [{
                'code': 'FT-ISO-002', 'name': 'Nguyễn Bình', 'identity': '001214000002',
                'school': 'Trường mới', 'email': '',
            }],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        candidate = Candidate.objects.get(code='FT-ISO-002')
        self.assertEqual(candidate.school, 'Trường mới')
        self.assertEqual(candidate.email, 'keep@example.com')

    def test_overwrite_policy_can_skip_fields_that_are_currently_empty(self):
        candidate = Candidate.objects.create(
            id='FT-ISO-003', code='FT-ISO-003', name='Nguyễn Chi', school='Trường cũ',
            email='', identity='001214000003', sort_key='nguyen-chi',
        )
        CandidateParticipation.objects.create(candidate=candidate, session=self.session)

        response = self.client.post('/api/examination/import/candidates', {
            'sessionId': self.session.id,
            'source': 'ISO Sheet preview',
            'updateMode': 'replace-nonempty',
            'importEmptyValues': False,
            'records': [{
                'code': 'FT-ISO-003', 'name': 'Nguyễn Chi', 'identity': '001214000003',
                'school': 'Trường mới', 'email': 'chi@example.com',
            }],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        candidate.refresh_from_db()
        self.assertEqual(candidate.school, 'Trường mới')
        self.assertEqual(candidate.email, '')

    @patch('examination.views.remote_sheet_fingerprint')
    def test_output_import_rejects_a_preview_that_became_stale(self, fingerprint):
        fingerprint.return_value = 'newer-sheet-version'
        output = ExaminationSheet.objects.create(
            id='iso-output-stale', name='Sheet tổng hợp ISO',
            url='https://docs.google.com/spreadsheets/d/output',
            session_id=self.session.id, stage='session-output', pending_manual_import=True,
            created_at=timezone.now(), updated_at=timezone.now(),
        )

        response = self.client.post('/api/examination/import/candidates', {
            'sessionId': self.session.id,
            'sheetId': output.id,
            'sourceFingerprint': 'previewed-sheet-version',
            'source': 'Sheet tổng hợp ISO',
            'records': [{'name': 'Nguyễn An'}],
        }, format='json')

        self.assertEqual(response.status_code, 409)
        self.assertEqual(Candidate.objects.count(), 0)
        self.assertIn('xem trước lại', response.data['error'].lower())

    @patch('examination.views.remote_sheet_fingerprint')
    def test_manual_output_import_clears_pending_edit_after_current_preview(self, fingerprint):
        fingerprint.return_value = 'current-sheet-version'
        output = ExaminationSheet.objects.create(
            id='iso-output-current', name='Sheet tổng hợp ISO',
            url='https://docs.google.com/spreadsheets/d/output',
            session_id=self.session.id, stage='session-output', pending_manual_import=True,
            created_at=timezone.now(), updated_at=timezone.now(),
        )

        response = self.client.post('/api/examination/import/candidates', {
            'sessionId': self.session.id,
            'sheetId': output.id,
            'sourceFingerprint': 'current-sheet-version',
            'source': 'Sheet tổng hợp ISO',
            'records': [{'name': 'Nguyễn An', 'email': 'an@example.com'}],
        }, format='json')

        self.assertEqual(response.status_code, 200)
        output.refresh_from_db()
        self.assertFalse(output.pending_manual_import)
        self.assertEqual(output.last_content_fingerprint, 'current-sheet-version')
        self.assertEqual(Candidate.objects.get().email, 'an@example.com')

    def test_legacy_direct_sync_cannot_import_an_output_sheet(self):
        output = ExaminationSheet.objects.create(
            id='iso-output-direct-sync', name='Sheet tổng hợp ISO',
            url='https://docs.google.com/spreadsheets/d/output',
            session_id=self.session.id, stage='session-output',
            created_at=timezone.now(), updated_at=timezone.now(),
        )

        response = self.client.post('/api/examination/sync/google-sheet', {
            'id': output.id,
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('xác nhận thủ công', response.data['error'])

    @patch('examination.sync.requests.get')
    def test_empty_sheet_returns_a_safe_zero_record_preview(self, mock_get):
        response_mock = MagicMock(
            status_code=200,
            text='Họ và tên thí sinh,Email\n,\n',
            url='https://docs.google.com/export.csv',
        )
        response_mock.raise_for_status.return_value = None
        mock_get.return_value = response_mock

        response = self.client.post('/api/examination/sheets/preview', {
            'url': 'https://docs.google.com/spreadsheets/d/example/edit',
            'sessionId': self.session.id,
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['summary']['total'], 0)
        self.assertTrue(any('Không có hồ sơ hợp lệ' in item for item in response.data['warnings']))
        self.assertEqual(Candidate.objects.count(), 0)

    def test_preview_rejects_non_google_urls(self):
        response = self.client.post('/api/examination/sheets/preview', {
            'url': 'http://127.0.0.1:8000/api/health',
            'sessionId': self.session.id,
        }, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('Google Sheets', response.data['error'])
