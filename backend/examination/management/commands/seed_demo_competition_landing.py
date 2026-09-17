"""Tạo dữ liệu mẫu để xem thử trang giới thiệu cuộc thi.

Dùng khi cần nhìn trước giao diện và luồng hoạt động mà chưa muốn công bố một
cuộc thi thật. Lệnh chạy lại được nhiều lần: mọi bản ghi đều dùng khóa cố định
nên không sinh ra bản sao.
"""

from datetime import date, timedelta

from django.core.management.base import BaseCommand

from examination.models import Competition, CompetitionLandingPage, ExamSession

COMPETITION_ID = 'demo-competition-landing'
SLUG = 'demo-olympiad-fermat'


class Command(BaseCommand):
    help = 'Tạo cuộc thi mẫu kèm trang giới thiệu đã công bố.'

    def add_arguments(self, parser):
        parser.add_argument('--remove', action='store_true', help='Xóa dữ liệu mẫu.')

    def handle(self, *args, **options):
        if options['remove']:
            CompetitionLandingPage.objects.filter(slug=SLUG).delete()
            ExamSession.objects.filter(competition_id=COMPETITION_ID).delete()
            Competition.objects.filter(id=COMPETITION_ID).delete()
            self.stdout.write(self.style.SUCCESS('Đã xóa dữ liệu mẫu.'))
            return

        today = date.today()
        competition, _ = Competition.objects.update_or_create(
            id=COMPETITION_ID,
            defaults={
                'code': 'FMO',
                'name': 'FermatTech Mathematics Olympiad 2026',
                'parent': 'FermatTech',
                'organizer': 'FermatTech phối hợp cùng các trường đối tác',
                'sort_key': '2026-fmo',
                'created_by': 'demo',
            },
        )

        def round_block(index, name, label, day_offset, mode):
            day = (today + timedelta(days=day_offset)).isoformat()
            return {
                'id': f'demo-round-{index}',
                'name': name,
                'label': label,
                'date': day,
                'mode': mode,
                'slots': [{'id': f'demo-round-{index}-slot', 'label': label, 'date': day, 'mode': mode}],
            }

        sessions = [
            {
                'id': f'{COMPETITION_ID}-thcs',
                'code': 'FMO-THCS',
                'name': 'Bảng Trung học cơ sở',
                'time': 'Năm học 2026 - 2027',
                'candidates_count': 428,
                'rounds': [
                    round_block(1, 'Vòng Sơ loại', 'Thi trực tuyến toàn quốc', 21, 'Trực tuyến'),
                    round_block(2, 'Vòng Bán kết', 'Thi tập trung theo cụm', 49, 'Tập trung'),
                    round_block(3, 'Vòng Chung kết Quốc gia', 'Hà Nội', 77, 'Tập trung'),
                ],
            },
            {
                'id': f'{COMPETITION_ID}-thpt',
                'code': 'FMO-THPT',
                'name': 'Bảng Trung học phổ thông',
                'time': 'Năm học 2026 - 2027',
                'candidates_count': 316,
                'rounds': [
                    round_block(4, 'Vòng Sơ loại', 'Thi trực tuyến toàn quốc', 21, 'Trực tuyến'),
                    round_block(5, 'Vòng Chung kết Quốc gia', 'Hà Nội', 77, 'Tập trung'),
                    round_block(6, 'Vòng Chung kết Quốc tế', 'Singapore', 126, 'Tập trung'),
                ],
            },
        ]
        for index, item in enumerate(sessions):
            ExamSession.objects.update_or_create(
                id=item['id'],
                defaults={
                    'competition_id': competition.id,
                    'code': item['code'],
                    'name': item['name'],
                    'parent': competition.name,
                    'organizer': competition.organizer,
                    'time': item['time'],
                    'candidates_count': item['candidates_count'],
                    'phase': 'Đang triển khai',
                    'note': 'Dữ liệu mẫu phục vụ xem thử trang giới thiệu.',
                    'rounds': item['rounds'],
                    'sort_key': f'{competition.sort_key}-{index}',
                    'created_by': 'demo',
                },
            )

        CompetitionLandingPage.objects.update_or_create(
            competition=competition,
            defaults={
                'slug': SLUG,
                'published': True,
                'tagline': 'Sân chơi Toán học dành cho học sinh THCS và THPT toàn quốc',
                'hero_description': (
                    'FermatTech Mathematics Olympiad là kỳ thi Toán học thường niên với ba vòng '
                    'thi từ sơ loại trực tuyến tới chung kết quốc tế, hướng tới học sinh yêu '
                    'thích tư duy Toán học và mong muốn thử sức ở môi trường chuẩn quốc tế.'
                ),
                'about_title': 'Về cuộc thi',
                'about_body': (
                    'Cuộc thi được tổ chức thường niên với hệ thống đề thi xây dựng theo ma trận '
                    'năng lực, chấm hai vòng độc lập và công bố kết quả minh bạch.\n'
                    'Toàn bộ lịch thi, danh sách vòng thi và số liệu thí sinh trên trang này được '
                    'lấy trực tiếp từ mô-đun Khảo thí của FermatTech Workspace.'
                ),
                'registration_url': 'https://workspace.fermat.vn/examination',
                'registration_note': 'Hạn đăng ký sớm: trước ngày thi sơ loại 14 ngày.',
                'contact_email': 'khaothi@fermat.edu.vn',
                'contact_phone': '024 6666 8888',
                'contact_address': 'Tầng 5, Toà nhà FermatTech, Hà Nội',
                'highlights': [
                    {'title': 'Chuẩn quốc tế', 'description': 'Đề thi và thang chấm xây dựng theo ma trận năng lực, đối sánh với các kỳ thi Olympic khu vực.'},
                    {'title': 'Ba vòng thi rõ ràng', 'description': 'Sơ loại trực tuyến, bán kết theo cụm và chung kết tập trung, lịch thi công bố từ đầu mùa giải.'},
                    {'title': 'Chứng nhận và học bổng', 'description': 'Thí sinh vào vòng chung kết nhận chứng nhận và được xét học bổng từ các trường đối tác.'},
                    {'title': 'Dữ liệu minh bạch', 'description': 'Kết quả từng vòng đồng bộ trực tiếp từ hệ thống khảo thí, tra cứu theo số báo danh.'},
                ],
                'prizes': [
                    {'title': 'Giải Nhất mỗi bảng', 'description': 'Cúp, chứng nhận và học bổng trị giá 30.000.000 đồng.'},
                    {'title': 'Giải Nhì mỗi bảng', 'description': 'Chứng nhận và học bổng trị giá 15.000.000 đồng.'},
                    {'title': 'Giải Ba mỗi bảng', 'description': 'Chứng nhận và học bổng trị giá 8.000.000 đồng.'},
                    {'title': 'Giải Thí sinh ấn tượng', 'description': 'Dành cho thí sinh có bài làm sáng tạo nhất mỗi vòng chung kết.'},
                ],
                'faqs': [
                    {'question': 'Ai được tham dự cuộc thi?', 'answer': 'Học sinh đang học lớp 6 đến lớp 12 tại các trường trên toàn quốc, đăng ký qua trường hoặc đăng ký cá nhân.'},
                    {'question': 'Vòng sơ loại thi theo hình thức nào?', 'answer': 'Thi trực tuyến trên hệ thống của FermatTech, thí sinh nhận tài khoản và số báo danh trước ngày thi 3 ngày.'},
                    {'question': 'Kết quả được công bố ở đâu?', 'answer': 'Kết quả từng vòng công bố trên trang này và gửi qua email đăng ký của thí sinh.'},
                    {'question': 'Cuộc thi có thu lệ phí không?', 'answer': 'Lệ phí dự thi được công bố cùng thông báo mở đăng ký của từng mùa giải.'},
                ],
                'organizers': [
                    {'name': 'FermatTech', 'role': 'Đơn vị tổ chức và vận hành hệ thống khảo thí'},
                    {'name': 'Hội đồng chuyên môn', 'role': 'Xây dựng đề thi, phản biện và chấm thi'},
                    {'name': 'Các trường đối tác', 'role': 'Đăng cai điểm thi và đồng hành học bổng'},
                ],
                'updated_by': 'demo',
            },
        )
        self.stdout.write(self.style.SUCCESS(f'Đã tạo dữ liệu mẫu. Đường dẫn công khai: /cuoc-thi/{SLUG}'))
