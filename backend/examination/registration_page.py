"""Editable registration form; public requests only use the published version."""
import re
from copy import deepcopy
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from authentication.permissions import IsWorkspaceAuthenticated, request_modules, request_role
from .models import ExamRegistrationPage
from .registration_requirements import PROVINCES, FERMAT_CODES, FERMAT_REQUIRED_FIELDS, requirement_for

BUILTIN_FIELDS = {
    'name': ('Họ và tên thí sinh', 'text', True, 'candidate'),
    'birthDate': ('Ngày sinh', 'date', True, 'candidate'),
    'identity': ('CCCD/Hộ chiếu của thí sinh', 'text', False, 'candidate'),
    'school': ('Trường', 'text', True, 'candidate'),
    'grade': ('Khối lớp', 'select', True, 'candidate'),
    'className': ('Lớp (ví dụ 6A1)', 'text', False, 'candidate'),
    'parentName': ('Họ và tên phụ huynh', 'text', False, 'contact'),
    'email': ('Email liên hệ', 'email', True, 'contact'),
    'submitterEmail': ('Email của người đăng ký', 'email', False, 'contact'),
    'phone': ('Số điện thoại PHHS/thí sinh', 'tel', True, 'contact'),
    'city': ('Tỉnh/thành phố', 'select', True, 'contact'),
    'ward': ('Xã/phường', 'text', True, 'contact'),
    'address': ('Địa chỉ hiện tại', 'text', True, 'contact'),
}
DEFAULT_CONTENT = {
    'brand': 'FermatTech', 'academicYear': 'Năm học 2026–2027',
    'title': 'Đăng ký tham dự cuộc thi',
    'intro': 'Điền thông tin một lần và chọn các cuộc thi muốn tham gia. Những mục có dấu * là bắt buộc.',
    'competitionTitle': 'Chọn cuộc thi', 'competitionDescription': 'Có thể chọn nhiều cuộc thi cho cùng một thí sinh.',
    'candidateTitle': 'Thông tin thí sinh', 'candidateDescription': 'Vui lòng nhập đúng theo giấy tờ và thông tin nhà trường.',
    'contactTitle': 'Liên hệ và địa chỉ', 'contactDescription': 'Ban tổ chức dùng thông tin này để liên hệ về hồ sơ dự thi.',
    'extraTitle': 'Thông tin bổ sung',
    'paymentTitle': 'Thanh toán và chứng từ',
    'paymentDescription': 'Kế toán sẽ đối chiếu tiền thực nhận. Bạn có thể bổ sung ảnh xác nhận chuyển khoản tại đây.',
    'paymentEnabled': True, 'paymentDeclaration': 'Tôi đã chuyển khoản lệ phí dự thi theo hướng dẫn của ban tổ chức.',
    'confirmationTitle': 'Xác nhận và gửi',
    'consent': 'Tôi xác nhận thông tin đã nhập là chính xác và đồng ý để ban tổ chức dùng thông tin này xử lý đăng ký dự thi.',
    'submitLabel': 'Gửi đăng ký',
    'submitNote': 'Việc gửi form chưa có nghĩa là đã xác nhận thanh toán. Kế toán sẽ kiểm tra riêng.',
    'successTitle': 'Đã tiếp nhận đăng ký',
    'successMessage': 'Khảo thí đã nhận thông tin. Kế toán sẽ kiểm tra khoản chuyển tiền trước khi xác nhận hoàn tất.',
    'blocks': [], 'competitionCodes': [], 'sessionLinks': {}, 'fees': {'FIMO': 250000, 'FIEO': 250000},
    'fields': [dict(key=key, label=label, type=kind, required=required, enabled=True, section=section,
                    options=[str(i) for i in range(1, 13)] if key == 'grade' else PROVINCES if key == 'city' else [])
               for key, (label, kind, required, section) in BUILTIN_FIELDS.items()],
}

def page_content(value):
    result = {**deepcopy(DEFAULT_CONTENT), **deepcopy(value or {})}
    # Older saved schemas keep their own order and labels; newly supported
    # response fields remain available without replacing the published schema.
    present = {field['key'] for field in result['fields']}
    for field in DEFAULT_CONTENT['fields']:
        if field['key'] in ('parentName', 'className', 'submitterEmail') and field['key'] not in present:
            result['fields'].append(deepcopy(field))
    return result

