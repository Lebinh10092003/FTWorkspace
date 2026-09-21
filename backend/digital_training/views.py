from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from authentication.permissions import IsAuthenticatedOrReadOnly
from rest_framework.response import Response
from rest_framework.permissions import BasePermission
import json
import uuid
import unicodedata
from django.conf import settings
from django.utils import timezone

from authentication.permissions import IsAuthenticated, IsManagerOrAdmin
from authentication.models import UserProfile
from examination.models import LogNote
from .completion_service import complete_past_training_schedules
from .product_service import sync_partner_product_subscriptions
from .models import TrainingClass, TrainingCustomerMeeting, TrainingFinanceEntry, TrainingLead, TrainingMaterial, TrainingPartner, TrainingProduct, TrainingProductOpportunity, TrainingProductSubscription, TrainingSession, TrainingSurvey
from .serializers import TrainingClassSerializer, TrainingCustomerMeetingSerializer, TrainingFinanceEntrySerializer, TrainingLeadSerializer, TrainingMaterialSerializer, TrainingPartnerSerializer, TrainingProductOpportunitySerializer, TrainingProductSerializer, TrainingProductSubscriptionSerializer, TrainingSessionSerializer, TrainingSurveySerializer
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
        return Response(status=status.HTTP_204_NO_CONTENT)
    before = _snapshot(serializer_class, item, request)
    serializer = serializer_class(item, data=request.data, partial=True, context={"request": request})
    serializer.is_valid(raise_exception=True)
    updated = serializer.save()
    _sync_session_to_work_schedule(updated, kind, request)
    if isinstance(updated, TrainingSession):
        notify_training_session_updated(before, _snapshot(serializer_class, updated, request))
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
