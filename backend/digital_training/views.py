from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from authentication.permissions import IsAuthenticatedOrReadOnly
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, BasePermission
import calendar
import datetime
import hmac
import json
import logging
import os
import secrets
import sys
import unicodedata
import uuid
from django.conf import settings
from django.utils import timezone

from django.db.models import Q
from authentication.permissions import IsAuthenticated, IsManagerOrAdmin
from authentication.models import UserProfile
from examination.models import LogNote
from .completion_service import complete_past_training_schedules
from .product_service import sync_partner_product_subscriptions
from .models import (
    TrainingClass, TrainingCustomerMeeting, TrainingFinanceEntry, TrainingLead,
    TrainingMaterial, TrainingPartner, TrainingPartnerAiAccount, TrainingProduct,
    TrainingProductOpportunity, TrainingProductSubscription, TrainingSession, TrainingSurvey,
)
from .serializers import (
    TrainingClassSerializer, TrainingCustomerMeetingSerializer, TrainingFinanceEntrySerializer,
    TrainingLeadSerializer, TrainingMaterialSerializer, TrainingPartnerSerializer,
    TrainingPartnerAiAccountSerializer, TrainingProductOpportunitySerializer,
    TrainingProductSerializer, TrainingProductSubscriptionSerializer,
    TrainingSessionSerializer, TrainingSurveySerializer,
)
from .session_notifications import notify_training_session_created, notify_training_session_deleted, notify_training_session_updated


def _sync_session_to_work_schedule(item, kind, request):
    # Off by default: a training session is not a personal work-schedule task.
    # See TRAINING_WORK_SCHEDULE_PROJECTION_ENABLED in config/settings.py.
    if kind != "buổi tập huấn" or not settings.TRAINING_WORK_SCHEDULE_PROJECTION_ENABLED:
        return
    from work_schedule.training_sync import sync_work_item_from_training
    sync_work_item_from_training(item, request.user)


def _delete_session_from_work_schedule(item, kind):
    if kind != "buổi tập huấn" or not settings.TRAINING_WORK_SCHEDULE_PROJECTION_ENABLED:
        return
    from work_schedule.training_sync import delete_work_item_for_training
    delete_work_item_for_training(item)


def _can_manage(request):
    return IsManagerOrAdmin().has_permission(request, None)


def _forbidden():
    return Response({"error": "Bạn không có quyền thay đổi dữ liệu Đào tạo số."}, status=status.HTTP_403_FORBIDDEN)


_PLACEHOLDER_WEBHOOK_SECRETS = {
    "",
    "replace-with-a-long-random-value",
    "replace-with-a-different-long-random-value",
}


def _get_or_create_subscription_webhook_secret() -> str:
    from authentication.models import SystemConfig
    from .subscription_sheet_sync import SYNC_CONFIG_KEY

    env_secret = (
        os.getenv("SUBSCRIPTION_SHEET_WEBHOOK_SECRET")
        or getattr(settings, "SUBSCRIPTION_SHEET_WEBHOOK_SECRET", "")
        or os.getenv("SHEET_WEBHOOK_SECRET")
        or getattr(settings, "SHEET_WEBHOOK_SECRET", "")
        or ""
    ).strip()
    if env_secret in _PLACEHOLDER_WEBHOOK_SECRETS:
        env_secret = ""

    try:
        config_obj, _ = SystemConfig.objects.get_or_create(key=SYNC_CONFIG_KEY)
        config_data = dict(config_obj.data or {})
        stored_secret = str(config_data.get("webhookSecret") or "").strip()
        if stored_secret and stored_secret not in _PLACEHOLDER_WEBHOOK_SECRETS:
            return stored_secret
        generated = env_secret or secrets.token_urlsafe(24)
        config_data["webhookSecret"] = generated
        config_obj.data = config_data
        config_obj.save(update_fields=["data"])
        return generated
    except Exception:
        return env_secret


def _get_valid_subscription_webhook_secrets() -> list[str]:
    from authentication.models import SystemConfig
    from .subscription_sheet_sync import SYNC_CONFIG_KEY

    candidates = [
        os.getenv("SUBSCRIPTION_SHEET_WEBHOOK_SECRET", ""),
        getattr(settings, "SUBSCRIPTION_SHEET_WEBHOOK_SECRET", ""),
        os.getenv("SHEET_WEBHOOK_SECRET", ""),
        getattr(settings, "SHEET_WEBHOOK_SECRET", ""),
    ]
    try:
        config_obj = SystemConfig.objects.filter(key=SYNC_CONFIG_KEY).first()
        if config_obj and isinstance(config_obj.data, dict):
            candidates.append(str(config_obj.data.get("webhookSecret") or ""))
    except Exception:
        pass

    valid: list[str] = []
    for item in candidates:
        cleaned = str(item or "").strip()
        if cleaned and cleaned not in _PLACEHOLDER_WEBHOOK_SECRETS and cleaned not in valid:
            valid.append(cleaned)
    return valid