def get_page():
    page, _ = ExamRegistrationPage.objects.get_or_create(pk=1)
    return page

def clean_content(value):
    if not isinstance(value, dict):
        raise ValueError('Nội dung trang không hợp lệ.')
    result = page_content(None)
    for key in DEFAULT_CONTENT:
        if isinstance(DEFAULT_CONTENT[key], str):
            result[key] = str(value.get(key, result[key]) or '').strip()[:4000]
    if not result['title'] or not result['consent'] or not result['submitLabel']:
        raise ValueError('Nhập tiêu đề, lời xác nhận và tên nút gửi đăng ký.')
    result['paymentEnabled'] = bool(value.get('paymentEnabled', True))
    codes = value.get('competitionCodes', [])
    if not isinstance(codes, list):
        raise ValueError('Danh sách cuộc thi không hợp lệ.')
    from .form_registration import SESSION_IDS
    from .models import ExamSession
    links = value.get('sessionLinks', {})
    if not isinstance(links, dict) or len(links) > 100 or any(
        not isinstance(code, str) or not re.fullmatch(r'[A-Z][A-Z0-9]{1,19}', code)
        or not isinstance(session_id, str) or not session_id for code, session_id in links.items()
    ):
        raise ValueError('Cấu hình kỳ nhận đăng ký không hợp lệ.')
    if links and ExamSession.objects.filter(pk__in=links.values()).count() != len(set(links.values())):
        raise ValueError('Có kỳ tổ chức không tồn tại. Vui lòng chọn lại.')
    if len(set(links.values())) != len(links):
        raise ValueError('Một kỳ tổ chức chỉ được gắn với một mã cuộc thi.')
    result['sessionLinks'] = links
    available_codes = links or SESSION_IDS
    if any(not isinstance(code, str) or code not in available_codes for code in codes):
        raise ValueError('Có cuộc thi không thuộc danh sách nhận đăng ký.')
    result['competitionCodes'] = list(dict.fromkeys(codes))
    fees = value.get('fees', {})
    if not isinstance(fees, dict) or any(code not in available_codes or isinstance(amount, bool)
        or not isinstance(amount, int) or amount < 0 or amount > 100_000_000 for code, amount in fees.items()):
        raise ValueError('Lệ phí phải là số tiền VND hợp lệ của cuộc thi nhận đăng ký.')
    result['fees'] = fees
    blocks = value.get('blocks', [])
    if not isinstance(blocks, list) or len(blocks) > 30 or any(not isinstance(b, dict) for b in blocks):
        raise ValueError('Tối đa 30 khối nội dung.')
    result['blocks'] = [dict(title=str(b.get('title') or '')[:255], body=str(b.get('body') or '')[:4000]) for b in blocks]
    fields = value.get('fields', result['fields'])
    if not isinstance(fields, list) or len(fields) > 50:
        raise ValueError('Tối đa 50 trường thông tin.')
    result['fields'] = []
    seen = set()
    for field in fields:
        if not isinstance(field, dict):
            raise ValueError('Trường thông tin không hợp lệ.')
        key = str(field.get('key') or '')
        label = str(field.get('label') or '').strip()[:255]
        kind = str(field.get('type') or 'text')
        if key in seen or (key not in BUILTIN_FIELDS and not re.fullmatch(r'custom_[a-zA-Z0-9_-]{1,60}', key)) or not label:
            raise ValueError('Mã trường phải duy nhất và có nhãn hiển thị.')
        if kind not in {'text', 'textarea', 'email', 'tel', 'date', 'select'}:
            raise ValueError('Loại trường không hợp lệ.')
        if key in BUILTIN_FIELDS:
            kind = BUILTIN_FIELDS[key][1]
        options = field.get('options', [])
        if not isinstance(options, list) or len(options) > 50:
            raise ValueError('Tối đa 50 lựa chọn cho mỗi trường.')
        options = list(dict.fromkeys(str(item).strip()[:255] for item in options if str(item).strip()))
        if key == 'grade':
            options = [str(i) for i in range(1, 13)]
        if key == 'city':
            options = PROVINCES
        enabled = bool(field.get('enabled', True))
        if enabled and kind == 'select' and not options:
            raise ValueError(f'Thêm lựa chọn cho trường {label}.')
        result['fields'].append(dict(key=key, label=label, type=kind, options=options,
                                     required=bool(field.get('required')), enabled=enabled,
                                     section=BUILTIN_FIELDS[key][3] if key in BUILTIN_FIELDS else 'extra'))
        seen.add(key)
    name = next((field for field in result['fields'] if field['key'] == 'name'), None)
    if not name or not name['enabled'] or not name['required']:
        raise ValueError('Họ tên thí sinh phải được hiển thị và bắt buộc.')
    if FERMAT_CODES & set(result['competitionCodes'] or available_codes):
        enabled = {field['key'] for field in result['fields'] if field['enabled']}
        if not set(FERMAT_REQUIRED_FIELDS) <= enabled or not result['paymentEnabled']:
            raise ValueError('FIMO/FIEO cần hiển thị đủ thông tin theo form gốc và phần tải chứng từ.')
    return result

