from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework import status
from django.conf import settings
from django.http import HttpResponse
from io import BytesIO
import os
import subprocess
import sys
import uuid
from django.utils import timezone
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
import datetime
from .models import ApiLog, Channel, ChannelMetricSnapshot, Post, DailySnapshot, FollowerSnapshot
from authentication.permissions import IsAuthenticated, IsAuthenticatedOrReadOnly, IsManagerOrAdmin
from .sync import SyncEngine

def get_today_date():
    return timezone.localdate().isoformat()

def get_recent_start_date(days):
    return (timezone.now() - datetime.timedelta(days=days)).strftime('%Y-%m-%d')

def resolve_reporting_period(query):
    start_date = query.get('startDate')
    end_date = query.get('endDate')
    
    if start_date and end_date:
        return start_date, end_date
    return get_recent_start_date(6), get_today_date()

@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticatedOrReadOnly])
def channels_list(request):
    if request.method == 'GET':
        channels = Channel.objects.exclude(external_id='current-facebook-token').order_by('name')
        
        # Calculate post count for each channel
        post_counts = {}
        for post in Post.objects.all():
            post_counts[post.channel_id] = post_counts.get(post.channel_id, 0) + 1
            
        result = []
        for c in channels:
            result.append({
                "id": c.id,
                "platform": c.platform,
                "name": c.name,
                "externalId": c.external_id,
                "status": c.status,
                "timezone": c.timezone,
                "createdAt": c.created_at.isoformat(),
                "updatedAt": c.updated_at.isoformat(),
                "lastSyncAt": c.last_sync_at.isoformat() if c.last_sync_at else None,
                "lastDataSyncUntil": c.last_data_sync_until.isoformat() if c.last_data_sync_until else None,
                "lastSyncStatus": c.last_sync_status,
                "initialSyncCompletedAt": c.initial_sync_completed_at.isoformat() if c.initial_sync_completed_at else None,
                "followersCount": c.followers_count,
                "totalPosts": post_counts.get(c.id, 0)
            })
        return Response(result)
        
    elif request.method == 'POST':
        # Add new channel
        if getattr(request, 'user_role', 'EMPLOYEE') not in ['ADMIN', 'MANAGER']:
            return Response({"error": "Quyền truy cập bị từ chối."}, status=status.HTTP_403_FORBIDDEN)
            
        data = request.data or {}
        channel_id = data.get('id')
        platform = data.get('platform')
        name = data.get('name')
        external_id = data.get('externalId') or data.get('external_id')
        
        if not channel_id or not platform or not name or not external_id:
            return Response({"error": "Thiếu thông tin kênh."}, status=status.HTTP_400_BAD_REQUEST)
            
        channel, created = Channel.objects.update_or_create(
            id=channel_id,
            defaults={
                'platform': platform,
                'name': name,
                'external_id': external_id,
                'status': data.get('status', 'active'),
                'timezone': data.get('timezone', 'Asia/Bangkok'),
                'created_at': timezone.now(),
                'updated_at': timezone.now()
            }
        )
        return Response({
            "id": channel.id,
            "name": channel.name,
            "platform": channel.platform,
            "externalId": channel.external_id
        })

@api_view(['PUT', 'DELETE'])
@permission_classes([IsManagerOrAdmin])
def channel_detail(request, channel_id):
    try:
        channel = Channel.objects.get(id=channel_id)
    except Channel.DoesNotExist:
        return Response({"error": "Không tìm thấy kênh."}, status=status.HTTP_404_NOT_FOUND)
        
    if request.method == 'PUT':
        data = request.data or {}
        if 'name' in data:
            channel.name = data['name']
        if 'externalId' in data or 'external_id' in data:
            channel.external_id = data.get('externalId') or data.get('external_id')
        if 'status' in data:
            channel.status = data['status']
        if 'timezone' in data:
            channel.timezone = data['timezone']
            
        channel.updated_at = timezone.now()
        channel.save()
        return Response({
            "id": channel.id,
            "name": channel.name,
            "platform": channel.platform,
            "externalId": channel.external_id
        })
        
    elif request.method == 'DELETE':
        # Delete channel and associated posts and snapshots
        channel.delete()
        Post.objects.filter(channel_id=channel_id).delete()
        DailySnapshot.objects.filter(channel_id=channel_id).delete()
        FollowerSnapshot.objects.filter(channel_id=channel_id).delete()
        return Response({"success": True, "id": channel_id})

