from django.db import models

class Channel(models.Model):
    id = models.CharField(max_length=255, primary_key=True)
    platform = models.CharField(max_length=50)
    name = models.CharField(max_length=255)
    external_id = models.CharField(max_length=255)
    status = models.CharField(max_length=50, default='active')
    timezone = models.CharField(max_length=100, default='Asia/Bangkok')
    created_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    last_sync_at = models.DateTimeField(null=True, blank=True)
    # End of the last fully covered API query window. This is separate from
    # last_sync_at so posts created while a long sync is running are not skipped.
    last_data_sync_until = models.DateTimeField(null=True, blank=True)
    last_sync_status = models.CharField(max_length=50, null=True, blank=True)
    follower_history_loaded_at = models.DateTimeField(null=True, blank=True)
    # Page-level metric history is independently backfilled once and then refreshed daily.
    metric_history_loaded_at = models.DateTimeField(null=True, blank=True)
    # A channel is not ready for the cheap daily refresh until posts, post
    # metrics and follower history have all been saved for the initial period.
    initial_sync_completed_at = models.DateTimeField(null=True, blank=True)
    total_posts = models.IntegerField(default=0)
    followers_count = models.IntegerField(default=0)

    def __str__(self):
        return f"{self.name} ({self.platform})"

class Post(models.Model):
    post_key = models.CharField(max_length=255, primary_key=True)
    platform = models.CharField(max_length=50)
    channel_id = models.CharField(max_length=255)
    external_post_id = models.CharField(max_length=255)
    post_url = models.CharField(max_length=1000)
    image_url = models.CharField(max_length=1000, blank=True, null=True)
    post_type = models.CharField(max_length=50)
    message = models.TextField(blank=True, null=True)
    published_at = models.DateTimeField()
    imported_at = models.DateTimeField()
    updated_at = models.DateTimeField()
    is_deleted = models.BooleanField(default=False)

    class Meta:
        indexes = [
            models.Index(fields=["channel_id", "published_at"], name="social_post_channel_date"),
        ]

    def __str__(self):
        return f"{self.platform} post {self.post_key}"

class DailySnapshot(models.Model):
    snapshot_key = models.CharField(max_length=255, primary_key=True)
    snapshot_date = models.CharField(max_length=50)  # yyyy-MM-dd
    platform = models.CharField(max_length=50)
    channel_id = models.CharField(max_length=255)
    post_key = models.CharField(max_length=255)
    reactions = models.IntegerField(default=0)
    likes = models.IntegerField(default=0)
    comments = models.IntegerField(default=0)
    shares = models.IntegerField(default=0)
    views = models.IntegerField(default=0)
    reach = models.IntegerField(default=0)
    impressions = models.IntegerField(default=0)
    clicks = models.IntegerField(default=0)
    total_engagement = models.IntegerField(default=0)
    engagement_rate = models.FloatField(null=True, blank=True)
    fetched_at = models.DateTimeField()

    class Meta:
        indexes = [
            models.Index(fields=["channel_id", "snapshot_date"], name="social_daily_channel_date"),
            models.Index(fields=["post_key", "snapshot_date"], name="social_daily_post_date"),
        ]

    def __str__(self):
        return f"Snapshot {self.snapshot_key}"

class FollowerSnapshot(models.Model):
    snapshot_key = models.CharField(max_length=255, primary_key=True)
    snapshot_date = models.CharField(max_length=50)
    channel_id = models.CharField(max_length=255)
    channel_name = models.CharField(max_length=255)
    followers_count = models.IntegerField(default=0)
    daily_follows_unique = models.IntegerField(null=True, blank=True)
    daily_unfollows_unique = models.IntegerField(null=True, blank=True)
    fetched_at = models.DateTimeField()

    class Meta:
        indexes = [
            models.Index(fields=["channel_id", "snapshot_date"], name="social_follow_channel_date"),
        ]

    def __str__(self):
        return f"{self.channel_name} on {self.snapshot_date}"

class ChannelMetricSnapshot(models.Model):
    """Compact daily Page-level performance history used by period reports."""

    snapshot_key = models.CharField(max_length=255, primary_key=True)
    snapshot_date = models.CharField(max_length=50)  # yyyy-MM-dd
    channel_id = models.CharField(max_length=255)
    views = models.IntegerField(default=0)
    engagement = models.IntegerField(default=0)
    fetched_at = models.DateTimeField()

    class Meta:
        indexes = [
            models.Index(fields=["channel_id", "snapshot_date"], name="social_channel_metric_date"),
        ]

    def __str__(self):
        return f"Channel metrics {self.channel_id} on {self.snapshot_date}"

class ApiLog(models.Model):
    log_id = models.CharField(max_length=255, primary_key=True)
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    platform = models.CharField(max_length=50)
    action = models.CharField(max_length=100)
    channel_id = models.CharField(max_length=255, null=True, blank=True)
    status = models.CharField(max_length=50, default='running')
    records_received = models.IntegerField(default=0)
    records_inserted = models.IntegerField(default=0)
    records_updated = models.IntegerField(default=0)
    error_code = models.CharField(max_length=100, null=True, blank=True)
    error_message = models.TextField(null=True, blank=True)
    request_id = models.CharField(max_length=255)

    def __str__(self):
        return f"Log {self.log_id} ({self.status})"

from .bot_models import *
