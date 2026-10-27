"""Tra cứu dùng chung cho các công cụ MCP."""
from __future__ import annotations

from typing import Optional, Tuple

from digital_training.models import TrainingPartner


def find_partner(partner_id: Optional[int] = None, partner_name: str = "") -> Tuple[Optional[TrainingPartner], str]:
    """Tìm đúng một khách hàng. Tên gần đúng mà khớp nhiều đơn vị thì báo lỗi, không đoán."""
    if partner_id:
        partner = TrainingPartner.objects.filter(pk=partner_id).first()
        return partner, "" if partner else f"Không có khách hàng ID {partner_id}."
    name = str(partner_name or "").strip()
    if not name:
        return None, "Cần partner_id hoặc partner_name."
    exact = TrainingPartner.objects.filter(name__iexact=name).first()
    if exact:
        return exact, ""
    matches = list(TrainingPartner.objects.filter(name__icontains=name).order_by("name")[:6])
    if len(matches) == 1:
        return matches[0], ""
    if not matches:
        return None, f"Không tìm thấy khách hàng khớp '{name}'."
    names = "; ".join(f"{p.name} (ID {p.id})" for p in matches[:5])
    return None, f"Có nhiều khách hàng khớp '{name}': {names}. Hãy dùng partner_id."