def _is_sheet_webhook_authorized(request) -> bool:
    data = request.data if isinstance(getattr(request, "data", None), dict) else {}
    query_secret = request.query_params.get("secret", "") if hasattr(request, "query_params") else ""
    provided_secret = str(
        request.headers.get("X-Sheet-Webhook-Secret")
        or request.headers.get("X-Webhook-Secret")
        or request.META.get("HTTP_X_SHEET_WEBHOOK_SECRET")
        or request.META.get("HTTP_X_WEBHOOK_SECRET")
        or data.get("webhook_secret")
        or data.get("secret")
        or query_secret
        or ""
    ).strip()

    if provided_secret:
        for expected_secret in _get_valid_subscription_webhook_secrets():
            if hmac.compare_digest(provided_secret, expected_secret):
                return True

    return IsAuthenticated().has_permission(request, None) or _can_manage(request)


def _actor(request):
    return getattr(request.user, "email", "") or getattr(request, "user_email", "") or "Nhân viên FT Workspace"


def _normalise_title(value):
    return "".join(
        char for char in unicodedata.normalize("NFD", str(value or "").lower())
        if unicodedata.category(char) != "Mn"
    ).replace("\u0111", "d")


def _finance_permissions(request):
    role = getattr(request, "user_role", "")
    access_modules = set(getattr(request, "access_modules", []) or [])
    title = _normalise_title(getattr(getattr(request.user, "job_title", None), "name", ""))
    department_names = [getattr(getattr(request.user, "department", None), "name", "")]
    departments = getattr(request.user, "departments", None)
    if departments is not None:
        department_names.extend(departments.values_list("name", flat=True))
    identity = _normalise_title(" ".join([title, *department_names]))
    is_accountant = "ke toan" in identity
    has_finance_access = role == "ADMIN" or "finance-report" in access_modules
    can_view = has_finance_access and (role in {"ADMIN", "MANAGER"} or is_accountant or "giam doc" in identity or "quan ly" in identity)
    can_edit = has_finance_access and (role == "ADMIN" or is_accountant)
    return can_view, can_edit


def _finance_forbidden(edit=False):
    message = (
        "Ch\u1ec9 K\u1ebf to\u00e1n v\u00e0 Admin \u0111\u01b0\u1ee3c ch\u1ec9nh s\u1eeda b\u00e1o c\u00e1o thu chi."
        if edit else "B\u1ea1n kh\u00f4ng c\u00f3 quy\u1ec1n xem b\u00e1o c\u00e1o thu chi."
    )
    return Response({"error": message}, status=status.HTTP_403_FORBIDDEN)



class CanViewTrainingFinance(BasePermission):
    def has_permission(self, request, view):
        return _finance_permissions(request)[0]


@api_view(["GET"])
@permission_classes([CanViewTrainingFinance])
def finance_partners(request):
    """Minimal partner catalogue used by the finance workspace.

    It deliberately has the finance permission rather than the broader Digital
    Training permission, so finance access can be granted independently.
    """
    return Response(list(TrainingPartner.objects.order_by("name").values("id", "name")))


def _snapshot(serializer_class, item, request):
    return dict(serializer_class(item, context={"request": request}).data)


def _parent_partner(item):
    if isinstance(item, TrainingPartner):
        return item
    if isinstance(item, TrainingClass):
        return item.partner
    if isinstance(item, TrainingSession):
        return item.partner_ref or (item.training_class.partner if item.training_class else None)
    return getattr(item, "partner", None)


def _append_training_audit(entity_key, action, before, after, request, system=False):
    payload = after if after is not None else before
    content = f"{action}. Toàn bộ dữ liệu: {json.dumps(payload or {}, ensure_ascii=False, default=str, separators=(',', ':'))}"
    actor_email = "" if system else (getattr(request.user, "email", "") or "")
    profile = UserProfile.objects.filter(email=actor_email).first() if actor_email else None
    LogNote.objects.create(
        key=f"{entity_key}:{uuid.uuid4().hex}",
        entity_key=entity_key,
        content=content,
        updated_by=_actor(request) if not system else "Hệ thống FT Workspace",
        actor_email=actor_email or None,
        actor_photo_url=(profile.photo_url or "") if profile else "",
        system=system,
    )
    return content


def _audit_item(item, kind, action, before, request, serializer_class, system=False):
    after = _snapshot(serializer_class, item, request) if item is not None else None
    content = _append_training_audit(f"digital-training-{kind}-{item.pk if item is not None else before.get('id')}", action, before, after, request, system)
    parent = _parent_partner(item) if item is not None else None
    if parent is not None:
        _append_training_audit(f"digital-training-partner-{parent.pk}", f"{action} ({kind})", before, after, request, system)
    return after, content


