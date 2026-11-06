import datetime
import json
from datetime import timedelta
from io import BytesIO, StringIO
from unittest.mock import Mock, patch

import requests
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from openpyxl import load_workbook

from .models import ApiLog, Channel, ChannelMetricSnapshot, DailySnapshot, FollowerSnapshot, Post
from .providers import FacebookProvider, FacebookRateLimitDeferred, fetch_with_retry
from .sync import SyncEngine
from .views import _start_background_sync
from authentication.models import SystemConfig


class FacebookPaginationTests(TestCase):
    @patch("social.providers.fetch_with_retry")
    def test_invalid_page_token_is_refreshed_from_saved_scan_token(self, fetch):
        now = timezone.now()
        SystemConfig.objects.create(
            key="main",
            data={
                "metaPageTokensJson": json.dumps({"page-1": "expired-page-token"}),
                "detailedTokensList": [{
                    "id": "facebook-page-1",
                    "platform": "facebook",
                    "pageId": "page-1",
                    "pageName": "Page 1",
                    "accessToken": "expired-page-token",
                    "sourceTokenId": "scan-1",
                }],
                "facebookScanTokens": [{
                    "id": "scan-1",
                    "platform": "facebook",
                    "label": "Token qu?t Facebook",
                    "accessToken": "valid-scan-token",
                    "issuedAt": now.isoformat(),
                    "expiresAt": (now + timedelta(days=42)).isoformat(),
                    "pageIds": ["page-1"],
                    "pageNames": ["Page 1"],
                }],
            },
        )
        unauthorized = requests.HTTPError("Unauthorized")
        unauthorized.response = Mock(status_code=401)
        fetch.side_effect = [
            unauthorized,
            {"data": [{"id": "page-1", "name": "Page 1", "access_token": "fresh-page-token"}]},
            {"id": "page-1", "name": "Page 1"},
        ]

        provider = FacebookProvider()
        self.assertTrue(provider.validate_credentials("channel-1", "page-1"))

        data = SystemConfig.objects.get(key="main").data
        self.assertEqual(json.loads(data["metaPageTokensJson"])["page-1"], "fresh-page-token")
        self.assertEqual(data["detailedTokensList"][0]["accessToken"], "fresh-page-token")
        self.assertEqual(data["facebookScanTokens"][0]["validationStatus"], "valid")
        self.assertEqual(data["facebookScanTokens"][0]["label"], "Token quét Facebook")

    @patch("social.providers.fetch_with_retry")
    def test_invalid_scan_token_is_reported_instead_of_using_fake_expiry(self, fetch):
        now = timezone.now()
        SystemConfig.objects.create(
            key="main",
            data={
                "metaPageTokensJson": json.dumps({"page-1": "expired-page-token"}),
                "detailedTokensList": [{
                    "id": "facebook-page-1",
                    "platform": "facebook",
                    "pageId": "page-1",
                    "pageName": "Page 1",
                    "accessToken": "expired-page-token",
                    "sourceTokenId": "scan-1",
                }],
                "facebookScanTokens": [{
                    "id": "scan-1",
                    "platform": "facebook",
                    "label": "Token quét Facebook",
                    "accessToken": "expired-scan-token",
                    "issuedAt": now.isoformat(),
                    "expiresAt": (now + timedelta(days=42)).isoformat(),
                    "pageIds": ["page-1"],
                    "pageNames": ["Page 1"],
                }],
            },
        )
        page_error = requests.HTTPError("Unauthorized")
        page_error.response = Mock(status_code=401)
        scan_error = requests.HTTPError("Unauthorized")
        scan_error.response = Mock(status_code=401)
        fetch.side_effect = [page_error, scan_error]

        provider = FacebookProvider()
        self.assertFalse(provider.validate_credentials("channel-1", "page-1"))

        scan = SystemConfig.objects.get(key="main").data["facebookScanTokens"][0]
        self.assertEqual(scan["validationStatus"], "invalid")
        self.assertIn("nạp lại", scan["lastValidationError"])

    @patch("social.providers.fetch_with_retry")
    def test_rescan_saved_token_discovers_new_pages_and_refreshes_existing_tokens(self, fetch):
        now = timezone.now()
        SystemConfig.objects.create(
            key="main",
            data={
                "metaPageTokensJson": json.dumps({"page-1": "old-page-token"}),
                "detailedTokensList": [{
                    "id": "facebook-page-1",
                    "platform": "facebook",
                    "pageId": "page-1",
                    "pageName": "Old page name",
                    "accessToken": "old-page-token",
                    "sourceTokenId": "scan-1",
                }],
                "facebookScanTokens": [{
                    "id": "scan-1",
                    "platform": "facebook",
                    "label": "Saved token",
                    "accessToken": "valid-scan-token",
                    "issuedAt": now.isoformat(),
                    "expiresAt": (now + timedelta(days=42)).isoformat(),
                    "pageIds": ["page-1"],
                    "pageNames": ["Old page name"],
                }],
            },
        )
        fetch.side_effect = [
            {
                "data": [{"id": "page-1", "name": "Page 1", "access_token": "fresh-page-token"}],
                "paging": {"cursors": {"after": "next-page"}},
            },
            {
                "data": [{"id": "page-2", "name": "Page 2", "access_token": "new-page-token"}],
                "paging": {"cursors": {}},
            },
        ]

        result = FacebookProvider().rescan_saved_token("scan-1")

        self.assertEqual(result["addedPageIds"], ["page-2"])
        self.assertEqual([page["id"] for page in result["pages"]], ["page-1", "page-2"])
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(fetch.call_args_list[1].kwargs["params"]["after"], "next-page")
        self.assertNotIn("access_token", fetch.call_args_list[0].kwargs["params"])
        data = SystemConfig.objects.get(key="main").data
        rows = {row["pageId"]: row for row in data["detailedTokensList"]}
        self.assertEqual(rows["page-1"]["accessToken"], "fresh-page-token")
        self.assertEqual(rows["page-2"]["sourceTokenId"], "scan-1")
        self.assertEqual(data["facebookScanTokens"][0]["pageIds"], ["page-1", "page-2"])
        self.assertEqual(data["facebookScanTokens"][0]["validationStatus"], "valid")
        self.assertEqual(
            json.loads(data["metaPageTokensJson"]),
            {"page-1": "fresh-page-token", "page-2": "new-page-token"},
        )

    @patch("social.providers.fetch_with_retry")
    def test_list_posts_follows_cursor_pagination(self, fetch):
        fetch.side_effect = [
            {
                "data": [
                    {
                        "id": "page_1",
                        "message": "One",
                        "created_time": timezone.now().isoformat(),
                    }
                ],
                "paging": {"cursors": {"after": "cursor_2"}},
            },
            {
                "data": [
                    {
                        "id": "page_2",
                        "message": "Two",
                        "created_time": timezone.now().isoformat(),
                    }
                ],
                "paging": {"cursors": {}},
            },
        ]

        provider = FacebookProvider()
        with patch.object(provider, "get_token", return_value="test-token"):
            posts = provider.list_posts(
                "channel",
                "page",
                since=timezone.now() - timedelta(days=90),
                until=timezone.now(),
            )

        self.assertEqual([post["id"] for post in posts], ["page_1", "page_2"])
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual(fetch.call_args_list[1].kwargs["params"]["after"], "cursor_2")
        self.assertNotIn("access_token", fetch.call_args_list[0].kwargs["params"])

    @patch("social.providers.fetch_with_retry")
    def test_post_metrics_use_v25_media_view_fields(self, fetch):
        fetch.side_effect = [
            {
                "data": [
                    {"name": "post_media_view", "period": "lifetime", "values": [{"value": 123}]},
                    {"name": "post_total_media_view_unique", "period": "lifetime", "values": [{"value": 45}]},
                    {"name": "post_total_media_view_unique", "period": "day", "values": [{"value": 0}]},
                ]
            },
            {
                "reactions": {"summary": {"total_count": 5}},
                "comments": {"summary": {"total_count": 3}},
                "shares": {"count": 2},
            },
        ]

        provider = FacebookProvider()
        with patch.object(provider, "get_token", return_value="test-token"):
            metrics = provider.get_post_metrics("channel", "page", [{"id": "post"}])

        self.assertEqual(provider.api_version, "v25.0")
        self.assertEqual(metrics[0]["views"], 123)
        self.assertEqual(metrics[0]["reach"], 45)
        self.assertEqual(metrics[0]["clicks"], 0)
        requested = fetch.call_args_list[0].kwargs["params"]["metric"]
        self.assertIn("post_media_view", requested)
        self.assertNotIn("post_impressions", requested)
        self.assertNotIn("post_clicks", requested)

    @patch("social.providers.fetch_with_retry")
    def test_post_metrics_reuse_engagement_embedded_in_post_list(self, fetch):
        fetch.return_value = {
            "data": [
                {"name": "post_media_view", "period": "lifetime", "values": [{"value": 30}]},
                {"name": "post_total_media_view_unique", "period": "lifetime", "values": [{"value": 20}]},
            ]
        }
        provider = FacebookProvider()
        with patch.object(provider, "get_token", return_value="test-token"):
            metrics = provider.get_post_metrics(
                "channel",
                "page",
                [{"id": "post", "_reactions": 5, "_comments": 3, "_shares": 2}],
            )

        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(metrics[0]["reactions"], 5)
        self.assertEqual(metrics[0]["comments"], 3)
        self.assertEqual(metrics[0]["shares"], 2)

    @patch("social.providers.requests.get")
    def test_usage_header_starts_cooldown_before_meta_reaches_one_hundred_percent(self, get):
        response = Mock(status_code=200)
        response.headers = {"X-App-Usage": json.dumps({"call_count": 86, "total_time": 20, "total_cputime": 10})}
        response.json.return_value = {"data": []}
        response.raise_for_status.return_value = None
        get.return_value = response

        with patch("social.providers._facebook_calls_this_process", 0), patch("social.providers._facebook_last_usage_max", 0):
            self.assertEqual(fetch_with_retry("https://graph.facebook.com/v25.0/page"), {"data": []})
            with self.assertRaises(FacebookRateLimitDeferred):
                fetch_with_retry("https://graph.facebook.com/v25.0/page")

        self.assertEqual(get.call_count, 1)
        state = SystemConfig.objects.get(key="facebook_api_state").data
        self.assertIn("cooldownUntil", state)
        self.assertEqual(state["usage"]["app"]["call_count"], 86)

    @patch("social.providers.requests.get")
    def test_meta_rate_limit_error_is_not_retried_aggressively(self, get):
        response = Mock(status_code=400)
        response.headers = {"Retry-After": "1200"}
        response.json.return_value = {"error": {"code": 4, "message": "Application request limit reached"}}
        get.return_value = response

        with patch("social.providers._facebook_calls_this_process", 0), patch("social.providers._facebook_last_usage_max", 0):
            with self.assertRaises(FacebookRateLimitDeferred):
                fetch_with_retry("https://graph.facebook.com/v25.0/page", retries=3)

        self.assertEqual(get.call_count, 1)
        state = SystemConfig.objects.get(key="facebook_api_state").data
        self.assertIn("cooldownUntil", state)
        self.assertIn("4", state["reason"])


    @patch("social.providers.fetch_with_retry")
    def test_follower_insights_fetches_each_metric_separately(self, fetch):
        fetch.side_effect = [
            {"data": [{"name": "page_follows", "values": [{"value": 100, "end_time": "2026-07-22T07:00:00+0000"}]}]},
            {"data": [{"name": "page_daily_follows_unique", "values": [{"value": 4, "end_time": "2026-07-22T07:00:00+0000"}]}]},
            {"data": [{"name": "page_daily_unfollows_unique", "values": [{"value": 1, "end_time": "2026-07-22T07:00:00+0000"}]}]},
        ]
        provider = FacebookProvider()
        with patch.object(provider, "get_token", return_value="test-token"):
            rows = provider.get_follower_insights(
                "channel",
                "page",
                since=timezone.now() - timedelta(days=7),
                until=timezone.now(),
            )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["followers_count"], 100)
        self.assertEqual(rows[0]["daily_follows_unique"], 4)
        self.assertEqual(rows[0]["daily_unfollows_unique"], 1)
        self.assertEqual(fetch.call_count, 3)
        self.assertEqual(
            [call.kwargs["params"]["metric"] for call in fetch.call_args_list],
            ["page_follows", "page_daily_follows_unique", "page_daily_unfollows_unique"],
        )
        self.assertTrue(all("access_token" not in call.kwargs["params"] for call in fetch.call_args_list))
    @patch("social.providers.fetch_with_retry")
    def test_channel_metric_insights_returns_daily_compact_values(self, fetch):
        fetch.side_effect = [
            {"data": [{"name": "page_media_view", "values": [{"value": 120, "end_time": "2026-07-22T07:00:00+0000"}]}]},
            {"data": [{"name": "page_post_engagements", "values": [{"value": 8, "end_time": "2026-07-22T07:00:00+0000"}]}]},
        ]
        provider = FacebookProvider()
        with patch.object(provider, "get_token", return_value="test-token"):
            rows = provider.get_channel_metric_insights(
                "channel", "page", since=timezone.now() - timedelta(days=7), until=timezone.now()
            )

        self.assertEqual(rows, [{"snapshot_date": "2026-07-22", "views": 120, "engagement": 8}])
        self.assertEqual(
            [call.kwargs["params"]["metric"] for call in fetch.call_args_list],
            ["page_media_view", "page_post_engagements"],
        )
    @patch("social.providers.fetch_with_retry")
    def test_follower_insights_chunks_a_year_into_90_day_windows(self, fetch):
        fetch.side_effect = [{"data": []}] * 15
        provider = FacebookProvider()
        end = timezone.now()

        with patch.object(provider, "get_token", return_value="test-token"):
            provider.get_follower_insights(
                "channel",
                "page",
                since=end - timedelta(days=365),
                until=end,
            )

        self.assertEqual(fetch.call_count, 15)
        windows = {
            (call.kwargs["params"]["since"], call.kwargs["params"]["until"])
            for call in fetch.call_args_list
        }
        self.assertEqual(len(windows), 5)
        for start, finish in windows:
            self.assertLessEqual(
                (datetime.date.fromisoformat(finish) - datetime.date.fromisoformat(start)).days,
                89,
            )


