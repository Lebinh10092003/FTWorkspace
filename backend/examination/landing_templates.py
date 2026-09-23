"""Starter content for the two Olympiad landing pages.

Operational facts that have not been provided (dates, paper files, bank details,
award percentages and fanpage URLs) deliberately remain empty.
"""


def olympiad_content(subject):
    is_math = subject == 'FIMO'
    name = ('Fermat International Mathematics Olympiad' if is_math
            else 'Fermat International English Olympiad')
    # Mùa 2026–2027 theo các phiên thi FIMO/FIEO trong mô-đun Khảo thí.
    dates = (['2026-09-20', '2026-12-06', '2027-02-28', '2027-04-25', '2027-07-11']
             if is_math else
             ['2026-09-27', '2026-12-13', '2027-03-07', '2027-05-02', '2027-07-18'])
    return {
        'subject': subject,
        'badge': 'KỲ THI OLYMPIC TOÀN QUỐC · LỚP 1–9',
        'headline': f'{subject} — {name}',
        'intro': ('Khám phá năng lực Toán học, rèn tư duy logic và giải quyết vấn đề trong môi trường học thuật hiện đại.'
                  if is_math else 'Phát triển năng lực tiếng Anh toàn diện qua thử thách học thuật theo định hướng CEFR.'),
        'logoUrl': '/logo.png',
        'buttons': [
            {'label': 'Đăng ký ngay', 'url': '#dang-ky'},
            {'label': 'Khám phá đề mẫu', 'url': '#de-mau'},
        ],
        'highlights': [
            {'value': 'Lớp 1–9', 'label': 'Đối tượng dự thi'},
            {'value': '3 vòng', 'label': 'Vòng loại trực tuyến'},
            {'value': 'Google for Education', 'label': 'Đối tác giáo dục'},
        ],
        'overview': [
            {'title': 'FIMO · Toán học', 'body': 'Đề thi song ngữ, chú trọng tư duy logic, giải quyết vấn đề và tư duy AI.', 'url': '/cuoc-thi/fimo'},
            {'title': 'FIEO · Tiếng Anh', 'body': 'Bài thi 100% tiếng Anh, phát triển bốn kỹ năng theo định hướng CEFR.', 'url': '/cuoc-thi/fieo'},
        ],
        'papers': {'FIMO': {str(i): '' for i in range(1, 10)},
                   'FIEO': {str(i): '' for i in range(1, 10)}},
        'timeline': [
            {'title': f'Vòng loại trực tuyến {i}', 'date': dates[i - 1], 'mode': 'Trực tuyến'} for i in range(1, 4)
        ] + [
            {'title': 'Chung kết Quốc gia', 'date': dates[3], 'mode': 'Theo thông báo của Ban tổ chức'},
            {'title': 'Chung kết Quốc tế', 'date': dates[4], 'mode': 'Theo thông báo của Ban tổ chức'},
        ],
        'awards': [
            {'title': title, 'percent': '', 'description': ''}
            for title in ('Huy chương Vàng', 'Huy chương Bạc', 'Huy chương Đồng', 'Giải Khuyến khích')
        ],
        'registration': {
            'schoolUrl': '', 'excelUrl': '',
            'individualUrl': '', 'handbookUrl': '', 'bankName': 'VPBank',
            'accountName': '', 'accountNumber': '', 'transferNote': '',
        },
        'contact': {
            'email': '', 'phone': '0969 627 162',
            'address': 'Eurowindow Multi Complex, 27 Trần Duy Hưng, Hà Nội',
            'zaloUrl': 'https://zalo.me/fermattech',
            'facebookFimoUrl': '', 'facebookFieoUrl': '',
        },
        'customSections': [],
    }
