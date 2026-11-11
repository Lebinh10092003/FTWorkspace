"""Requirements verified against the FIMO/FIEO form supplied on 11/11/2026."""

FERMAT_CODES = {'FIMO', 'FIEO'}
FERMAT_REQUIRED_FIELDS = ('name', 'birthDate', 'identity', 'school', 'grade', 'className',
                          'email', 'submitterEmail', 'phone', 'city', 'ward', 'address')
PROVINCES = ['TP. Hà Nội', 'TP. HCM', 'TP. Hải Phòng', 'TP. Đà Nẵng', 'TP. Huế', 'TP. Đồng Nai',
             'TP. Cần Thơ', 'Tuyên Quang', 'Cao Bằng', 'Lai Châu', 'Lào Cai', 'Thái Nguyên',
             'Điện Biên', 'Lạng Sơn', 'Sơn La', 'Phú Thọ', 'Bắc Ninh', 'Quảng Ninh', 'Hưng Yên',
             'Ninh Bình', 'Thanh Hóa', 'Nghệ An', 'Hà Tĩnh', 'Quảng Trị', 'Quảng Ngãi', 'Gia Lai',
             'Đắk Lắk', 'Khánh Hòa', 'Lâm Đồng', 'Tây Ninh', 'Đồng Tháp', 'An Giang', 'Vĩnh Long', 'Cà Mau']


def requirement_for(code):
    if code in FERMAT_CODES:
        return {'requiredFields': list(FERMAT_REQUIRED_FIELDS), 'proofRequired': True,
                'minGrade': 1, 'maxGrade': 9}
    return {'requiredFields': [], 'proofRequired': False}


def effective_fields(content, codes):
    required = {key for code in codes for key in requirement_for(code)['requiredFields']}
    return [dict(field, required=field['required'] or field['key'] in required) for field in content['fields']]