class SyncQueueTests(TestCase):
    def setUp(self):
        now = timezone.now()
        self.channel = Channel.objects.create(
            id='facebook:queue',
            platform='facebook',
            name='Queue Page',
            external_id='queue-page',
            status='active',
            created_at=now,
            updated_at=now,
        )

    def test_queued_log_changes_to_running_then_success(self):
        queued_log = SyncEngine.queue_channels([self.channel], 'queue_request')[self.channel.id]
        self.assertEqual(queued_log.status, 'queued')

        observed_statuses = []
        provider = Mock()

        def get_followers(*args):
            queued_log.refresh_from_db()
            observed_statuses.append(queued_log.status)
            return 10

        provider.get_followers.side_effect = get_followers
        provider.list_posts.return_value = []

        with patch.object(SyncEngine, 'get_provider', return_value=provider):
            success, _message = SyncEngine.sync_channel(
                self.channel.id,
                request_id='queue_request',
                queued_log=queued_log,
            )

        self.assertTrue(success)
        self.assertEqual(observed_statuses, ['running'])
        queued_log.refresh_from_db()
        self.assertEqual(queued_log.status, 'success')
        self.assertIsNotNone(queued_log.ended_at)
    def test_initial_follower_history_does_not_expand_post_discovery(self):
        provider = Mock()
        provider.get_followers.return_value = 10
        provider.get_follower_insights.return_value = []
        provider.list_posts.return_value = []
        recent_since = timezone.now() - timedelta(days=7)
        history_since = timezone.now() - timedelta(days=365)

        with patch.object(SyncEngine, 'get_provider', return_value=provider):
            success, _message = SyncEngine.sync_channel(
                self.channel.id,
                since=recent_since,
                until=timezone.now(),
                follower_since=history_since,
            )

        self.assertTrue(success)
        self.assertEqual(provider.get_follower_insights.call_args.kwargs['since'], history_since)
        self.assertEqual(provider.list_posts.call_args.kwargs['since'], recent_since)

    def test_large_metric_backfill_is_saved_in_resumable_safe_batches(self):
        now = timezone.now()
        provider = FacebookProvider()
        provider.metric_batch_limit = 2
        provider.validate_credentials = Mock(return_value=True)
        provider.get_followers = Mock(return_value=10)
        provider.get_follower_insights = Mock(return_value=[])
        provider.get_channel_metric_insights = Mock(return_value=[])
        provider.list_posts = Mock(return_value=[
            {"id": "post-1", "created_time": now.isoformat(), "post_type": "status"},
            {"id": "post-2", "created_time": now.isoformat(), "post_type": "status"},
            {"id": "post-3", "created_time": now.isoformat(), "post_type": "status"},
        ])
        provider.get_post_metrics = Mock(side_effect=lambda _channel, _page, posts: [
            {
                "id": post["id"],
                "reactions": 1,
                "comments": 1,
                "shares": 0,
                "views": 10,
                "reach": 8,
                "impressions": 10,
                "clicks": 0,
            }
            for post in posts
        ])

        with patch.object(SyncEngine, "get_provider", return_value=provider):
            first_success, _ = SyncEngine.sync_channel(self.channel.id)
            self.channel.refresh_from_db()
            self.assertTrue(first_success)
            self.assertEqual(self.channel.last_sync_status, "deferred")
            self.assertIsNone(self.channel.initial_sync_completed_at)
            self.assertIsNone(self.channel.last_data_sync_until)
            self.assertEqual(DailySnapshot.objects.filter(channel_id=self.channel.id).count(), 2)

            second_success, _ = SyncEngine.sync_channel(self.channel.id)

        self.channel.refresh_from_db()
        self.assertTrue(second_success)
        self.assertEqual(self.channel.last_sync_status, "success")
        self.assertIsNotNone(self.channel.initial_sync_completed_at)
        self.assertIsNotNone(self.channel.last_data_sync_until)
        self.assertEqual(DailySnapshot.objects.filter(channel_id=self.channel.id).count(), 3)
        self.assertEqual(
            [len(call.args[2]) for call in provider.get_post_metrics.call_args_list],
            [2, 1],
        )

    def test_cancelled_queue_stops_before_calling_the_provider(self):
        queued_log = SyncEngine.queue_channels([self.channel], 'cancel_request')[self.channel.id]
        queued_log.status = 'cancelled'
        queued_log.save(update_fields=['status'])
        provider = Mock()

        with patch.object(SyncEngine, 'get_provider', return_value=provider):
            success, message = SyncEngine.sync_channel(
                self.channel.id,
                request_id='cancel_request',
                queued_log=queued_log,
            )

        self.assertFalse(success)
        self.assertIn('hủy', message)
        provider.get_followers.assert_not_called()

    def test_rate_limit_pause_does_not_advance_channel_cursor(self):
        provider = Mock()
        provider.validate_credentials.side_effect = FacebookRateLimitDeferred("Tạm hoãn an toàn")

        with patch.object(SyncEngine, "get_provider", return_value=provider):
            success, message = SyncEngine.sync_channel(self.channel.id)

        self.channel.refresh_from_db()
        log = ApiLog.objects.get(channel_id=self.channel.id)
        self.assertTrue(success)
        self.assertIn("Tạm hoãn", message)
        self.assertEqual(self.channel.last_sync_status, "deferred")
        self.assertIsNone(self.channel.last_sync_at)
        self.assertIsNone(self.channel.last_data_sync_until)
        self.assertEqual(log.status, "deferred")
        self.assertEqual(log.error_code, "FACEBOOK_RATE_LIMIT_DEFERRED")

    @patch.object(SyncEngine, 'sync_channel')
    def test_sync_all_creates_queue_for_every_channel_before_processing(self, sync_channel):
        now = timezone.now()
        second_channel = Channel.objects.create(
            id='facebook:queue-two',
            platform='facebook',
            name='Queue Page Two',
            external_id='queue-page-two',
            status='active',
            created_at=now,
            updated_at=now,
        )
        queued_counts = []

        def complete_channel(channel_id, **kwargs):
            request_id = kwargs['request_id']
            queued_counts.append(
                ApiLog.objects.filter(request_id=request_id, status='queued').count()
            )
            log = kwargs['queued_log']
            log.status = 'success'
            log.ended_at = timezone.now()
            log.save(update_fields=['status', 'ended_at'])
            return True, 'ok'

        sync_channel.side_effect = complete_channel
        result = SyncEngine.sync_all_channels()

        self.assertTrue(result['success'])
        self.assertEqual(queued_counts[0], 2)
        self.assertEqual(
            set(ApiLog.objects.filter(request_id=result['requestId']).values_list('channel_id', flat=True)),
            {self.channel.id, second_channel.id},
        )


