from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from authentication.permissions import IsAdmin, IsWorkspaceAuthenticated
from authentication.views import _client_ip

from . import services
from .models import CompanyAccount, CompanyAccountLog


def _actor(request) -> str:
    return str(getattr(request.user, "email", "") or "").strip().lower()


def _no_store(response):
    """Phản hồi có mật khẩu: không cho trình duyệt/proxy lưu cache."""
    response["Cache-Control"] = "no-store"
    return response


def _int_param(value, default=None, maximum=None):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return min(number, maximum) if maximum else number


@api_view(["GET", "POST"])
@permission_classes([IsWorkspaceAuthenticated])
def company_accounts(request):
    if request.method == "GET":
        params = request.query_params
        qs = services.filter_accounts(
            CompanyAccount.objects.all(),
            search=params.get("search", ""),
            category=params.get("category", ""),
            status=params.get("status", ""),
            owner=params.get("owner", ""),
            renewal_within_days=_int_param(params.get("renewalWithin")),
        )
        return _no_store(Response([services.account_payload(a, include_password=True) for a in qs]))

    data = request.data if isinstance(request.data, dict) else {}
    try:
        account = services.save_account(CompanyAccount(), data, _actor(request), ip=_client_ip(request))
    except services.AccountValidationError as exc:
        return Response({"error": "Dữ liệu chưa hợp lệ.", "errors": exc.errors}, status=status.HTTP_400_BAD_REQUEST)
    return _no_store(Response(services.account_payload(account, include_password=True), status=status.HTTP_201_CREATED))


@api_view(["GET", "PATCH", "PUT", "DELETE"])
@permission_classes([IsWorkspaceAuthenticated])
def company_account_detail(request, pk):
    account = CompanyAccount.objects.filter(pk=pk).first()
    if not account:
        return Response({"error": "Không tìm thấy tài khoản."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        return _no_store(Response(services.account_payload(account, include_password=True)))
    if request.method == "DELETE":
        # Mọi nhân viên xem và sửa được; xóa hẳn chỉ Admin (không hoàn tác được).
        if not IsAdmin().has_permission(request, None):
            return Response({"error": "Chỉ Admin được xóa tài khoản. Muốn ngừng dùng, đổi trạng thái sang Đã hủy."},
                            status=status.HTTP_403_FORBIDDEN)
        services.delete_account(account, _actor(request), ip=_client_ip(request))
        return Response(status=status.HTTP_204_NO_CONTENT)
    data = request.data if isinstance(request.data, dict) else {}
    try:
        services.save_account(account, data, _actor(request), ip=_client_ip(request))
    except services.AccountValidationError as exc:
        return Response({"error": "Dữ liệu chưa hợp lệ.", "errors": exc.errors}, status=status.HTTP_400_BAD_REQUEST)
    return _no_store(Response(services.account_payload(account, include_password=True)))


@api_view(["POST"])
@permission_classes([IsWorkspaceAuthenticated])
def company_account_reveal(request, pk):
    account = CompanyAccount.objects.filter(pk=pk).first()
    if not account:
        return Response({"error": "Không tìm thấy tài khoản."}, status=status.HTTP_404_NOT_FOUND)
    if not account.password_encrypted:
        return Response({"password": ""})
    try:
        password = services.reveal_password(account, _actor(request), ip=_client_ip(request))
    except ValueError as exc:
        return Response({"error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    response = Response({"password": password})
    response["Cache-Control"] = "no-store"
    return response


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def company_accounts_summary(request):
    days = _int_param(request.query_params.get("days"), 30, 365)
    return Response(services.summary(CompanyAccount.objects.all(), days_ahead=days))


@api_view(["GET"])
@permission_classes([IsWorkspaceAuthenticated])
def company_account_logs(request):
    qs = CompanyAccountLog.objects.all()
    account_id = _int_param(request.query_params.get("account"))
    if account_id:
        qs = qs.filter(account_id=account_id)
    limit = _int_param(request.query_params.get("limit"), 100, 500)
    return Response([services.log_payload(item) for item in qs[:limit]])