@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def channel_test_connection(request, channel_id):
    try:
        channel = Channel.objects.get(id=channel_id)
        provider = SyncEngine.get_provider(channel.platform)
        valid = provider.validate_credentials(channel.id, channel.external_id)
        return Response({"success": valid})
    except Exception as e:
        from .providers import FacebookRateLimitDeferred
        if isinstance(e, FacebookRateLimitDeferred):
            return Response({"error": str(e), "deferred": True}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def channel_sync(request, channel_id):
    channel = Channel.objects.filter(id=channel_id).first()
    if not channel:
        return Response({"error": "Không tìm thấy kênh."}, status=status.HTTP_404_NOT_FOUND)

    since = request.data.get("since")
    until = request.data.get("until")
    # A newly added channel always receives the full initial history window.
    if channel.initial_sync_completed_at is None:
        since = None
        until = None

    active_request_id = _active_background_request()
    if active_request_id:
        return Response({
            "success": True,
            "queued": False,
            "alreadyRunning": True,
            "requestId": active_request_id,
            "message": "Đang có một lượt đồng bộ chạy. Hệ thống không mở tiến trình Facebook thứ hai để tránh tăng đột biến lượng API call.",
        }, status=status.HTTP_202_ACCEPTED)

    request_id = _start_background_sync(
        recent_days=1,
        history_days=396,
        channel_ids=[channel_id],
        since=since,
        until=until,
    )
    return Response({
        "success": True,
        "queued": True,
        "requestId": request_id,
        "message": "Đã xếp hàng đồng bộ nền cho kênh đã chọn.",
    }, status=status.HTTP_202_ACCEPTED)
@api_view(['GET'])
@permission_classes([IsAuthenticatedOrReadOnly])
def media_summary_trend(request):
    group_by = request.query_params.get('groupBy', 'month')
    platform_filter = request.query_params.get('platform')
    channel_id_filter = request.query_params.get('channelId')
    if platform_filter == 'all':
        platform_filter = None
    if channel_id_filter == 'all':
        channel_id_filter = None

    channels = Channel.objects.filter(status='active').exclude(external_id='current-facebook-token')
    if platform_filter:
        channels = channels.filter(platform=platform_filter)
    if channel_id_filter:
        channels = channels.filter(id=channel_id_filter)
    channel_ids = list(channels.values_list('id', flat=True))

    now = timezone.now()
    today = timezone.localdate().isoformat()
    buckets = []
    if group_by == 'month':
        for i in range(12, -1, -1):
            year, month = now.year, now.month - i
            while month <= 0:
                month += 12
                year -= 1
            start = f"{year}-{month:02d}-01"
            end = f"{year}-12-31" if month == 12 else (datetime.date(year, month + 1, 1) - datetime.timedelta(days=1)).isoformat()
            buckets.append({'key': f"{year}-{month:02d}", 'label': f"T{month}/{year}", 'start': start, 'end': end})
    elif group_by == 'quarter':
        for i in range(7, -1, -1):
            quarter_offset, year = ((now.month - 1) // 3) - i, now.year
            while quarter_offset < 0:
                quarter_offset += 4
                year -= 1
            quarter = quarter_offset + 1
            start_month = quarter_offset * 3 + 1
            end_month = start_month + 2
            start = f"{year}-{start_month:02d}-01"
            end = f"{year}-12-31" if end_month == 12 else (datetime.date(year, end_month + 1, 1) - datetime.timedelta(days=1)).isoformat()
            buckets.append({'key': f"{year}-Q{quarter}", 'label': f"Q{quarter}/{year}", 'start': start, 'end': end})
    else:
        for i in range(4, -1, -1):
            year = now.year - i
            buckets.append({'key': str(year), 'label': str(year), 'start': f"{year}-01-01", 'end': f"{year}-12-31"})

    period_end = min(buckets[-1]['end'], today)
    posts = list(Post.objects.filter(channel_id__in=channel_ids, published_at__lte=f"{period_end}T23:59:59.999Z"))
    compact_metrics = list(ChannelMetricSnapshot.objects.filter(
        channel_id__in=channel_ids,
        snapshot_date__gte=buckets[0]['start'],
        snapshot_date__lte=period_end,
    ).order_by('snapshot_date'))
    follower_by_channel = {}
    for snapshot in FollowerSnapshot.objects.filter(channel_id__in=channel_ids, snapshot_date__lte=period_end).order_by('channel_id', 'snapshot_date'):
        follower_by_channel.setdefault(snapshot.channel_id, []).append(snapshot)

    def latest_snapshot(snapshots, boundary, inclusive=True):
        result = None
        for snapshot in snapshots:
            if snapshot.snapshot_date < boundary or (inclusive and snapshot.snapshot_date <= boundary):
                result = snapshot
            else:
                break
        return result

    trend = []
    for bucket in buckets:
        start, end = bucket['start'], min(bucket['end'], today)
        period_posts = [post for post in posts if start <= str(post.published_at)[:10] <= end]
        period_metrics = [snapshot for snapshot in compact_metrics if start <= snapshot.snapshot_date <= end]
        start_values = {'views': 0, 'engagement': 0, 'postsCount': 0, 'followers': 0}
        end_values = {
            'views': sum(snapshot.views for snapshot in period_metrics),
            'engagement': sum(snapshot.engagement for snapshot in period_metrics),
            'postsCount': len(period_posts),
            'followers': 0,
        }

        for channel_id in channel_ids:
            snapshots = follower_by_channel.get(channel_id, [])
            start_snapshot = latest_snapshot(snapshots, start, inclusive=False)
            end_snapshot = latest_snapshot(snapshots, end)
            start_values['followers'] += getattr(start_snapshot, 'followers_count', 0) or 0
            end_values['followers'] += getattr(end_snapshot, 'followers_count', 0) or 0

        trend.append({
            'period': bucket['key'],
            'label': bucket['label'],
            'views': end_values['views'],
            'engagement': end_values['engagement'],
            'postsCount': len(period_posts),
            'followers': end_values['followers'] - start_values['followers'],
            'startValues': start_values,
            'endValues': end_values,
            'metricSource': 'daily_insights' if period_metrics else 'unavailable',
        })

    response = Response({'groupBy': group_by, 'trend': trend})
    response['Cache-Control'] = 'no-store, no-cache, must-revalidate'
    return response
def _build_media_summary(query):
    period_start, period_end = resolve_reporting_period(query)
    platform_filter = query.get('platform')
    channel_id_filter = query.get('channelId')

    if platform_filter == 'all':
        platform_filter = None
    if channel_id_filter == 'all':
        channel_id_filter = None

    channels = Channel.objects.filter(status='active')
    if platform_filter:
        channels = channels.filter(platform=platform_filter)
    if channel_id_filter:
        channels = channels.filter(id=channel_id_filter)

    channel_ids = [channel.id for channel in channels]
    period_start_dt = SyncEngine._parse_boundary(period_start)
    period_end_dt = SyncEngine._parse_boundary(period_end, end_of_day=True)
    posts = Post.objects.filter(
        channel_id__in=channel_ids,
        published_at__gte=period_start_dt,
        published_at__lte=period_end_dt,
    )
    snapshots = DailySnapshot.objects.filter(post_key__in=[post.post_key for post in posts])

    latest_snapshots = {}
    for snapshot in snapshots:
        existing = latest_snapshots.get(snapshot.post_key)
        if not existing or snapshot.snapshot_date > existing.snapshot_date:
            latest_snapshots[snapshot.post_key] = snapshot

    result = []
    for channel in channels:
        channel_posts = [post for post in posts if post.channel_id == channel.id]
        reactions = comments = shares = clicks = views = reach = impressions = 0

        for post in channel_posts:
            snapshot = latest_snapshots.get(post.post_key)
            if not snapshot:
                continue
            reactions += snapshot.reactions
            comments += snapshot.comments
            shares += snapshot.shares
            clicks += snapshot.clicks
            views += snapshot.views or snapshot.impressions or snapshot.reach or 0
            reach += snapshot.reach
            impressions += snapshot.impressions

        total_engagement = reactions + comments + shares + clicks
        engagement_rate = None
        if reach > 0:
            engagement_rate = round((total_engagement / reach) * 100, 2)
        elif impressions > 0:
            engagement_rate = round((total_engagement / impressions) * 100, 2)

        result.append({
            'id': channel.id,
            'channelId': channel.id,
            'name': channel.name,
            'channelName': channel.name,
            'externalId': channel.external_id,
            'platform': channel.platform,
            'lastSyncAt': channel.last_sync_at.isoformat() if channel.last_sync_at else None,
            'lastSyncStatus': channel.last_sync_status,
            'postsCount': len(channel_posts),
            'followersCount': channel.followers_count,
            'views': views,
            'reactions': reactions,
            'comments': comments,
            'shares': shares,
            'clicks': clicks,
            'totalEngagement': total_engagement,
            'engagementRate': engagement_rate,
        })

    return result


@api_view(['GET'])
@permission_classes([IsAuthenticatedOrReadOnly])
def media_summary(request):
    response = Response(_build_media_summary(request.query_params))
    response['Cache-Control'] = 'no-store, no-cache, must-revalidate'
    return response


def _safe_excel_value(value):
    if isinstance(value, str) and value.startswith(('=', '+', '-', '@')):
        return "'" + value
    return value


@api_view(['GET'])
@permission_classes([IsAuthenticatedOrReadOnly])
def media_summary_xlsx(request):
    rows = _build_media_summary(request.query_params)
    period_start, period_end = resolve_reporting_period(request.query_params)

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = 'Bao cao tong hop'
    sheet.append(['BÁO CÁO TỔNG HỢP TRUYỀN THÔNG'])
    sheet.append(['Thời gian', period_start + ' - ' + period_end])
    sheet.append([])

    headers = [
        'STT',
        'Nền tảng',
        'Tên trang',
        'ID trang',
        'Đồng bộ lần cuối',
        'Người theo dõi',
        'Số bài đăng',
        'Lượt xem',
        'Cảm xúc',
        'Bình luận',
        'Chia sẻ',
        'Lượt nhấp',
        'Tổng tương tác',
        'Tỷ lệ tương tác (%)',
    ]
    sheet.append(headers)

    for index, row in enumerate(rows, start=1):
        platform_name = 'Facebook' if row['platform'] == 'facebook' else 'Zalo OA'
        sheet.append([
            index,
            platform_name,
            _safe_excel_value(row['name']),
            _safe_excel_value(row['externalId']),
            row['lastSyncAt'] or '',
            row['followersCount'],
            row['postsCount'],
            row['views'],
            row['reactions'],
            row['comments'],
            row['shares'],
            row['clicks'],
            row['totalEngagement'],
            row['engagementRate'] if row['engagementRate'] is not None else '',
        ])

    title_fill = PatternFill('solid', fgColor='17365D')
    header_fill = PatternFill('solid', fgColor='2563EB')
    sheet['A1'].fill = title_fill
    sheet['A1'].font = Font(color='FFFFFF', bold=True, size=14)
    sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(headers))

    for cell in sheet[4]:
        cell.fill = header_fill
        cell.font = Font(color='FFFFFF', bold=True)
        cell.alignment = Alignment(horizontal='center', vertical='center')

    sheet.freeze_panes = 'A5'
    sheet.auto_filter.ref = f"A4:N{max(4, sheet.max_row)}"
    widths = [7, 14, 34, 24, 23, 18, 16, 16, 14, 14, 14, 14, 20, 24]
    for column, width in enumerate(widths, start=1):
        sheet.column_dimensions[chr(64 + column)].width = width

    output = BytesIO()
    workbook.save(output)
    response = HttpResponse(
        output.getvalue(),
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    response['Content-Disposition'] = (
        f'attachment; filename="bao_cao_tong_hop_{get_today_date()}.xlsx"'
    )
    return response

@api_view(['GET'])
@permission_classes([IsAuthenticatedOrReadOnly])
def followers_trend(request):
    try:
        if request.query_params.get('startDate') and request.query_params.get('endDate'):
            period_start, period_end = resolve_reporting_period(request.query_params)
        else:
            raw_days = int(request.query_params.get('days', 7))
            if not (1 <= raw_days <= 365):
                raise ValueError
            period_start = get_recent_start_date(raw_days - 1)
            period_end = get_today_date()
        start_day = datetime.date.fromisoformat(period_start)
        end_day = datetime.date.fromisoformat(period_end)
        if start_day > end_day or (end_day - start_day).days > 365:
            raise ValueError
    except (TypeError, ValueError):
        return Response(
            {"error": "Kho\u1ea3ng th\u1eddi gian ph\u1ea3i h\u1ee3p l\u1ec7 v\u00e0 kh\u00f4ng v\u01b0\u1ee3t qu\u00e1 1 n\u0103m."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    channel_id_filter = request.query_params.get('channelId')
    platform_filter = request.query_params.get('platform')
    if channel_id_filter == 'all':
        channel_id_filter = None
    if platform_filter == 'all':
        platform_filter = None

    channels = Channel.objects.filter(status='active').exclude(external_id='current-facebook-token')
    if platform_filter:
        channels = channels.filter(platform=platform_filter)
    if channel_id_filter:
        channels = channels.filter(id=channel_id_filter)
    channel_ids = list(channels.values_list('id', flat=True))
    channel_names = {channel.id: channel.name for channel in channels}

    histories = {channel_id: [] for channel_id in channel_ids}
    snapshots_by_day = {channel_id: {} for channel_id in channel_ids}
    snapshots = FollowerSnapshot.objects.filter(
        channel_id__in=channel_ids,
        snapshot_date__lte=period_end,
    ).order_by('snapshot_date')
    for snapshot in snapshots:
        histories.setdefault(snapshot.channel_id, []).append(snapshot)
        snapshots_by_day.setdefault(snapshot.channel_id, {})[snapshot.snapshot_date] = snapshot

    cursors = {channel_id: 0 for channel_id in channel_ids}
    latest_counts = {}
    trend = []
    current_day = start_day
    while current_day <= end_day:
        date_string = current_day.isoformat()
        daily_follows = []
        daily_unfollows = []
        daily_follows_by_channel = {}
        daily_unfollows_by_channel = {}
        for channel_id in channel_ids:
            history = histories.get(channel_id, [])
            cursor = cursors[channel_id]
            while cursor < len(history) and history[cursor].snapshot_date <= date_string:
                latest_counts[channel_id] = history[cursor].followers_count
                cursor += 1
            cursors[channel_id] = cursor

            daily_snapshot = snapshots_by_day.get(channel_id, {}).get(date_string)
            if daily_snapshot and daily_snapshot.daily_follows_unique is not None:
                daily_follows.append(daily_snapshot.daily_follows_unique)
                daily_follows_by_channel[channel_id] = daily_snapshot.daily_follows_unique
            if daily_snapshot and daily_snapshot.daily_unfollows_unique is not None:
                daily_unfollows.append(daily_snapshot.daily_unfollows_unique)
                daily_unfollows_by_channel[channel_id] = daily_snapshot.daily_unfollows_unique

        point = {
            'date': date_string,
            'followersCount': sum(latest_counts.get(channel_id, 0) for channel_id in channel_ids),
            'dailyFollowsUnique': sum(daily_follows) if daily_follows else None,
            'dailyUnfollowsUnique': sum(daily_unfollows) if daily_unfollows else None,
        }
        for channel_id in channel_ids:
            channel_name = channel_names.get(channel_id, channel_id)
            point[f'{channel_name}_followers'] = latest_counts.get(channel_id, 0)
            point[f'{channel_name}_dailyFollowsUnique'] = daily_follows_by_channel.get(channel_id)
            point[f'{channel_name}_dailyUnfollowsUnique'] = daily_unfollows_by_channel.get(channel_id)
        trend.append(point)
        current_day += datetime.timedelta(days=1)

    return Response(trend)

@api_view(['GET'])
@permission_classes([IsAuthenticatedOrReadOnly])
def dashboard_view(request):
    platform_filter = request.query_params.get('platform')
    channel_id_filter = request.query_params.get('channelId')
    post_type_filter = request.query_params.get('postType')
    start_date = request.query_params.get('startDate')
    end_date = request.query_params.get('endDate')
    
    if platform_filter == 'all':
        platform_filter = None
    if channel_id_filter == 'all':
        channel_id_filter = None
    if post_type_filter == 'all':
        post_type_filter = None
        
    period_start, period_end = resolve_reporting_period({'startDate': start_date, 'endDate': end_date})
    
    # 1. Fetch active channels
    channels = Channel.objects.filter(status='active').exclude(external_id='current-facebook-token')
    if platform_filter:
        channels = channels.filter(platform=platform_filter)
    if channel_id_filter:
        channels = channels.filter(id=channel_id_filter)
        
    channel_ids = [c.id for c in channels]
    
    # 2. Fetch posts
    posts = Post.objects.filter(channel_id__in=channel_ids)
    if platform_filter:
        posts = posts.filter(platform=platform_filter)
    if post_type_filter:
        if post_type_filter == 'other':
            posts = posts.exclude(post_type__in=['photo', 'video', 'link', 'status'])
        else:
            posts = posts.filter(post_type=post_type_filter)
        
    # Filter by date window
    posts = [p for p in posts if period_start <= str(p.published_at)[:10] <= period_end]
    post_keys = [p.post_key for p in posts]
    
    # 3. Use the newest saved metric available on or before the selected end
    # date. A reporting range must not accidentally show a future snapshot.
    snapshots = DailySnapshot.objects.filter(
        post_key__in=post_keys,
        snapshot_date__lte=period_end,
    )
    if platform_filter:
        snapshots = snapshots.filter(platform=platform_filter)

    latest_snaps = {}
    for snapshot in snapshots:
        existing = latest_snaps.get(snapshot.post_key)
        if not existing or snapshot.snapshot_date > existing.snapshot_date:
            latest_snaps[snapshot.post_key] = snapshot

    follower_snapshots = FollowerSnapshot.objects.filter(
        channel_id__in=channel_ids,
        snapshot_date__lte=period_end,
    ).order_by('snapshot_date')
    latest_follower_snapshots = {}
    for snapshot in follower_snapshots:
        latest_follower_snapshots[snapshot.channel_id] = snapshot
    followers_count = sum(snapshot.followers_count for snapshot in latest_follower_snapshots.values())
    followers_available = bool(latest_follower_snapshots)

    # Calculate every KPI from the same latest snapshot set, so cards, lower
    # summaries and post lists all describe the currently selected end date.
    posts_count = len(posts)
    reactions = comments = shares = views = reach = impressions = clicks = 0
    for snapshot in latest_snaps.values():
        reactions += snapshot.reactions
        comments += snapshot.comments
        shares += snapshot.shares
        views += snapshot.views or snapshot.impressions or snapshot.reach or 0
        reach += snapshot.reach
        impressions += snapshot.impressions
        clicks += snapshot.clicks

    total_engagement = reactions + comments + shares + clicks
    engagement_rate = None
    if reach > 0:
        engagement_rate = round((total_engagement / reach) * 100, 2)
    elif impressions > 0:
        engagement_rate = round((total_engagement / impressions) * 100, 2)

    # 4. Build a complete series by the post publication date. Each point uses
    # the latest saved metric for that post as of the selected period end. This
    # keeps all dashboard cards and chart lines aligned with incremental syncs,
    # without inventing zero deltas for days when an older post was not re-read.
    start_day = datetime.date.fromisoformat(period_start)
    end_day = datetime.date.fromisoformat(period_end)
    channel_map = {channel.id: channel.name for channel in channels}
    metric_names = ['engagement', 'postsCount', 'likes', 'comments', 'shares', 'views', 'reach']
    trend_map = {}
    current_day = start_day
    while current_day <= end_day:
        date_string = current_day.isoformat()
        point = {
            'date': date_string,
            'engagement': 0,
            'postsCount': 0,
            'likes': 0,
            'comments': 0,
            'shares': 0,
            'views': 0,
            'reach': 0,
        }
        for channel in channels:
            for metric in metric_names:
                point[f'{channel.name}_{metric}'] = 0
        trend_map[date_string] = point
        current_day += datetime.timedelta(days=1)

    for post in posts:
        date_string = str(post.published_at)[:10]
        point = trend_map.get(date_string)
        if not point:
            continue

        channel_name = channel_map.get(post.channel_id, 'Hidden channel')
        snapshot = latest_snaps.get(post.post_key)
        values = {
            'postsCount': 1,
            'engagement': snapshot.total_engagement if snapshot else 0,
            'likes': snapshot.reactions if snapshot else 0,
            'comments': snapshot.comments if snapshot else 0,
            'shares': snapshot.shares if snapshot else 0,
            'views': (snapshot.views or snapshot.impressions or snapshot.reach or 0) if snapshot else 0,
            'reach': snapshot.reach if snapshot else 0,
        }
        for metric, value in values.items():
            point[metric] += value or 0
            point[f'{channel_name}_{metric}'] += value or 0

    trends = []
    for point in trend_map.values():
        point['engagementRate'] = round((point['engagement'] / point['reach']) * 100, 2) if point['reach'] > 0 else 0
        for channel in channels:
            channel_engagement = point[f'{channel.name}_engagement']
            channel_reach = point[f'{channel.name}_reach']
            point[f'{channel.name}_engagementRate'] = round((channel_engagement / channel_reach) * 100, 2) if channel_reach > 0 else 0
        trends.append(point)
    # 5. Channel Stats
    channel_stats = []
    for c in channels:
        c_posts = [p for p in posts if p.channel_id == c.id]
        c_eng = sum(latest_snaps.get(p.post_key).total_engagement for p in c_posts if latest_snaps.get(p.post_key))
        channel_stats.append({
            'channelName': c.name,
            'platform': c.platform,
            'postsCount': len(c_posts),
            'engagement': c_eng
        })
        
    # 6. Most recent posts: always show the latest ten in the selected page scope.
    # This list intentionally ignores the dashboard date window.
    recent_posts = list(
        Post.objects.filter(channel_id__in=channel_ids, is_deleted=False)
        .order_by("-published_at")[:10]
    )
    recent_post_keys = [post.post_key for post in recent_posts]
    recent_snapshots = DailySnapshot.objects.filter(post_key__in=recent_post_keys).order_by(
        "post_key", "-snapshot_date"
    )
    recent_latest_snaps = {}
    for snapshot in recent_snapshots:
        recent_latest_snaps.setdefault(snapshot.post_key, snapshot)

    top_posts = []
    for post in recent_posts:
        snapshot = recent_latest_snaps.get(post.post_key)
        top_posts.append({
            'postKey': post.post_key,
            'platform': post.platform,
            'channelId': post.channel_id,
            'externalPostId': post.external_post_id,
            'postUrl': post.post_url,
            'imageUrl': post.image_url,
            'postType': post.post_type,
            'message': post.message,
            'publishedAt': post.published_at,
            'importedAt': post.imported_at,
            'updatedAt': post.updated_at,
            'isDeleted': post.is_deleted,
            'engagement': snapshot.total_engagement if snapshot else 0,
            'likes': snapshot.reactions if snapshot else 0,
            'comments': snapshot.comments if snapshot else 0,
            'shares': snapshot.shares if snapshot else 0,
            'views': (snapshot.views or snapshot.impressions or snapshot.reach or 0) if snapshot else 0,
        })
    # 7. Top Viewed Posts (past 12 months)
    top_viewed_end_day = timezone.localdate()
    top_viewed_start_day = top_viewed_end_day - datetime.timedelta(days=365)
    top_viewed_start = top_viewed_start_day.isoformat()
    top_viewed_end = top_viewed_end_day.isoformat()
    top_viewed_start_at = timezone.make_aware(datetime.datetime.combine(top_viewed_start_day, datetime.time.min))
    top_viewed_end_at = timezone.make_aware(datetime.datetime.combine(top_viewed_end_day, datetime.time.max))

    tv_posts = Post.objects.filter(
        channel_id__in=channel_ids,
        published_at__gte=top_viewed_start_at,
        published_at__lte=top_viewed_end_at,
    )
    if post_type_filter:
        if post_type_filter == 'other':
            tv_posts = tv_posts.exclude(post_type__in=['photo', 'video', 'link', 'status'])
        else:
            tv_posts = tv_posts.filter(post_type=post_type_filter)
        
    tv_post_keys = [p.post_key for p in tv_posts]
    
    tv_snapshots = DailySnapshot.objects.filter(post_key__in=tv_post_keys)
    
    tv_latest_snaps = {}
    for snap in tv_snapshots:
        if snap.post_key not in tv_post_keys:
            continue
        existing = tv_latest_snaps.get(snap.post_key)
        if not existing or snap.snapshot_date > existing.snapshot_date:
            tv_latest_snaps[snap.post_key] = snap
            
    top_viewed_candidates = []
    for p in tv_posts:
        snap = tv_latest_snaps.get(p.post_key)
        v_count = (snap.views or snap.impressions or snap.reach or 0) if snap else 0
        top_viewed_candidates.append({
            'postKey': p.post_key,
            'platform': p.platform,
            'channelId': p.channel_id,
            'externalPostId': p.external_post_id,
            'postUrl': p.post_url,
            'imageUrl': p.image_url,
            'postType': p.post_type,
            'message': p.message,
            'publishedAt': p.published_at,
            'importedAt': p.imported_at,
            'updatedAt': p.updated_at,
            'isDeleted': p.is_deleted,
            'engagement': snap.total_engagement if snap else 0,
            'likes': snap.reactions if snap else 0,
            'comments': snap.comments if snap else 0,
            'shares': snap.shares if snap else 0,
            'views': v_count
        })
    top_viewed_candidates.sort(key=lambda x: x['views'], reverse=True)
    top_viewed_posts = top_viewed_candidates[:5]
    
    # 8. Last Sync At
    last_sync_channel = channels.filter(last_sync_at__isnull=False).order_by('-last_sync_at').first()
    
    errors = []
    for c in channels:
        if c.last_sync_status == 'failed':
            errors.append(f"Kênh \"{c.name}\" ({c.platform.upper()}) bị lỗi token hoặc kết nối.")
            
    # 9. Type Stats
    type_stats_map = {}
    for p in posts:
        raw_type = p.post_type or 'Khác'
        mapped_type = ('Ảnh / Album' if raw_type.lower() in ('photo', 'album')
                       else 'Video / Reel' if raw_type.lower() in ('video', 'reel')
                       else 'Liên kết' if raw_type.lower() == 'link'
                       else 'Văn bản' if raw_type.lower() == 'status'
                       else 'Khác')
        snap = latest_snaps.get(p.post_key)
        v_count = (snap.views or snap.impressions or snap.reach or 0) if snap else 0
        eng = snap.total_engagement if snap else 0
        
        curr = type_stats_map.get(mapped_type) or {
            'type': mapped_type,
            'count': 0,
            'views': 0,
            'engagement': 0,
            'engagementRate': None
        }
        curr['count'] += 1
        curr['views'] += v_count
        curr['engagement'] += eng
        type_stats_map[mapped_type] = curr
        
    type_stats = []
    for stat in type_stats_map.values():
        stat['engagementRate'] = round((stat['engagement'] / stat['views']) * 100, 2) if stat['views'] > 0 else None
        type_stats.append(stat)
        
    # 10. Platform Stats
    platform_stats_map = {}
    for p in posts:
        raw_plat = p.platform or 'facebook'
        mapped_plat = 'Facebook' if raw_plat.lower() == 'facebook' else 'Zalo OA'
        snap = latest_snaps.get(p.post_key)
        eng = snap.total_engagement if snap else 0
        
        curr = platform_stats_map.get(mapped_plat) or {
            'platform': mapped_plat,
            'count': 0,
            'engagement': 0
        }
        curr['count'] += 1
        curr['engagement'] += eng
        platform_stats_map[mapped_plat] = curr
        
    platform_stats = list(platform_stats_map.values())
    
    return Response({
        'kpis': {
            'postsCount': posts_count,
            'reactions': reactions,
            'comments': comments,
            'shares': shares,
            'views': views,
            'reach': reach,
            'totalEngagement': total_engagement,
            'engagementRate': engagement_rate,
            'followers': followers_count,
            'followersAvailable': followers_available
        },
        'trends': trends,
        'channelStats': channel_stats,
        'topPosts': top_posts,
        'topViewedPosts': top_viewed_posts,
        'typeStats': type_stats,
        'platformStats': platform_stats,
        'lastSync': last_sync_channel.last_sync_at.isoformat() if last_sync_channel else None,
        'errors': errors
    })

def _active_background_request():
    running_since = timezone.now() - datetime.timedelta(hours=6)
    active = (
        ApiLog.objects.filter(
            status__in=["queued", "running"],
            started_at__gte=running_since,
        )
        .order_by("started_at")
        .first()
    )
    return str(active.request_id or "") if active else ""


def _start_background_sync(recent_days=1, history_days=396, channel_ids=None, since=None, until=None):
    """Queue the requested active channels, then run a cancellable detached sync."""
    recent_days = max(1, min(int(recent_days), 30))
    history_days = max(recent_days, min(int(history_days), 3650))
    request_id = f"background_{uuid.uuid4().hex[:12]}"
    channels = Channel.objects.filter(status="active")
    selected_channel_ids = [str(value).strip() for value in (channel_ids or []) if str(value).strip()]
    if selected_channel_ids:
        channels = channels.filter(id__in=selected_channel_ids)
    active_channels = list(channels.order_by("name"))
    SyncEngine.queue_channels(active_channels, request_id)

    manage_py = settings.BASE_DIR / "manage.py"
    process_args = [
        sys.executable,
        str(manage_py),
        "sync_social_daily",
        "--initial-days",
        str(history_days),
        "--recent-days",
        str(recent_days),
    ]
    for channel_id in selected_channel_ids:
        process_args.extend(["--channel-id", channel_id])
    if since:
        process_args.extend(['--since', str(since)])
    if until:
        process_args.extend(['--until', str(until)])
    process_args.extend([
        "--request-id",
        request_id,
    ])
    popen_options = {
        "cwd": str(settings.BASE_DIR),
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "close_fds": True,
    }
    if os.name == "nt":
        popen_options["creationflags"] = (
            subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        )
    else:
        popen_options["start_new_session"] = True
    subprocess.Popen(process_args, **popen_options)
    return request_id

@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def sync_all(request):
    """POST /api/sync/all - Sync all active channels."""
    try:
        if request.data.get("background"):
            active_request_id = _active_background_request()
            if active_request_id:
                return Response({
                    "success": True,
                    "queued": True,
                    "alreadyRunning": True,
                    "requestId": active_request_id,
                    "message": "Đang có một lần đồng bộ chạy ngầm. Dữ liệu sẽ tự cập nhật khi hoàn tất.",
                }, status=status.HTTP_202_ACCEPTED)

            recent_days = request.data.get("recentDays", request.data.get("days", 1))
            raw_channel_ids = request.data.get("channelIds") or []
            channel_ids = [str(value).strip() for value in raw_channel_ids if str(value).strip()] if isinstance(raw_channel_ids, list) else []
            request_id = _start_background_sync(
                recent_days=recent_days,
                history_days=request.data.get("historyDays", 396),
                channel_ids=channel_ids,
            )
            return Response({
                "success": True,
                "queued": True,
                "requestId": request_id,
                "message": "Đã xếp hàng đồng bộ nền. Kênh chưa có dữ liệu sẽ nạp đủ 1 năm bài đăng, chỉ số và follow; các lần sau chỉ quét ngày mới.",
            }, status=status.HTTP_202_ACCEPTED)

        google_token = getattr(request, 'google_access_token', None)
        since = request.data.get('since')
        until = request.data.get('until')
        results = SyncEngine.sync_all_channels(
            google_token,
            since=since,
            until=until,
        )
        return Response(results)
    except (TypeError, ValueError):
        return Response(
            {"error": "Khoảng thời gian đồng bộ không hợp lệ."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    except Exception as exc:
        return Response(
            {"error": str(exc)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

@api_view(['POST'])
@permission_classes([IsManagerOrAdmin])
def sync_cancel(request):
    """Request cancellation for the active background sync run(s)."""
    requested_id = str(request.data.get("requestId") or "").strip()
    requested_channel_id = str(request.data.get("channelId") or "").strip()
    active_logs = ApiLog.objects.filter(status__in=["queued", "running"])
    if requested_id:
        active_logs = active_logs.filter(request_id=requested_id)
    if requested_channel_id:
        active_logs = active_logs.filter(channel_id=requested_channel_id)

    request_ids = list(active_logs.values_list("request_id", flat=True).distinct())
    if not request_ids:
        return Response(
            {"error": "Không có lượt đồng bộ nào đang chạy để hủy."},
            status=status.HTTP_404_NOT_FOUND,
        )

    now = timezone.now()
    active_logs.update(
        status="cancelled",
        ended_at=now,
        error_code="SYNC_CANCELLED",
        error_message="Đồng bộ đã được quản trị viên hủy.",
    )
    return Response({
        "success": True,
        "requestIds": request_ids,
        "message": "Đã gửi yêu cầu hủy đồng bộ. Kênh đang xử lý sẽ dừng sau tác vụ API hiện tại.",
    })

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def facebook_api_usage(request):
    from .providers import FACEBOOK_USAGE_FIELDS, _numeric_values, get_facebook_api_state

    state = get_facebook_api_state()
    values = _numeric_values(state.get("usage", {}), FACEBOOK_USAGE_FIELDS)
    cooldown_until = str(state.get("cooldownUntil") or "")
    cooldown_active = False
    if cooldown_until:
        try:
            parsed = datetime.datetime.fromisoformat(cooldown_until.replace("Z", "+00:00"))
            if timezone.is_naive(parsed):
                parsed = timezone.make_aware(parsed, datetime.timezone.utc)
            cooldown_active = parsed > timezone.now()
        except (TypeError, ValueError):
            pass
    return Response({
        **state,
        "maxUsage": int(max(values, default=0)),
        "cooldownActive": cooldown_active,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def sync_history(request):
    """GET /api/sync/history - Lịch sử đồng bộ"""
    from .models import ApiLog
    request_id = str(request.query_params.get("requestId") or "").strip()
    logs = ApiLog.objects.all()
    if request_id:
        logs = logs.filter(request_id=request_id)
    logs = logs.order_by('-started_at')[:100]
    result = []
    for log in logs:
        result.append({
            'id': log.log_id,
            'logId': log.log_id,
            'startedAt': log.started_at.isoformat(),
            'endedAt': log.ended_at.isoformat() if log.ended_at else None,
            'platform': log.platform,
            'action': log.action,
            'channelId': log.channel_id,
            'status': log.status,
            'recordsReceived': log.records_received,
            'recordsInserted': log.records_inserted,
            'recordsUpdated': log.records_updated,
            'errorCode': log.error_code,
            'errorMessage': log.error_message,
            'requestId': log.request_id
        })
    return Response(result)

@api_view(['GET'])
@permission_classes([IsAuthenticatedOrReadOnly])
def posts_list(request):
    """GET /api/posts - Danh sách bài viết có phân trang"""
    try:
        page = int(request.query_params.get('page', 1))
        limit = int(request.query_params.get('limit', 20))
        start_date = request.query_params.get('startDate', get_recent_start_date(30))
        end_date = request.query_params.get('endDate', get_today_date())
        platform_filter = request.query_params.get('platform')
        channel_id_filter = request.query_params.get('channelId')
        post_type_filter = request.query_params.get('postType')
        sort_by = request.query_params.get('sortBy', 'publishedAt')
        sort_dir = request.query_params.get('sortDir', 'desc')
        
        queryset = Post.objects.filter(is_deleted=False)
        if start_date:
            queryset = queryset.filter(published_at__date__gte=start_date)
        if end_date:
            queryset = queryset.filter(published_at__date__lte=end_date)
        if platform_filter:
            queryset = queryset.filter(platform=platform_filter)
        if channel_id_filter:
            queryset = queryset.filter(channel_id=channel_id_filter)
        if post_type_filter and post_type_filter != 'all':
            if post_type_filter == 'other':
                queryset = queryset.exclude(post_type__in=['photo', 'video', 'link', 'status'])
            else:
                queryset = queryset.filter(post_type=post_type_filter)
            
        # Active channels only
        active_channel_ids = list(Channel.objects.filter(status='active').values_list('id', flat=True))
        queryset = queryset.filter(channel_id__in=active_channel_ids)
        
        # Sort
        order = '-published_at' if sort_dir == 'desc' else 'published_at'
        if sort_by == 'engagement':
            order = '-published_at'  # Will sort by engagement after snapshot join
        queryset = queryset.order_by(order)
        
        total = queryset.count()
        offset = (page - 1) * limit
        posts = list(queryset[offset:offset + limit])
        
        # Get snapshots for these posts
        post_keys = [p.post_key for p in posts]
        snapshots = DailySnapshot.objects.filter(post_key__in=post_keys)
        latest_snaps = {}
        for s in snapshots:
            existing = latest_snaps.get(s.post_key)
            if not existing or s.snapshot_date > existing.snapshot_date:
                latest_snaps[s.post_key] = s
                
        # Channel name map
        channels = {c.id: c.name for c in Channel.objects.all()}
        
        result = []
        for p in posts:
            snap = latest_snaps.get(p.post_key)
            result.append({
                'postKey': p.post_key,
                'platform': p.platform,
                'channelId': p.channel_id,
                'channelName': channels.get(p.channel_id, ''),
                'externalPostId': p.external_post_id,
                'postUrl': p.post_url,
                'imageUrl': p.image_url,
                'postType': p.post_type,
                'message': p.message or '',
                'publishedAt': p.published_at.isoformat(),
                'reactions': snap.reactions if snap else 0,
                'likes': snap.likes if snap else 0,
                'comments': snap.comments if snap else 0,
                'shares': snap.shares if snap else 0,
                'views': snap.views if snap else 0,
                'reach': snap.reach if snap else 0,
                'impressions': snap.impressions if snap else 0,
                'clicks': snap.clicks if snap else 0,
                'totalEngagement': snap.total_engagement if snap else 0,
                'engagementRate': snap.engagement_rate if snap else None,
            })
            
        return Response({
            'posts': result,
            'total': total,
            'page': page,
            'limit': limit,
            'totalPages': (total + limit - 1) // limit
        })
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