class BackgroundSyncTests(TestCase):
    @patch("social.views.subprocess.Popen")
    def test_background_sync_launches_one_year_management_command(self, popen):
        _start_background_sync()

        process_args = popen.call_args.args[0]
        self.assertIn("sync_social_daily", process_args)
        self.assertEqual(process_args.count("396"), 1)
        self.assertEqual(process_args.count("1"), 1)
        self.assertIn("--request-id", process_args)
        self.assertEqual(popen.call_args.kwargs["stdout"], -3)
        self.assertEqual(popen.call_args.kwargs["stderr"], -3)


class MediaSummaryExportTests(TestCase):
    def setUp(self):
        now = timezone.now()
        Channel.objects.create(
            id='facebook:report',
            platform='facebook',
            name='Trang bao cao',
            external_id='report-page',
            status='active',
            followers_count=123,
            created_at=now,
            updated_at=now,
        )

    def test_media_summary_xlsx_is_a_valid_workbook(self):
        response = self.client.get(
            '/api/reports/media-summary.xlsx',
            {
                'startDate': (timezone.now() - timedelta(days=365)).date().isoformat(),
                'endDate': timezone.localdate().isoformat(),
                'groupBy': 'month',
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response['Content-Type'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        self.assertIn('.xlsx', response['Content-Disposition'])
        self.assertGreater(len(response.content), 1000)

        workbook = load_workbook(BytesIO(response.content), read_only=True)
        sheet = workbook.active
        self.assertEqual(sheet['A1'].value, 'BÁO CÁO TỔNG HỢP TRUYỀN THÔNG')
        self.assertEqual(sheet['A4'].value, 'STT')
        self.assertEqual(sheet['C5'].value, 'Trang bao cao')
        self.assertEqual(sheet['F5'].value, 123)


class DailySyncCommandTests(TestCase):
    def setUp(self):
        now = timezone.now()
        self.channel = Channel.objects.create(
            id="facebook:test",
            platform="facebook",
            name="Test Page",
            external_id="test",
            status="active",
            created_at=now,
            updated_at=now,
        )

    @patch("social.management.commands.sync_social_daily.SyncEngine.sync_channel")
    def test_initial_run_loads_one_year_of_posts_metrics_and_followers(self, sync_channel):
        sync_channel.return_value = (True, "ok")

        call_command("sync_social_daily", stdout=StringIO())

        kwargs = sync_channel.call_args.kwargs
        self.assertTrue(timedelta(days=395) < timezone.now() - kwargs["since"] < timedelta(days=397))
        self.assertTrue(timedelta(days=395) < timezone.now() - kwargs["follower_since"] < timedelta(days=397))

    @patch("social.management.commands.sync_social_daily.SyncEngine.sync_channel")
    def test_later_runs_refresh_only_the_new_day(self, sync_channel):
        now = timezone.now()
        self.channel.initial_sync_completed_at = now
        self.channel.follower_history_loaded_at = now
        self.channel.save(update_fields=["initial_sync_completed_at", "follower_history_loaded_at"])
        sync_channel.return_value = (True, "ok")

        call_command("sync_social_daily", stdout=StringIO())

        kwargs = sync_channel.call_args.kwargs
        self.assertTrue(timedelta(hours=23) < timezone.now() - kwargs["since"] < timedelta(hours=25))
        self.assertTrue(timedelta(hours=23) < timezone.now() - kwargs["follower_since"] < timedelta(hours=25))
        self.assertTrue(
            timedelta(hours=23) < timezone.now() - kwargs["snapshot_existing_since"] < timedelta(hours=25)
        )

    @patch("social.management.commands.sync_social_daily.SyncEngine.sync_channel")
    def test_later_runs_begin_at_the_channel_last_successful_sync(self, sync_channel):
        last_sync = timezone.now() - timedelta(hours=7, minutes=15)
        self.channel.initial_sync_completed_at = last_sync - timedelta(days=365)
        self.channel.last_sync_at = last_sync
        self.channel.follower_history_loaded_at = last_sync
        self.channel.save(update_fields=["initial_sync_completed_at", "last_sync_at", "follower_history_loaded_at"])
        sync_channel.return_value = (True, "ok")

        call_command("sync_social_daily", stdout=StringIO())

        kwargs = sync_channel.call_args.kwargs
        self.assertTrue(timedelta(hours=31) < timezone.now() - kwargs["since"] < timedelta(hours=31, minutes=30))
        self.assertEqual(kwargs["snapshot_existing_since"], kwargs["since"])
        self.assertEqual(kwargs["follower_since"], kwargs["since"])

    @patch("social.management.commands.sync_social_daily.SyncEngine.sync_channel")
    def test_incremental_cursor_uses_last_covered_window_with_overlap(self, sync_channel):
        now = timezone.now()
        covered_until = now - timedelta(hours=5)
        self.channel.initial_sync_completed_at = now - timedelta(days=365)
        self.channel.follower_history_loaded_at = now - timedelta(days=365)
        self.channel.last_data_sync_until = covered_until
        self.channel.last_sync_at = now - timedelta(hours=1)
        self.channel.save(update_fields=[
            "initial_sync_completed_at",
            "follower_history_loaded_at",
            "last_data_sync_until",
            "last_sync_at",
        ])
        sync_channel.return_value = (True, "ok")

        call_command("sync_social_daily", stdout=StringIO())

        kwargs = sync_channel.call_args.kwargs
        self.assertEqual(kwargs["since"], covered_until - timedelta(days=1))
        self.assertEqual(kwargs["follower_since"], kwargs["since"])


class MediaSummaryTrendTests(TestCase):
    def setUp(self):
        now = timezone.now()
        self.channel = Channel.objects.create(
            id="facebook:trend",
            platform="facebook",
            name="Trend Page",
            external_id="trend-page",
            status="active",
            created_at=now,
            updated_at=now,
        )
        self.current_day = timezone.localdate()
        self.previous_month_end = self.current_day.replace(day=1) - timedelta(days=1)
        self.previous_month_start = self.previous_month_end.replace(day=1)
        published_at = timezone.make_aware(
            datetime.datetime.combine(self.previous_month_start - timedelta(days=1), datetime.time(hour=8))
        )
        self.post = Post.objects.create(
            post_key="facebook:trend:post",
            platform="facebook",
            channel_id=self.channel.id,
            external_post_id="post",
            post_url="https://example.com/post",
            post_type="photo",
            published_at=published_at,
            imported_at=now,
            updated_at=now,
        )
        ChannelMetricSnapshot.objects.create(
            snapshot_key=f"{self.channel.id}:{self.previous_month_end.isoformat()}:metrics",
            snapshot_date=self.previous_month_end.isoformat(), channel_id=self.channel.id,
            views=10, engagement=4, fetched_at=now,
        )
        ChannelMetricSnapshot.objects.create(
            snapshot_key=f"{self.channel.id}:{self.current_day.isoformat()}:metrics",
            snapshot_date=self.current_day.isoformat(), channel_id=self.channel.id,
            views=15, engagement=5, fetched_at=now,
        )
        FollowerSnapshot.objects.create(
            snapshot_key=f"{self.channel.id}:{self.previous_month_end.isoformat()}",
            snapshot_date=self.previous_month_end.isoformat(),
            channel_id=self.channel.id,
            channel_name=self.channel.name,
            followers_count=100,
            fetched_at=now,
        )
        FollowerSnapshot.objects.create(
            snapshot_key=f"{self.channel.id}:{self.current_day.isoformat()}",
            snapshot_date=self.current_day.isoformat(),
            channel_id=self.channel.id,
            channel_name=self.channel.name,
            followers_count=120,
            fetched_at=now,
        )

    def _snapshot(self, snapshot_day, views, engagement):
        DailySnapshot.objects.create(
            snapshot_key=f"{self.post.post_key}:{snapshot_day.isoformat()}",
            snapshot_date=snapshot_day.isoformat(),
            platform=self.channel.platform,
            channel_id=self.channel.id,
            post_key=self.post.post_key,
            views=views,
            reach=views,
            impressions=views,
            reactions=engagement,
            likes=engagement,
            total_engagement=engagement,
            fetched_at=timezone.now(),
        )

    def test_monthly_trend_sums_compact_daily_metrics_within_each_period(self):
        response = self.client.get('/api/media-summary/trend', {'groupBy': 'month'})
        self.assertEqual(response.status_code, 200)
        trend = {point['period']: point for point in response.json()['trend']}
        previous_period = self.previous_month_end.strftime('%Y-%m')
        current_period = self.current_day.strftime('%Y-%m')

        self.assertEqual(trend[previous_period]['views'], 10)
        self.assertEqual(trend[previous_period]['engagement'], 4)
        self.assertEqual(trend[previous_period]['postsCount'], 0)
        self.assertEqual(trend[previous_period]['followers'], 100)
        self.assertEqual(trend[current_period]['views'], 15)
        self.assertEqual(trend[current_period]['engagement'], 5)
        self.assertEqual(trend[current_period]['metricSource'], 'daily_insights')
        self.assertEqual(trend[current_period]['postsCount'], 0)
        self.assertEqual(trend[current_period]['followers'], 20)

    def test_monthly_trend_returns_zero_without_an_end_snapshot_in_that_period(self):
        published_day = self.previous_month_start - timedelta(days=70)
        baseline_post = Post.objects.create(
            post_key='facebook:trend:baseline', platform='facebook', channel_id=self.channel.id,
            external_post_id='baseline', post_url='https://example.com/baseline', post_type='photo',
            published_at=timezone.make_aware(datetime.datetime.combine(published_day, datetime.time(hour=8))),
            imported_at=timezone.now(), updated_at=timezone.now(),
        )
        DailySnapshot.objects.create(
            snapshot_key=f'{baseline_post.post_key}:{self.current_day.isoformat()}', snapshot_date=self.current_day.isoformat(),
            platform=self.channel.platform, channel_id=self.channel.id, post_key=baseline_post.post_key,
            views=77, reach=77, impressions=77, reactions=11, likes=11, total_engagement=11, fetched_at=timezone.now(),
        )

        response = self.client.get('/api/media-summary/trend', {'groupBy': 'month'})
        self.assertEqual(response['Cache-Control'], 'no-store, no-cache, must-revalidate')
        trend = {point['period']: point for point in response.json()['trend']}
        period = published_day.strftime('%Y-%m')
        self.assertEqual(trend[period]['views'], 0)
        self.assertEqual(trend[period]['engagement'], 0)

    def test_monthly_trend_uses_local_month_just_after_local_midnight(self):
        # 00:30 ngày 1/12 giờ Việt Nam vẫn là 30/11 theo UTC: tháng hiện tại phải là 2026-12.
        fake_now = datetime.datetime(2026, 11, 30, 17, 30, tzinfo=datetime.timezone.utc)
        with patch('django.utils.timezone.now', return_value=fake_now):
            response = self.client.get('/api/media-summary/trend', {'groupBy': 'month'})
        self.assertEqual(response.status_code, 200)
        periods = [point['period'] for point in response.json()['trend']]
        self.assertEqual(periods[-1], '2026-12')

    def test_quarterly_report_returns_eight_quarters(self):
        response = self.client.get('/api/media-summary/trend', {'groupBy': 'quarter'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['trend']), 8)

class DashboardFilterConsistencyTests(TestCase):
    def setUp(self):
        now = timezone.now()
        self.period_end = timezone.localdate() - timedelta(days=1)
        self.period_start = self.period_end - timedelta(days=6)
        self.channel = Channel.objects.create(
            id="facebook:filtered",
            platform="facebook",
            name="Filtered Page",
            external_id="filtered-page",
            status="active",
            followers_count=999,
            created_at=now,
            updated_at=now,
        )
        self.other_channel = Channel.objects.create(
            id="facebook:other",
            platform="facebook",
            name="Other Page",
            external_id="other-page",
            status="active",
            followers_count=888,
            created_at=now,
            updated_at=now,
        )
        self.placeholder = Channel.objects.create(
            id="technical-placeholder",
            platform="facebook",
            name="Facebook",
            external_id="current-facebook-token",
            status="active",
            followers_count=777,
            created_at=now,
            updated_at=now,
        )

        self.recent_post = self._post(
            "recent",
            self.channel,
            self.period_end,
            "photo",
        )
        self.old_top_post = self._post(
            "old-top",
            self.channel,
            self.period_end - timedelta(days=90),
            "video",
        )
        self.other_post = self._post(
            "other",
            self.other_channel,
            self.period_end,
            "photo",
        )
        self.too_old_post = self._post(
            "too-old",
            self.channel,
            self.period_end - timedelta(days=400),
            "link",
        )

        self._snapshot(self.recent_post, self.channel, 10, 2, 3, 1, 4)
        self._snapshot(self.old_top_post, self.channel, 500, 5, 0, 0, 0)
        self._snapshot(self.other_post, self.other_channel, 900, 90, 0, 0, 0)
        self._snapshot(self.too_old_post, self.channel, 9000, 900, 0, 0, 0)

        self._follower_snapshot(self.channel, self.period_start - timedelta(days=1), 100)
        self._follower_snapshot(self.channel, self.period_end, 110, daily_follows_unique=12, daily_unfollows_unique=2)
        self._follower_snapshot(self.channel, self.period_end + timedelta(days=1), 999)
        self._follower_snapshot(self.other_channel, self.period_end, 220)
        self._follower_snapshot(self.placeholder, self.period_end, 777)

    def _post(self, suffix, channel, published_day, post_type):
        published_at = timezone.make_aware(datetime.datetime.combine(published_day, datetime.time(hour=8)))
        return Post.objects.create(
            post_key=f"{channel.id}:{suffix}",
            platform=channel.platform,
            channel_id=channel.id,
            external_post_id=suffix,
            post_url=f"https://example.com/{suffix}",
            post_type=post_type,
            message=suffix,
            published_at=published_at,
            imported_at=timezone.now(),
            updated_at=timezone.now(),
        )

    def _snapshot(self, post, channel, views, reactions, comments, shares, clicks):
        total = reactions + comments + shares + clicks
        DailySnapshot.objects.create(
            snapshot_key=f"{post.post_key}:{self.period_end.isoformat()}",
            snapshot_date=self.period_end.isoformat(),
            platform=channel.platform,
            channel_id=channel.id,
            post_key=post.post_key,
            reactions=reactions,
            likes=reactions,
            comments=comments,
            shares=shares,
            clicks=clicks,
            views=views,
            reach=max(views, 1),
            impressions=max(views, 1),
            total_engagement=total,
            fetched_at=timezone.now(),
        )

    def _follower_snapshot(self, channel, snapshot_day, followers, daily_follows_unique=None, daily_unfollows_unique=None):
        FollowerSnapshot.objects.create(
            snapshot_key=f"{channel.id}:{snapshot_day.isoformat()}",
            snapshot_date=snapshot_day.isoformat(),
            channel_id=channel.id,
            channel_name=channel.name,
            followers_count=followers,
            daily_follows_unique=daily_follows_unique,
            daily_unfollows_unique=daily_unfollows_unique,
            fetched_at=timezone.now(),
        )

    def _filters(self):
        return {
            "startDate": self.period_start.isoformat(),
            "endDate": self.period_end.isoformat(),
            "platform": "facebook",
            "channelId": self.channel.id,
        }

    def test_every_dashboard_section_uses_selected_scope_except_one_year_top_views(self):
        response = self.client.get('/api/dashboard', self._filters())
        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data['kpis']['postsCount'], 1)
        self.assertEqual(data['kpis']['views'], 10)
        self.assertEqual(data['kpis']['totalEngagement'], 10)
        self.assertEqual(data['kpis']['followers'], 110)
        self.assertTrue(data['kpis']['followersAvailable'])
        self.assertEqual([item['channelName'] for item in data['channelStats']], [self.channel.name])
        self.assertEqual(
            [item['postKey'] for item in data['topPosts']],
            [self.recent_post.post_key, self.old_top_post.post_key, self.too_old_post.post_key],
        )
        self.assertEqual([item['type'] for item in data['typeStats']], ['Ảnh / Album'])
        expected_dates = [(self.period_start + timedelta(days=offset)).isoformat() for offset in range(7)]
        self.assertEqual([item['date'] for item in data['trends']], expected_dates)
        latest_day = next(item for item in data['trends'] if item['date'] == self.period_end.isoformat())
        self.assertEqual(latest_day['postsCount'], 1)
        self.assertEqual(latest_day['views'], 10)
        self.assertEqual(latest_day['engagement'], 10)
        top_viewed_keys = [item['postKey'] for item in data['topViewedPosts']]
        self.assertEqual(top_viewed_keys[0], self.old_top_post.post_key)
        self.assertIn(self.recent_post.post_key, top_viewed_keys)
        self.assertNotIn(self.other_post.post_key, top_viewed_keys)
        self.assertNotIn(self.too_old_post.post_key, top_viewed_keys)

    def test_follower_trend_uses_exact_dates_and_selected_channel(self):
        response = self.client.get('/api/followers/trend', self._filters())
        self.assertEqual(response.status_code, 200)
        trend = response.json()
        self.assertEqual(len(trend), 7)
        self.assertEqual(trend[0]['date'], self.period_start.isoformat())
        self.assertEqual(trend[0]['followersCount'], 100)
        self.assertIsNone(trend[0]['dailyFollowsUnique'])
        self.assertIsNone(trend[0]['dailyUnfollowsUnique'])
        self.assertEqual(trend[0]['Filtered Page_followers'], 100)
        self.assertIsNone(trend[0]['Filtered Page_dailyFollowsUnique'])
        self.assertIsNone(trend[0]['Filtered Page_dailyUnfollowsUnique'])
        self.assertEqual(trend[-1]['date'], self.period_end.isoformat())
        self.assertEqual(trend[-1]['followersCount'], 110)
        self.assertEqual(trend[-1]['dailyFollowsUnique'], 12)
        self.assertEqual(trend[-1]['dailyUnfollowsUnique'], 2)
        self.assertEqual(trend[-1]['Filtered Page_followers'], 110)
        self.assertEqual(trend[-1]['Filtered Page_dailyFollowsUnique'], 12)
        self.assertEqual(trend[-1]['Filtered Page_dailyUnfollowsUnique'], 2)

    def test_technical_facebook_placeholder_is_not_returned_as_a_channel(self):
        response = self.client.get('/api/channels')
        self.assertEqual(response.status_code, 200)
        external_ids = [item['externalId'] for item in response.json()]
        self.assertNotIn('current-facebook-token', external_ids)


class BotPublishingTests(TestCase):
    def setUp(self):
        from .bot_models import FbDraftPost, FbPublishTarget
        self.target = FbPublishTarget.objects.create(
            name="Fanpage Fermat Test",
            target_type="page",
            target_id="123456789",
            access_token="mock_access_token_123",
            is_active=True
        )
        self.draft = FbDraftPost.objects.create(
            title="Kỳ thi Thử Toán 2026",
            content="Đăng ký ngay hôm nay để nhận ưu đãi.",
            hashtags="#fermat #toan",
            status="pending"
        )

    def test_mock_publish_service(self):
        from .bot_publishing_service import publish_draft_to_facebook
        res = publish_draft_to_facebook(self.draft, target_id=self.target.id)
        self.assertTrue(res["id"].startswith("mock_123456789_"))
        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, "published")
        self.assertIsNotNone(self.draft.published_at)
        self.assertIn("123456789", self.draft.fb_post_url)

    def test_api_publish_draft(self):
        resp = self.client.post(
            "/api/social-bot/publish-draft",
            data=json.dumps({"id": self.draft.id, "target_id": self.target.id}),
            content_type="application/json"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["new_status"], "published")

    def test_api_approve_with_auto_publish(self):
        resp = self.client.post(
            "/api/social-bot/approve-draft",
            data=json.dumps({"id": self.draft.id, "auto_publish": True, "target_id": self.target.id}),
            content_type="application/json"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["new_status"], "published")

    def test_api_targets_list_and_create(self):
        # GET
        get_res = self.client.get("/api/social-bot/targets")
        self.assertEqual(get_res.status_code, 200)
        self.assertTrue(len(get_res.json()["targets"]) >= 1)

        # POST create new
        post_res = self.client.post(
            "/api/social-bot/targets",
            data=json.dumps({
                "name": "New Fanpage",
                "target_type": "page",
                "target_id": "999888777",
                "access_token": "mock_token"
            }),
            content_type="application/json"
        )
        self.assertEqual(post_res.status_code, 200)
        self.assertEqual(post_res.json()["target"]["name"], "New Fanpage")

    def test_idempotent_publish(self):
        from .bot_publishing_service import publish_draft_to_facebook
        res1 = publish_draft_to_facebook(self.draft, target_id=self.target.id)
        self.assertFalse(res1.get("already_published", False))

        # Gọi lại lần 2 không gây lỗi và trả về already_published
        self.draft.refresh_from_db()
        res2 = publish_draft_to_facebook(self.draft, target_id=str(self.target.target_id))
        self.assertTrue(res2.get("already_published", False))
        self.assertEqual(res2["url"], res1["url"])


class BotGroupQueueTests(TestCase):
    def setUp(self):
        from .bot_models import FbDraftPost, FbPublishTarget
        self.group = FbPublishTarget.objects.create(
            name="Cộng đồng Toán Fermat",
            target_type="group",
            target_id="group_123456789",
            is_active=True
        )
        self.draft = FbDraftPost.objects.create(
            bot_creator="writer",
            title="Bài viết hướng dẫn giải toán nhóm",
            content="Nội dung bài viết mẫu",
            hashtags="#toan #fermat",
            status="approved"
        )

    def test_get_group_queue(self):
        resp = self.client.get("/api/social-bot/group-queue")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "ok")
        self.assertTrue(any(d["id"] == self.draft.id for d in data["drafts"]))
        self.assertTrue(any(g["target_id"] == "group_123456789" for g in data["groups"]))

    def test_post_group_queue_done(self):
        post_url = "https://facebook.com/groups/group_123456789/posts/999888"
        resp = self.client.post(
            f"/api/social-bot/group-queue/{self.draft.id}/done",
            data=json.dumps({"post_url": post_url}),
            content_type="application/json"
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "ok")

        self.draft.refresh_from_db()
        self.assertEqual(self.draft.status, "published")
        self.assertEqual(self.draft.fb_post_url, post_url)
        self.assertIsNotNone(self.draft.published_at)



