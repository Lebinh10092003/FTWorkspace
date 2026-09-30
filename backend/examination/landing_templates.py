"""Starter content for the 2026–2027 Olympiad landing pages.

Public reference files were supplied in the FermatTech Drive folder. Keep
unconfirmed operational details (award rates and fanpage URLs) empty.
"""


def drive_file(file_id):
    return f'https://drive.google.com/file/d/{file_id}/view'


def drive_folder(folder_id):
    return f'https://drive.google.com/drive/folders/{folder_id}'


PAPER_IDS = {
    'FIMO': [
        '1_C-i9z1DUkuF72cYhrZaZ5YdyMb9r3Ek', '1Fm3-rHodiASbWjIf505yQtYhAVlrDdma',
        '15RXuiwVlxDNOVFrlmLrTEMMr5S_kx6pC', '1i1POFNNXAlv4SjXvBFvpT9NA97vKXEjS',
        '1_-72D9e5gOqkQfN7FQNwXIjKcrYMkInQ', '1WTO3L6zt7Pgo1AeDQeChd9mRP_LURs-L',
        '1FNXxmYzFBAiEnxPTJqR5LSnaqGrCVUL2', '1rqtW4Cc4EMC6X4czPjgBglD5CHY6WRKf',
        '1qlUsHTjKgc3YNngAamvAMVK65Oq_ZsqN',
    ],
    'FIEO': [
        '1Q-eAMi1HO4Kwy2H88YZI3OO5NqkhfNNi', '11PqTKGPb3dM8SKx14jSbLWBxJH8UB1Oq',
        '1PhvNeaLvcS6J0u-kjXJwTvLWiWUP7fdL', '18xiqQqzga-BIxStqN0yc3NF_R5tPl09_',
        '1WDkqnb9y_RqDU0k0a5SzXOZmQBV6bwG-', '1hCNqGY6AplsA5TRFbCVKggM0zq5xiIOH',
        '1HWFcOvBzQ1ReoRYfRYl8uXs1c6zfs609', '1FTaLpfUcv9tOeU_OIRFPbpnVSjI1OtbG',
        '1uj5H4MdCHCEOu2hq_nku871LpbslIlQR',
    ],
    'SIAIO': [
        '1Gisn8snec-tdU0JAMM-tv4LrnFMkGmZU', '1Ef9Iuct3u9VxahtKSreL2eel0VkNGIFJ',
        '11AWalK4yA4LkdE1RvP6NLEkc1Vi_tTy0', '1aBgq1gQEu4Zjtu2SY8RGE1DGjWedwys-',
        '1AuPzbxMmXl2Zf5CdQF5RrQZy192Eq6EA', '1Fa-VtfD0lyJfO5ckQrJaHs2zecrEPitI',
        '1N6sutW5nI3J7H2Nuodkp5pwYFRq6H8o5', '1lhmCXp_ikph0RglNZByQFyF1Z3HU4xRm',
        '1iDWqmNQcg1w_xgxWCjRungA2s15CW-pS', '1hjTRHs4oVcJxhxCk-7JO7cPACgwcPD3V',
        '1saJnvwgcVnRDhIap_HhTxb-knU63BdAU', '17snHP63W2TpKBoRldbCe3mBemDc07_wI',
    ],
}


def paper_links(subject):
    return {str(grade): drive_file(file_id) for grade, file_id in enumerate(PAPER_IDS[subject], 1)}


FT_GUIDE = drive_file('1BCtw0hXZx_VQGkkLFzM3k0kc0rH4XsdM')
SCO_GUIDE = drive_file('1gIhBJlOFmDmpcOZm_WXd92AEJ0aD9avJ')


