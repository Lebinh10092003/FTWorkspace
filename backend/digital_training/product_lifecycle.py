from datetime import timedelta

from django.db.models import Q
from django.db.models.functions import Coalesce
from django.utils import timezone

from authentication.notifications import notify_workspace

from .models import TrainingProductSubscription


EXPIRING_NOTICE_DAYS = 30


def emit_product_subscription_expiry_notice(subscription, today=None):
    today = today or timezone.localdate()
    expires_at = subscription.effective_expires_at
    if subscription.status != "active" or subscription.product.code == "tap-huan" or not expires_at:
        return None
    days = (expires_at - today).days
    if days > EXPIRING_NOTICE_DAYS:
        return None
    expired = days < 0
    stage = 2 if expired else 1
    if subscription.expiry_notice_stage >= stage:
        return None
    if expired:
        title = "Sản phẩm đã hết hạn"
        message = (
            f"“{subscription.product.name}” của khách hàng {subscription.partner.name} "
            f"đã hết hạn ngày {expires_at.strftime('%d/%m/%Y')} "
            f"(quá hạn {abs(days)} ngày). Vui lòng kiểm tra và cập nhật."
        )
        severity = "urgent"
        result_key = "expired"
    else:
        title = "Sản phẩm sắp hết hạn"
        message = (
            f"“{subscription.product.name}” của khách hàng {subscription.partner.name} "
            f"sẽ hết hạn ngày {expires_at.strftime('%d/%m/%Y')} "
            f"(còn {days} ngày). Vui lòng theo dõi gia hạn."
        )
        severity = "warning"
        result_key = "expiring"
    notify_workspace(
        event_key=f"product-subscription:{subscription.pk}:{expires_at.isoformat()}:{stage}",
        title=title,
        message=message,
        severity=severity,
        category="digital-training",
        target_modules=["digital-training", "finance-report"],
        action_url=f"/digital-training/partners/{subscription.partner_id}",
    )
    subscription.expiry_notice_stage = stage
    subscription.save(update_fields=["expiry_notice_stage", "updated_at"])
    return result_key


def run_product_subscription_lifecycle(today=None):
    """Notify only subscriptions that have reached a new expiry stage."""
    today = today or timezone.localdate()
    due = TrainingProductSubscription.objects.select_related("partner", "product").filter(
        status="active",
    ).exclude(product__code="tap-huan").annotate(
        effective_expiry=Coalesce("expires_at", "contract_expires_at"),
    ).filter(
        Q(effective_expiry__lt=today, expiry_notice_stage__lt=2)
        | Q(
            effective_expiry__gte=today,
            effective_expiry__lte=today + timedelta(days=EXPIRING_NOTICE_DAYS),
            expiry_notice_stage__lt=1,
        )
    )
    result = {"expiring": 0, "expired": 0}
    for subscription in due.iterator():
        result_key = emit_product_subscription_expiry_notice(subscription, today)
        if result_key:
            result[result_key] += 1
    return result
