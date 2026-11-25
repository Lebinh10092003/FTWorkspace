"""Số đăng ký mới theo ngày (yêu cầu 25/11/2026: thẻ Tổng quan và Danh sách thí sinh).

Ngày đăng ký của một lượt tham gia là ngày sớm hơn giữa:
- ``formSubmittedAt``: thời điểm gửi Google Form (ô "Dấu thời gian"), vì một
  dòng Form có thể được nhập vào web muộn (ví dụ lượt gửi lại toàn bộ);
- ``registeredAt``: thời điểm đăng ký ghi trên hồ sơ (trang đăng ký, Excel trường…);
không có cả hai thì lấy thời điểm tạo lượt tham gia (nhập tay trên web).

Không tính dữ liệu lịch sử (``historicalImport``) và lượt "Đổi cuộc thi" (đã
tính ở cuộc thi cũ).
"""
import datetime

from django.utils import timezone
from django.utils.dateparse import parse_datetime

from .models import CandidateParticipation


def _local_day(value):
    if isinstance(value, str):
        value = parse_datetime(value.strip()) if value.strip() else None
    if not value:
        return None
    if timezone.is_naive(value):
        value = timezone.make_aware(value)
    return timezone.localtime(value).date()


def registration_day(participation_data, created_at):
    """Ngày sớm nhất giữa giờ gửi Form và giờ đăng ký; không có cả hai thì ngày tạo.

    Dòng Form nhập muộn có registeredAt = lúc nhập, nên lấy giờ gửi Form; hồ sơ
    đăng ký trên web rồi gửi thêm Form về sau vẫn tính theo lần đăng ký đầu.
    """
    data = participation_data or {}
    days = [day for day in (_local_day(data.get('formSubmittedAt')), _local_day(data.get('registeredAt'))) if day]
    return min(days) if days else _local_day(created_at)


def daily_registration_stats(today=None):
    """{date, today: {...}, yesterday: {...}}; mỗi ngày có total, bySession, newCandidates."""
    today = today or timezone.localdate()
    yesterday = today - datetime.timedelta(days=1)
    days = {today: {'total': 0, 'bySession': {}, 'newCandidates': 0},
            yesterday: {'total': 0, 'bySession': {}, 'newCandidates': 0}}
    first_day, returning = {}, set()
    rows = CandidateParticipation.objects.values_list('candidate_id', 'session_id', 'registration_data', 'created_at', 'source')
    for candidate_id, session_id, data, created_at, source in rows:
        if (data or {}).get('historicalImport') is True:
            # Có dữ liệu các năm trước: mã FT cũ, không bao giờ là thí sinh mới.
            returning.add(candidate_id)
            continue
        if str(source or '').startswith('Đổi từ '):
            continue  # đã tính ở cuộc thi cũ
        day = registration_day(data, created_at)
        if not day:
            continue
        if candidate_id not in first_day or day < first_day[candidate_id]:
            first_day[candidate_id] = day
        if day in days:
            bucket = days[day]
            bucket['total'] += 1
            bucket['bySession'][session_id] = bucket['bySession'].get(session_id, 0) + 1
    for candidate_id, day in first_day.items():
        if day in days and candidate_id not in returning:
            days[day]['newCandidates'] += 1
    return {'date': today.isoformat(), 'today': days[today], 'yesterday': days[yesterday]}