def competitions(content):
    from .public_registration import open_sessions
    from .models import Competition
    sessions = open_sessions(content)
    names = dict(Competition.objects.filter(pk__in=[session.competition_id for _, session in sessions]).values_list('id', 'name'))
    return [dict(code=code, displayCode=session.code if session.code.upper() == code else code, name=names.get(session.competition_id) or session.name,
                 sessionId=session.id, time=session.time, fee=content.get('fees', {}).get(code), **requirement_for(code)) for code, session in sessions
            if not content['competitionCodes'] or code in content['competitionCodes']]

@api_view(['GET', 'PUT', 'POST'])
@permission_classes([IsWorkspaceAuthenticated])
def registration_page(request):
    if request_role(request) != 'ADMIN' and not ({'examination', 'social-dashboard'} & request_modules(request)):
        return Response({'error': 'Không có quyền quản lý trang đăng ký.'}, status=403)
    if request.method != 'GET' and request_role(request) not in {'ADMIN', 'MANAGER'}:
        return Response({'error': 'Chỉ quản lý hoặc quản trị viên được chỉnh sửa và xuất bản.'}, status=403)
    page = get_page()
    if request.method == 'PUT':
        try:
            page.draft_content = clean_content(request.data.get('content'))
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        page.updated_by = request.user.email
        page.save()
    elif request.method == 'POST':
        action = request.data.get('action')
        if action == 'publish':
            try:
                page.published_content = clean_content(request.data.get('content', page_content(page.draft_content)))
            except ValueError as exc:
                return Response({'error': str(exc)}, status=400)
            page.draft_content = deepcopy(page.published_content)
            page.published = True
            page.published_at = timezone.now()
        elif action == 'unpublish':
            page.published = False
        else:
            return Response({'error': 'Thao tác xuất bản không hợp lệ.'}, status=400)
        page.updated_by = request.user.email
        page.save()
    return Response(dict(content=page_content(page.draft_content), publishedContent=page_content(page.published_content), published=page.published,
                         publishedAt=page.published_at, updatedAt=page.updated_at,
                         canEdit=request_role(request) in {'ADMIN', 'MANAGER'},
                         competitions=competitions({**page_content(page.draft_content), 'competitionCodes': []}),
                         sessionOptions=session_options()))


def session_options():
    from .form_registration import SESSION_IDS
    from .models import Competition, ExamSession
    codes = dict(Competition.objects.values_list('id', 'code'))
    legacy = {session_id: code for code, session_id in SESSION_IDS.items()}
    sco_aliases = {code: f'S{code}' for code in ('IMO', 'IEO', 'ISO', 'ICO', 'IGKO', 'IMAO', 'IFKO', 'IEIO', 'ISSO')}
    def public_code(session):
        code = str(legacy.get(session.id) or codes.get(session.competition_id) or session.code).upper()
        return sco_aliases.get(code, code)
    return [dict(sessionId=session.id, code=public_code(session), **requirement_for(public_code(session)),
                 name=session.name, time=session.time, phase=session.phase)
            for session in ExamSession.objects.all().order_by('-time', 'sort_key')]