def olympiad_content(subject):
    is_math = subject == 'FIMO'
    name = ('FermatTech International Mathematics Olympiad' if is_math
            else 'FermatTech International English Olympiad')
    # Mùa 2026–2027 theo các phiên thi FIMO/FIEO trong mô-đun Khảo thí.
    dates = (['2026-10-11', '2026-12-06', '2027-02-28', '2027-04-25', '2027-07-11']
             if is_math else
             ['2026-10-18', '2026-12-13', '2027-03-07', '2027-05-02', '2027-07-18'])
    return {
        'subject': subject,
        'badge': 'KỲ THI OLYMPIC TOÀN QUỐC · LỚP 1–9',
        'headline': f'{subject} — {name}',
        'intro': ('Thử sức với Toán học, tư duy logic, lập luận và giải quyết vấn đề qua đề thi song ngữ theo từng khối lớp.'
                  if is_math else 'Rèn kiến thức ngôn ngữ, đọc hiểu và vận dụng tiếng Anh trong ngữ cảnh qua thử thách học thuật tham chiếu CEFR.'),
        'logoUrl': '/logo.png',
        'buttons': [
            {'label': 'Đăng ký ngay', 'url': '#dang-ky'},
            {'label': 'Khám phá đề mẫu', 'url': '#de-mau'},
        ],
        'highlights': [
            {'value': 'Lớp 1–9', 'label': 'Đối tượng dự thi'},
            {'value': '3 đợt', 'label': 'Vòng loại Quốc gia'},
            {'value': '2026–2027', 'label': 'Mùa thi'},
        ],
        'overview': [
            {'title': 'FIMO · Toán học', 'body': 'Đề thi song ngữ Việt – Anh, chú trọng tư duy logic, lập luận và giải quyết vấn đề.', 'url': '/cuoc-thi/fimo'},
            {'title': 'FIEO · Tiếng Anh', 'body': 'Bài thi tiếng Anh chú trọng kiến thức ngôn ngữ, đọc hiểu và vận dụng theo định hướng CEFR.', 'url': '/cuoc-thi/fieo'},
        ],
        'papers': {subject: paper_links(subject)},
        'resources': [
            {'category': 'Thể lệ', 'title': 'Thể lệ FIMO & FIEO 2026–2027',
             'body': 'Đối tượng, nội dung và lộ trình các vòng thi.',
             'url': drive_file('1XS-3cTL7Xc3zkqfSBt6DjWSiDYJeJMRZ')},
            {'category': 'Đăng ký', 'title': 'Hướng dẫn đăng ký',
             'body': 'Các bước đăng ký theo đơn vị và cá nhân.', 'url': FT_GUIDE},
            {'category': 'Tổ chức', 'title': 'Hồ sơ năng lực FermatTech',
             'body': 'Giới thiệu đơn vị tổ chức cùng hai cuộc thi FIMO và FIEO.',
             'url': drive_file('1_cPOuLR8GfPqisXdxUOt2tEYDCuQNzUk')},
        ],
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
            'schoolUrl': '', 'excelUrl': drive_file('1DyS9ujOe_akBH0LHa3z60473JSOxHHMO'),
            'individualUrl': '', 'handbookUrl': FT_GUIDE,
        },
        'contact': {
            'email': 'khaothi@fermat.vn', 'phone': '0969 627 162',
            'address': 'Phòng 1603, Eurowindow Multi Complex, 27 Trần Duy Hưng, phường Yên Hòa, Hà Nội',
            'zaloUrl': 'https://zalo.me/fermattech',
            'facebookFimoUrl': '', 'facebookFieoUrl': '',
        },
        'customSections': [],
    }