def _crud_collection(request, queryset, serializer_class, kind):
    if request.method == "GET":
        return Response(serializer_class(queryset, many=True, context={"request": request}).data)
    if not _can_manage(request):
        return _forbidden()
    serializer = serializer_class(data=request.data, context={"request": request})
    serializer.is_valid(raise_exception=True)
    item = serializer.save()
    _sync_session_to_work_schedule(item, kind, request)
    if isinstance(item, TrainingSession):
        notify_training_session_created(_snapshot(serializer_class, item, request))
        try:
            from .training_sheet_sync import export_training_sessions_to_sheet
            export_training_sessions_to_sheet(force=True)
        except Exception as exc:
            logger.warning(f"Lỗi tự động xuất sheet sau khi tạo buổi tập huấn: {exc}")
    elif kind == "đăng ký sản phẩm":
        try:
            from .subscription_queue import enqueue_subscription
            enqueue_subscription(item.pk, "upsert")
        except Exception as exc:
            logger.warning(f"Lỗi đưa đăng ký sản phẩm vào hàng đợi: {exc}")
    _audit_item(item, kind, f"Tạo {kind}", None, request, serializer_class)
    return Response(serializer_class(item, context={"request": request}).data, status=status.HTTP_201_CREATED)


def _crud_detail(request, queryset, serializer_class, pk, kind):
    item = queryset.filter(pk=pk).first()
    if not item:
        return Response({"error": "Không tìm thấy dữ liệu."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        return Response(serializer_class(item, context={"request": request}).data)
    if not _can_manage(request):
        return _forbidden()
    if request.method == "DELETE":
        before = _snapshot(serializer_class, item, request)
        if isinstance(item, TrainingSession):
            notify_training_session_deleted(before)
        _audit_item(item, kind, f"Xóa {kind}", before, request, serializer_class)
        _delete_session_from_work_schedule(item, kind)
        item.delete()
        if kind == "buổi tập huấn":
            try:
                from .training_sheet_sync import export_training_sessions_to_sheet
                export_training_sessions_to_sheet(force=True)
            except Exception as exc:
                logger.warning(f"Lỗi xuất sheet sau khi xóa buổi tập huấn: {exc}")
        elif kind == "đăng ký sản phẩm":
            try:
                from .subscription_queue import enqueue_subscription_deletion
                enqueue_subscription_deletion(item.pk)
            except Exception as exc:
                logger.warning(f"Lỗi đưa đăng ký sản phẩm vào hàng đợi xóa: {exc}")
        return Response(status=status.HTTP_204_NO_CONTENT)
    before = _snapshot(serializer_class, item, request)
    serializer = serializer_class(item, data=request.data, partial=True, context={"request": request})
    serializer.is_valid(raise_exception=True)
    updated = serializer.save()
    _sync_session_to_work_schedule(updated, kind, request)
    if isinstance(updated, TrainingSession):
        notify_training_session_updated(before, _snapshot(serializer_class, updated, request))
        try:
            from .training_sheet_sync import export_training_sessions_to_sheet
            export_training_sessions_to_sheet(force=True)
        except Exception as exc:
            logger.warning(f"Lỗi xuất sheet sau khi cập nhật buổi tập huấn: {exc}")
    elif kind == "đăng ký sản phẩm":
        try:
            from .subscription_queue import enqueue_subscription
            enqueue_subscription(updated.pk, "upsert")
        except Exception as exc:
            logger.warning(f"Lỗi đưa đăng ký sản phẩm vào hàng đợi cập nhật: {exc}")
    _audit_item(updated, kind, f"Cập nhật {kind}", before, request, serializer_class)
    return Response(serializer_class(updated, context={"request": request}).data)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_sessions(request):
    if request.method == "GET":
        complete_past_training_schedules()
    return _crud_collection(request, TrainingSession.objects.select_related("partner_ref", "training_class").all(), TrainingSessionSerializer, "buổi tập huấn")


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_session_detail(request, pk):
    return _crud_detail(request, TrainingSession.objects.select_related("partner_ref", "training_class").all(), TrainingSessionSerializer, pk, "buổi tập huấn")


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_customer_meetings(request):
    if request.method == "GET":
        complete_past_training_schedules()
    if request.method == "POST":
        # Prevent exact duplicates: return existing record when all key fields match.
        title = str(request.data.get("title") or "").strip()
        meeting_date = request.data.get("date") or request.data.get("meeting_date")
        start_time = request.data.get("start_time") or None
        end_time = request.data.get("end_time") or None
        staff_name = str(request.data.get("staff_name") or "").strip()
        if title and meeting_date:
            qs = TrainingCustomerMeeting.objects.filter(
                title=title,
                meeting_date=meeting_date,
                staff_name=staff_name,
            )
            if start_time:
                qs = qs.filter(start_time=start_time)
            if end_time:
                qs = qs.filter(end_time=end_time)
            duplicate = qs.select_related("lead", "partner", "opportunity__product").first()
            if duplicate:
                return Response(
                    TrainingCustomerMeetingSerializer(duplicate, context={"request": request}).data,
                    status=status.HTTP_200_OK,
                )
    return _crud_collection(request, TrainingCustomerMeeting.objects.select_related("lead", "partner", "opportunity__product").all(), TrainingCustomerMeetingSerializer, "cuộc gặp khách hàng")


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_customer_meeting_detail(request, pk):
    return _crud_detail(request, TrainingCustomerMeeting.objects.select_related("lead", "partner", "opportunity__product").all(), TrainingCustomerMeetingSerializer, pk, "cuộc gặp khách hàng")

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def training_leads(request):
    if request.method == "POST" and not request.data.get("allow_existing_partner"):
        name = str(request.data.get("name") or "").strip()
        partner = TrainingPartner.objects.filter(name__iexact=name).first() if name else None
        if partner:
            subscriptions = TrainingProductSubscription.objects.filter(partner=partner).select_related("product")
            return Response({"error": "Duplicate existing customer.", "duplicate_partner": TrainingPartnerSerializer(partner, context={"request": request}).data, "subscriptions": TrainingProductSubscriptionSerializer(subscriptions, many=True, context={"request": request}).data}, status=status.HTTP_409_CONFLICT)
    return _crud_collection(request, TrainingLead.objects.select_related("converted_partner").all(), TrainingLeadSerializer, "khách hàng mới")

@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def training_lead_detail(request, pk):
    return _crud_detail(request, TrainingLead.objects.select_related("converted_partner").all(), TrainingLeadSerializer, pk, "khách hàng mới")


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def training_lead_convert(request, pk):
    if not _can_manage(request):
        return _forbidden()
    lead = TrainingLead.objects.select_related("converted_partner").filter(pk=pk).first()
    if not lead:
        return Response({"error": "Không tìm thấy khách hàng mới."}, status=status.HTTP_404_NOT_FOUND)
    if lead.converted_partner_id:
        return Response({"error": "Khách hàng mới này đã được chuyển đổi."}, status=status.HTTP_409_CONFLICT)
    if not lead.name.strip():
        return Response({"error": "Cần có tên đơn vị trước khi chuyển đổi."}, status=status.HTTP_400_BAD_REQUEST)
    if TrainingPartner.objects.filter(name__iexact=lead.name.strip()).exists():
        return Response(
            {"error": "Đã có khách hàng hiện tại cùng tên. Hãy mở hồ sơ hiện có để cập nhật thay vì tạo trùng."},
            status=status.HTTP_409_CONFLICT,
        )

    before = _snapshot(TrainingLeadSerializer, lead, request)
    partner = TrainingPartner.objects.create(
        name=lead.name.strip(),
        address=lead.address,
        contact_person=lead.representative,
        contact_position=lead.representative_position,
        phone=lead.phone,
        email=lead.email,
        partner_type=lead.lead_type,
        products=lead.interested_products,
        contract_status="signed",
        contract_signed_date=timezone.localdate(),
        contract_start=timezone.localdate().isoformat(),
        notes=lead.notes,
    )
    sync_partner_product_subscriptions(partner)
    lead.converted_partner = partner
    lead.stage = "converted"
    lead.save(update_fields=["converted_partner", "stage", "updated_at"])
    _audit_item(lead, "khách hàng mới", "Chuyển thành khách hàng hiện tại", before, request, TrainingLeadSerializer)
    _audit_item(partner, "khách hàng", "Tạo từ khách hàng mới", None, request, TrainingPartnerSerializer)
    return Response({
        "lead": TrainingLeadSerializer(lead, context={"request": request}).data,
        "partner": TrainingPartnerSerializer(partner, context={"request": request}).data,
    }, status=status.HTTP_201_CREATED)

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_partners(request):
    return _crud_collection(request, TrainingPartner.objects.all(), TrainingPartnerSerializer, "khách hàng")


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_partner_detail(request, pk):
    partner = TrainingPartner.objects.filter(pk=pk).first()
    if not partner:
        return Response({"error": "Không tìm thấy khách hàng."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        complete_past_training_schedules()
        data = TrainingPartnerSerializer(partner, context={"request": request}).data
        data["classes"] = TrainingClassSerializer(partner.classes.all(), many=True, context={"request": request}).data
        data["sessions"] = TrainingSessionSerializer(partner.sessions.select_related("partner_ref", "training_class").all(), many=True, context={"request": request}).data
        data["materials"] = TrainingMaterialSerializer(partner.materials.all(), many=True, context={"request": request}).data
        data["surveys"] = TrainingSurveySerializer(partner.surveys.all(), many=True, context={"request": request}).data
        return Response(data)
    return _crud_detail(request, TrainingPartner.objects.all(), TrainingPartnerSerializer, pk, "khách hàng")


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_classes(request):
    return _crud_collection(request, TrainingClass.objects.select_related("partner").all(), TrainingClassSerializer, "lớp/phân nhóm")


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_class_detail(request, pk):
    return _crud_detail(request, TrainingClass.objects.select_related("partner").all(), TrainingClassSerializer, pk, "lớp/phân nhóm")


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_products(request):
    queryset = TrainingProduct.objects.prefetch_related("subscriptions").all()
    return _crud_collection(request, queryset, TrainingProductSerializer, "sản phẩm")


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_product_detail(request, pk):
    if request.method == "DELETE" and not _can_manage(request):
        return _forbidden()
    item = TrainingProduct.objects.prefetch_related("subscriptions").filter(pk=pk).first()
    if request.method == "DELETE" and item and item.subscriptions.exists():
        return Response({"error": "San pham dang co khach hang su dung; hay chuyen sang ngung hoat dong thay vi xoa."}, status=status.HTTP_400_BAD_REQUEST)
    return _crud_detail(request, TrainingProduct.objects.prefetch_related("subscriptions").all(), TrainingProductSerializer, pk, "sản phẩm")


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_product_subscriptions(request):
    queryset = TrainingProductSubscription.objects.select_related("partner", "product").all()
    return _crud_collection(request, queryset, TrainingProductSubscriptionSerializer, "đăng ký sản phẩm")


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_product_subscription_detail(request, pk):
    queryset = TrainingProductSubscription.objects.select_related("partner", "product").all()
    return _crud_detail(request, queryset, TrainingProductSubscriptionSerializer, pk, "đăng ký sản phẩm")


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_product_opportunities(request):
    queryset = TrainingProductOpportunity.objects.select_related("partner", "product").all()
    return _crud_collection(request, queryset, TrainingProductOpportunitySerializer, "product opportunity")


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_product_opportunity_detail(request, pk):
    queryset = TrainingProductOpportunity.objects.select_related("partner", "product").all()
    return _crud_detail(request, queryset, TrainingProductOpportunitySerializer, pk, "product opportunity")


@api_view(["GET", "POST"])
@permission_classes([CanViewTrainingFinance])
def training_finance_entries(request):
    can_view, can_edit = _finance_permissions(request)
    if not can_view:
        return _finance_forbidden()
    if request.method == "POST" and not can_edit:
        return _finance_forbidden(edit=True)
    queryset = TrainingFinanceEntry.objects.select_related("partner").all()
    date_from = str(request.query_params.get("date_from") or "").strip()
    date_to = str(request.query_params.get("date_to") or "").strip()
    entry_type = str(request.query_params.get("entry_type") or "").strip()
    entry_status = str(request.query_params.get("status") or "").strip()
    partner = str(request.query_params.get("partner") or "").strip()
    search = str(request.query_params.get("search") or "").strip()
    if date_from:
        queryset = queryset.filter(transaction_date__gte=date_from)
    if date_to:
        queryset = queryset.filter(transaction_date__lte=date_to)
    if entry_type in {"income", "expense"}:
        queryset = queryset.filter(entry_type=entry_type)
    if entry_status in {"pending", "completed", "overdue", "cancelled"}:
        queryset = queryset.filter(status=entry_status)
    if partner.isdigit():
        queryset = queryset.filter(partner_id=int(partner))
    if search:
        from django.db.models import Q
        queryset = queryset.filter(
            Q(category__icontains=search) | Q(description__icontains=search)
            | Q(reference_code__icontains=search) | Q(partner__name__icontains=search)
        )
    if request.method == "GET":
        return Response(TrainingFinanceEntrySerializer(queryset, many=True).data)
    serializer = TrainingFinanceEntrySerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    email = getattr(request.user, "email", "")
    item = serializer.save(created_by=email, updated_by=email)
    return Response(TrainingFinanceEntrySerializer(item).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([CanViewTrainingFinance])
def training_finance_entry_detail(request, pk):
    can_view, can_edit = _finance_permissions(request)
    if not can_view:
        return _finance_forbidden()
    if request.method != "GET" and not can_edit:
        return _finance_forbidden(edit=True)
    item = TrainingFinanceEntry.objects.select_related("partner").filter(pk=pk).first()
    if not item:
        return Response({"error": "Kh\u00f4ng t\u00ecm th\u1ea5y kho\u1ea3n thu chi."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == "GET":
        return Response(TrainingFinanceEntrySerializer(item).data)
    if request.method == "DELETE":
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    serializer = TrainingFinanceEntrySerializer(item, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    updated = serializer.save(updated_by=getattr(request.user, "email", ""))
    return Response(TrainingFinanceEntrySerializer(updated).data)



@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_materials(request):
    return _crud_collection(request, TrainingMaterial.objects.select_related("session", "partner").all(), TrainingMaterialSerializer, "tài liệu")


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_material_detail(request, pk):
    return _crud_detail(request, TrainingMaterial.objects.select_related("session", "partner").all(), TrainingMaterialSerializer, pk, "tài liệu")


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_surveys(request):
    return _crud_collection(request, TrainingSurvey.objects.select_related("session", "partner").all(), TrainingSurveySerializer, "phiếu khảo sát")


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_survey_detail(request, pk):
    return _crud_detail(request, TrainingSurvey.objects.select_related("session", "partner").all(), TrainingSurveySerializer, pk, "phiếu khảo sát")


@api_view(["POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def renew_product_subscription(request, pk):
    """Gia hạn nhanh dịch vụ khách hàng: cộng thêm tháng hoặc đặt ngày hết hạn mới."""
    sub = TrainingProductSubscription.objects.select_related("partner", "product").filter(pk=pk).first()
    if not sub:
        return Response({"error": "Không tìm thấy gói đăng ký dịch vụ."}, status=status.HTTP_404_NOT_FOUND)

    months = request.data.get("months")
    new_expiry_date = request.data.get("new_expiry_date")
    notes = str(request.data.get("notes") or "").strip()

    today = timezone.localdate()
    target_date = None

    if new_expiry_date:
        try:
            target_date = datetime.date.fromisoformat(str(new_expiry_date).strip())
        except ValueError:
            return Response({"error": "Định dạng ngày hết hạn mới không hợp lệ (YYYY-MM-DD)."}, status=status.HTTP_400_BAD_REQUEST)
    elif months is not None:
        try:
            m = int(months)
            if m <= 0:
                raise ValueError()
        except ValueError:
            return Response({"error": "Số tháng gia hạn phải là số nguyên dương."}, status=status.HTTP_400_BAD_REQUEST)

        base_date = sub.expires_at if (sub.expires_at and sub.expires_at > today) else today
        month_idx = base_date.month - 1 + m
        year = base_date.year + month_idx // 12
        month = month_idx % 12 + 1
        day = min(base_date.day, calendar.monthrange(year, month)[1])
        target_date = datetime.date(year, month, day)
    else:
        return Response({"error": "Cần cung cấp số tháng gia hạn (months) hoặc ngày hết hạn mới (new_expiry_date)."}, status=status.HTTP_400_BAD_REQUEST)

    sub.expires_at = target_date
    sub.status = "active"
    sub.expiry_notice_stage = 0  # Reset cờ cảnh báo

    if notes:
        log_entry = f"[{today.strftime('%d/%m/%Y')}] Gia hạn đến {target_date.strftime('%d/%m/%Y')}: {notes}"
        sub.notes = f"{sub.notes}\n{log_entry}".strip() if sub.notes else log_entry

    sub.save(update_fields=["expires_at", "status", "expiry_notice_stage", "notes", "updated_at"])

    # Tự động trigger đồng bộ Sheet qua hàng đợi
    try:
        from .subscription_queue import enqueue_subscription
        enqueue_subscription(sub.pk, "upsert")
    except Exception as exc:
        logger.warning(f"Lỗi đưa đăng ký vào hàng đợi sau khi gia hạn: {exc}")

    return Response(TrainingProductSubscriptionSerializer(sub).data)


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def subscription_sheet_sync_now(request):
    """GET: Lấy toàn bộ cấu trúc bảng và dữ liệu từ Web để Apps Script hoặc Sheet client khởi tạo bảng.
    POST: Kích hoạt đồng bộ thủ công 2 chiều giữa Web và Google Sheet."""
    if not _is_sheet_webhook_authorized(request):
        return _forbidden()

    from .subscription_sheet_sync import sync_subscriptions_safely, build_export_payload

    if request.method == "GET":
        try:
            payload = build_export_payload()
            return Response({"success": True, "data": payload})
        except Exception as exc:
            return Response({"success": False, "error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    token = (
        request.META.get("HTTP_X_GOOGLE_OAUTH_TOKEN")
        or getattr(request, "google_access_token", None)
        or (request.data.get("googleAccessToken") if isinstance(request.data, dict) else None)
    )
    try:
        result = sync_subscriptions_safely(force=True, google_token=token)
        import_res = result.get("imported") or {}
        export_res = result.get("exported") or {}

        if import_res.get("status") == "error" or export_res.get("status") == "error":
            err_msg = export_res.get("message") or import_res.get("message") or "Lỗi đồng bộ Google Sheet."
            err_code = export_res.get("error_code") or import_res.get("error_code") or "SYNC_ERROR"
            sa_email = export_res.get("service_account_email") or import_res.get("service_account_email")
            return Response({
                "success": False,
                "error": err_msg,
                "error_code": err_code,
                "service_account_email": sa_email,
                "data": result,
            }, status=status.HTTP_400_BAD_REQUEST)

        return Response({"success": True, "data": result})
    except Exception as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["POST"])
@permission_classes([AllowAny])
def subscription_sheet_webhook(request):
    """Điểm cuối nhận webhook từ Google Apps Script (onEdit / onChange / bulk sync)."""
    if not _is_sheet_webhook_authorized(request):
        return Response(
            {"error": "Không xác thực được webhook. Yêu cầu secret hợp lệ hoặc tài khoản quản trị."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    from .subscription_sheet_sync import import_subscriptions_from_sheet, ingest_subscription_row
    data = request.data if isinstance(request.data, dict) else {}

    if data.get("test"):
        return Response({
            "success": True,
            "message": "Cổng Webhook đang hoạt động tốt (sẵn sàng nhận dữ liệu tự động từ Apps Script).",
        })

    # Kiểm tra tên tab nếu webhook gửi lên (tránh import nhầm tab khác)
    sheet_name = str(data.get("sheet_name") or "").strip()
    if sheet_name and sheet_name not in {"Dịch vụ khách hàng", "Trang tính1", "Theo dõi dịch vụ"}:
        return Response({
            "success": True,
            "message": f"Bỏ qua chỉnh sửa ở tab '{sheet_name}' (không thuộc tab Dịch vụ khách hàng).",
        })

    # Case 1: Direct row values from Apps Script onEdit
    if "values" in data and isinstance(data.get("values"), list):
        row_num = int(data.get("row") or 0)
        res = ingest_subscription_row(data["values"], row_num)
        return Response({"success": True, "result": res})

    # Case 2: Batch rows from syncAllRowsToWeb()
    if "rows" in data and isinstance(data.get("rows"), list):
        results = []
        for item in data["rows"]:
            if isinstance(item, dict) and "values" in item:
                results.append(ingest_subscription_row(item["values"], int(item.get("row") or 0)))
        return Response({"success": True, "count": len(results), "results": results[:20]})

    # Case 3: Range import trigger
    start_row = int(data.get("start_row") or 3)
    end_row = int(data.get("end_row") or 0) or None

    try:
        res = import_subscriptions_from_sheet(start_row=start_row, end_row=end_row)
        if res.get("status") == "error":
            return Response({"success": False, "error": res.get("message"), "data": res}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"success": True, "result": res})
    except Exception as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def subscription_sheet_config_view(request):
    """Lấy hoặc lưu cấu hình Google Sheet cho Theo dõi hạn dùng BNDC."""
    from authentication.models import SystemConfig
    from integrations.google_sheets import extract_spreadsheet_id, build_sheets_service
    from .subscription_sheet_sync import (
        SYNC_CONFIG_KEY, get_spreadsheet_id, get_sync_credentials, DEFAULT_SPREADSHEET_ID
    )

    config_obj, _ = SystemConfig.objects.get_or_create(key=SYNC_CONFIG_KEY)
    config_data = dict(config_obj.data or {})
    webhook_secret = _get_or_create_subscription_webhook_secret()
    config_data.setdefault("webhookSecret", webhook_secret)

    if request.method == "POST":
        spreadsheet_input = str(request.data.get("spreadsheetId") or "").strip()
        cleaned_id = extract_spreadsheet_id(spreadsheet_input) or spreadsheet_input
        if cleaned_id:
            config_data["spreadsheetId"] = cleaned_id

        if "googleServiceAccountJson" in request.data:
            raw_sa = str(request.data.get("googleServiceAccountJson") or "").strip()
            config_data["googleServiceAccountJson"] = raw_sa

        if "tabTitle" in request.data:
            config_data["tabTitle"] = str(request.data.get("tabTitle") or "").strip()

        if "webhookSecret" in request.data:
            raw_secret = str(request.data.get("webhookSecret") or "").strip()
            if raw_secret:
                config_data["webhookSecret"] = raw_secret
                webhook_secret = raw_secret

        config_data["updatedAt"] = timezone.now().isoformat()
        config_obj.data = config_data
        config_obj.save(update_fields=["data"])

        # Test connection immediately
        token, final_cfg, sa_email = get_sync_credentials()
        test_result = {"connected": False, "message": ""}
        target_id = extract_spreadsheet_id(config_data.get("spreadsheetId") or "") or DEFAULT_SPREADSHEET_ID
        try:
            service = build_sheets_service(token, final_cfg)
            meta = service.spreadsheets().get(
                spreadsheetId=target_id,
                fields="properties.title,sheets.properties.title"
            ).execute()
            sheet_title = meta.get("properties", {}).get("title", "")
            tabs = [s.get("properties", {}).get("title") for s in meta.get("sheets", [])]
            test_result = {
                "connected": True,
                "sheetTitle": sheet_title,
                "tabs": tabs,
                "message": f"Kết nối Google Sheet thành công: “{sheet_title}” ({len(tabs)} tabs).",
            }
        except Exception as exc:
            err_msg = str(exc)
            if "403" in err_msg or "permission" in err_msg.lower():
                test_result["message"] = f"Tài khoản dịch vụ chưa có quyền truy cập Sheet. Vui lòng nhấn nút Share trên Sheet và thêm email: {sa_email or 'tài khoản dịch vụ'} (quyền Editor)."
            elif "404" in err_msg or "not found" in err_msg.lower():
                test_result["message"] = f"Không tìm thấy Google Sheet với ID '{target_id}'."
            else:
                test_result["message"] = f"Chưa thể kết nối: {exc}"

        return Response({
            "success": True,
            "config": {
                "spreadsheetId": config_data.get("spreadsheetId") or DEFAULT_SPREADSHEET_ID,
                "spreadsheetUrl": f"https://docs.google.com/spreadsheets/d/{config_data.get('spreadsheetId') or DEFAULT_SPREADSHEET_ID}/edit",
                "hasServiceAccount": bool(config_data.get("googleServiceAccountJson") or final_cfg.get("googleServiceAccountJson")),
                "serviceAccountEmail": sa_email,
                "tabTitle": config_data.get("tabTitle") or "Trang tính1",
                "webhookSecret": webhook_secret,
            },
            "test": test_result,
        })

    # GET
    token, final_cfg, sa_email = get_sync_credentials()
    current_id = extract_spreadsheet_id(config_data.get("spreadsheetId") or "") or DEFAULT_SPREADSHEET_ID
    can_read_secret = IsAuthenticated().has_permission(request, None) or _can_manage(request)
    return Response({
        "spreadsheetId": current_id,
        "spreadsheetUrl": f"https://docs.google.com/spreadsheets/d/{current_id}/edit",
        "hasServiceAccount": bool(config_data.get("googleServiceAccountJson") or final_cfg.get("googleServiceAccountJson")),
        "serviceAccountEmail": sa_email,
        "tabTitle": config_data.get("tabTitle") or "Trang tính1",
        "webhookUrl": "/api/digital-training/subscriptions/sheet-webhook",
        "webhookSecret": webhook_secret if can_read_secret else "",
        "updatedAt": config_data.get("updatedAt"),
    })


@api_view(["POST"])
@permission_classes([IsAuthenticatedOrReadOnly])
def training_sessions_sheet_sync_now(request):
    """Kích hoạt đồng bộ thủ công 2 chiều Tab Nhật ký tập huấn giữa Web và Google Sheet."""
    from .training_sheet_sync import sync_training_sessions_safely
    try:
        result = sync_training_sessions_safely(force=True)
        return Response({"success": True, "data": result})
    except Exception as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["POST"])
@permission_classes([AllowAny])
def training_sessions_sheet_webhook(request):
    """Điểm cuối nhận webhook cho Tab Nhật ký tập huấn từ Apps Script."""
    from .training_sheet_sync import import_training_sessions_from_sheet
    data = request.data if isinstance(request.data, dict) else {}
    start_row = int(data.get("start_row") or 3)
    end_row = int(data.get("end_row") or 0) or None

    try:
        res = import_training_sessions_from_sheet(start_row=start_row, end_row=end_row)
        return Response({"success": True, "result": res})
    except Exception as exc:
        return Response({"success": False, "error": str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def training_partner_ai_accounts(request):
    """Lấy danh sách hoặc tạo mới tài khoản AI dùng chung cho khách hàng."""
    queryset = TrainingPartnerAiAccount.objects.select_related("partner", "subscription").all()
    partner_id = request.query_params.get("partner")
    status_param = request.query_params.get("status")
    platform = request.query_params.get("platform")
    search = str(request.query_params.get("search") or "").strip()

    if partner_id and str(partner_id).isdigit():
        queryset = queryset.filter(partner_id=int(partner_id))
    if status_param and status_param != "all":
        queryset = queryset.filter(status=status_param)
    if platform and platform != "all":
        queryset = queryset.filter(platform=platform)
    if search:
        queryset = queryset.filter(
            Q(account_username__icontains=search)
            | Q(assigned_to__icontains=search)
            | Q(partner__name__icontains=search)
            | Q(notes__icontains=search)
        )

    if request.method == "GET":
        return Response(TrainingPartnerAiAccountSerializer(queryset, many=True).data)

    serializer = TrainingPartnerAiAccountSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    item = serializer.save()
    item.partner.refresh_ai_account_count()
    return Response(TrainingPartnerAiAccountSerializer(item).data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "PUT", "DELETE"])
@permission_classes([IsAuthenticated])
def training_partner_ai_account_detail(request, pk):
    """Xem, cập nhật (đổi mật khẩu, ngày hết hạn, trạng thái) hoặc xóa tài khoản AI."""
    item = TrainingPartnerAiAccount.objects.select_related("partner", "subscription").filter(pk=pk).first()
    if not item:
        return Response({"error": "Không tìm thấy tài khoản AI."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        return Response(TrainingPartnerAiAccountSerializer(item).data)

    if request.method in ("PATCH", "PUT"):
        previous_partner = item.partner
        serializer = TrainingPartnerAiAccountSerializer(item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        updated = serializer.save()
        updated.partner.refresh_ai_account_count()
        if previous_partner.pk != updated.partner_id:
            # Tài khoản được chuyển sang trường khác: trường cũ cũng phải đếm lại.
            previous_partner.refresh_ai_account_count()
        return Response(TrainingPartnerAiAccountSerializer(updated).data)

    # DELETE
    partner = item.partner
    item.delete()
    partner.refresh_ai_account_count()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def training_partner_ai_accounts_bulk(request):
    """Tạo nhiều tài khoản AI cùng lúc cho một hoặc nhiều khách hàng."""
    accounts_data = request.data.get("accounts", [])
    if not isinstance(accounts_data, list) or not accounts_data:
        return Response({"error": "Danh sách tài khoản 'accounts' không hợp lệ."}, status=status.HTTP_400_BAD_REQUEST)

    created_items = []
    touched_partners = set()
    for acc in accounts_data:
        serializer = TrainingPartnerAiAccountSerializer(data=acc)
        if serializer.is_valid():
            saved = serializer.save()
            created_items.append(saved)
            touched_partners.add(saved.partner)

    for p in touched_partners:
        p.refresh_ai_account_count()

    return Response(
        {
            "success": True,
            "created_count": len(created_items),
            "accounts": TrainingPartnerAiAccountSerializer(created_items, many=True).data,
        },
        status=status.HTTP_201_CREATED,
    )


