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
    'confirmationTitle': 'Kiểm tra & xác nhận thông tin',
    'consent': 'Tôi xác nhận thông tin đã nhập là chính xác và đồng ý để ban tổ chức dùng thông tin này xử lý đăng ký dự thi.',
    'submitLabel': 'Lưu hồ sơ & đến thanh toán',
    'submitNote': 'Việc gửi form chưa có nghĩa là đã xác nhận thanh toán. Kế toán sẽ kiểm tra riêng.',
    'successTitle': 'Hồ sơ đã được lưu',
    'successMessage': 'Khảo thí đã nhận thông tin. Kế toán sẽ kiểm tra khoản chuyển tiền trước khi xác nhận hoàn tất.',
    # Cuộc thi, kỳ và lệ phí lấy tự động từ Khảo thí (registration_window.py);
    # trang đăng ký chỉ lưu các mã muốn ẩn tạm.
    'blocks': [], 'hiddenCodes': [],
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
    hidden = value.get('hiddenCodes', [])
    if not isinstance(hidden, list) or len(hidden) > 100 or any(
        not isinstance(code, str) or not re.fullmatch(r'[A-Z][A-Z0-9]{1,19}', code) for code in hidden
    ):
        raise ValueError('Danh sách cuộc thi tạm ẩn không hợp lệ.')
    result['hiddenCodes'] = list(dict.fromkeys(hidden))
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
    if FERMAT_CODES - set(result['hiddenCodes']):
        enabled = {field['key'] for field in result['fields'] if field['enabled']}
        if not set(FERMAT_REQUIRED_FIELDS) <= enabled or not result['paymentEnabled']:
            raise ValueError('FIMO/FIEO cần hiển thị đủ thông tin theo form gốc và phần tải chứng từ.')
    return result

def competitions(content, today=None):
    """Cuộc thi đang nhận đăng ký, theo kỳ tổ chức trong Khảo thí."""
    from .registration_window import open_registration_sessions
    rows = []
    for code, (session, offer, name) in open_registration_sessions(content.get('hiddenCodes'), today).items():
        rows.append(dict(code=code, displayCode=session.code if session.code.upper() == code else code, name=name,
                         sessionId=session.id, time=session.time, fee=offer['fee'], deadline=offer['deadline'],
                         entryRound=offer['entryRound'], laterRounds=offer['laterRounds'], **requirement_for(code)))
    return sorted(rows, key=lambda row: (row['deadline'], row['code']))


def session_status(content, today=None):
    """Mọi kỳ chưa hoàn thành, kèm lý do có/không hiện trên form đăng ký."""
    from .registration_window import candidate_sessions, session_offer
    hidden = set(content.get('hiddenCodes') or [])
    open_codes = {row['code']: row['sessionId'] for row in competitions({**content, 'hiddenCodes': []}, today)}
    rows = []
    for code, session, name in candidate_sessions():
        offer = session_offer(session, today)
        if offer['status'] in ('closed-phase', 'expired'):
            continue
        status = offer['status']
        if status == 'open' and open_codes.get(code) != session.id:
            status = 'superseded'
        rows.append(dict(code=code, sessionId=session.id, sessionName=session.name, name=name, phase=session.phase,
                         hidden=code in hidden, **{**offer, 'status': status}))
    return sorted(rows, key=lambda row: (row['status'] != 'open', row['deadline'] or '9999', row['code']))


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
                         competitions=competitions({**page_content(page.draft_content), 'hiddenCodes': []}),
                         sessionStatus=session_status(page_content(page.draft_content))))