def siaio_content():
    """Separate SCO AI page, with configurable subjects and one compact paper picker."""
    return {
        'subject': 'SIAIO',
        'badge': 'SCO · OLYMPIAD TRÍ TUỆ NHÂN TẠO 2026–2027',
        'headline': 'SIAIO · Khám phá trí tuệ nhân tạo',
        'intro': 'Olympic Trí tuệ nhân tạo Quốc tế dành cho học sinh lớp 1–12, khám phá dữ liệu, máy học, ứng dụng và đạo đức AI qua thử thách phù hợp từng khối lớp.',
        'logoUrl': '/logo.png',
        'buttons': [
            {'label': 'Đăng ký dự thi', 'url': '#dang-ky'},
            {'label': 'Xem đề mẫu', 'url': '#de-mau'},
        ],
        'highlights': [
            {'value': '04/10', 'label': 'Vòng loại Quốc gia'},
            {'value': '08/11', 'label': 'Chung kết Quốc gia'},
            {'value': '27/12', 'label': 'Chung kết Quốc tế'},
        ],
        'overview': [
            {'title': 'Tư duy AI cho thế hệ mới', 'body': 'Khám phá dữ liệu, ứng dụng AI và những tình huống phù hợp với từng khối lớp.', 'url': ''},
        ],
        'paperSubjects': ['Trí tuệ nhân tạo'],
        'papers': {'Trí tuệ nhân tạo': paper_links('SIAIO')},
        'resources': [
            {'category': 'Thể lệ', 'title': 'Thể lệ SCO Cycle 1 2026–2027',
             'body': 'Nội dung SIAIO, lịch thi, điều kiện dự thi và giải thưởng.',
             'url': drive_file('1WwFbfcZfW9GUa7fFKA_sDl_DLI27EvVX')},
            {'category': 'Tổ chức', 'title': 'FermatTech và School Connect Olympiad',
             'body': 'Hồ sơ đơn vị triển khai tại Việt Nam và giới thiệu SCO.',
             'url': drive_file('1ehdK9YOjLD67H0kHi5Phj0RUtuxMZF-Y')},
            {'category': 'Đăng ký', 'title': 'Hướng dẫn đăng ký SCO',
             'body': 'Hướng dẫn tham dự các cuộc thi SCO Cycle 1.', 'url': SCO_GUIDE},
            {'category': 'Đề mẫu SCO', 'title': 'Đề tham khảo các môn SCO',
             'body': 'Tìm đề SIAIO, SIBO, SIChO, SIPhO và SILSO trong một thư mục.',
             'url': drive_folder('1e8NPQydnVBEG3q2T2Lw07fpK7zWRW3tH')},
            {'category': 'Học liệu SCO', 'title': 'SIBO · Sinh học',
             'body': 'Tài liệu học tập song ngữ cho lớp 8–12.',
             'url': drive_folder('19FffaubVHyfnEEZHhlhpNa_lAb3afw9t')},
            {'category': 'Học liệu SCO', 'title': 'SIChO · Hóa học',
             'body': 'Thư mục ghi chú học tập môn Hóa học.',
             'url': drive_folder('1yCGh_ncFs3wVoKNIfYW8adxTig0y4g8v')},
            {'category': 'Học liệu SCO', 'title': 'SIPhO · Vật lí',
             'body': 'Thư mục ghi chú học tập môn Vật lí.',
             'url': drive_folder('17MLVRsmEcNyZ6BK9u6_jSVElCOUt7CIo')},
        ],
        'timeline': [
            {'title': 'Vòng loại Quốc gia', 'date': '2026-10-04', 'mode': 'Theo thông báo của Ban tổ chức'},
            {'title': 'Vòng Chung kết Quốc gia', 'date': '2026-11-08', 'mode': 'Theo thông báo của Ban tổ chức'},
            {'title': 'Vòng Chung kết Quốc tế', 'date': '2026-12-27', 'mode': 'Theo thông báo của Ban tổ chức'},
        ],
        'awards': [],
        'registration': {'schoolUrl': '', 'excelUrl': drive_file('1pwQZwOtsJ86gi7lmjC4jxpXCtu4vP1SO'),
                         'individualUrl': '', 'handbookUrl': SCO_GUIDE},
        'contact': {'email': 'khaothi@fermat.vn', 'phone': '0969 627 162',
                    'address': 'Phòng 1603, Eurowindow Multi Complex, 27 Trần Duy Hưng, phường Yên Hòa, Hà Nội',
                    'zaloUrl': 'https://zalo.me/fermattech', 'facebookFimoUrl': '', 'facebookFieoUrl': ''},
        'customSections': [],
    }
