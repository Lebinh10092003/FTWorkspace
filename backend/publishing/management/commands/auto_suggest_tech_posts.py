"""Management command to crawl tech papers, analyze breakthroughs, and suggest daily post plans."""

from __future__ import annotations

import logging
from django.core.management.base import BaseCommand
from django.utils import timezone

from authentication.models import UserProfile
from publishing.models import TechTopicSuggestion
from publishing.tech_discovery import crawl_and_suggest_daily_topics, convert_topic_to_post_plan

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Crawl daily tech research/news (arXiv, HackerNews, HuggingFace), analyze breakthroughs and suggest post plans."

    def add_arguments(self, parser):
        parser.add_argument(
            "--limit",
            type=int,
            default=3,
            help="Số lượng bài viết/nghiên cứu tối đa cần thu thập từ mỗi nguồn (mặc định 3).",
        )
        parser.add_argument(
            "--auto-plan",
            action="store_true",
            help="Tự động tạo bản ghi PostPlan nháp cho các chủ đề vừa thu thập.",
        )
        parser.add_argument(
            "--user-email",
            type=str,
            default="",
            help="Email của người dùng tạo kế hoạch khi dùng --auto-plan (mặc định lấy admin đầu tiên).",
        )

    def handle(self, *args, **options):
        limit = options["limit"]
        auto_plan = options["auto_plan"]
        user_email = options["user_email"]

        self.stdout.write(self.style.NOTICE(f"[{timezone.now()}] Bắt đầu thu thập & phân tích chủ đề công nghệ hàng ngày..."))

        topics = crawl_and_suggest_daily_topics(limit_per_source=limit)
        self.stdout.write(self.style.SUCCESS(f"-> Thu thập thành công {len(topics)} chủ đề công nghệ."))

        for idx, topic in enumerate(topics, 1):
            self.stdout.write(
                f"  {idx}. [{topic.get_source_display()}] {topic.title[:70]}... "
                f"({'Đã tạo plan' if topic.is_converted_to_plan else 'Chưa tạo plan'})"
            )

        if auto_plan and topics:
            user = None
            if user_email:
                user = UserProfile.objects.filter(email=user_email).first()
            if not user:
                user = UserProfile.objects.filter(role__in=["ADMIN", "MANAGER"]).first() or UserProfile.objects.first()

            if not user:
                self.stdout.write(self.style.ERROR("Không tìm thấy người dùng hợp lệ để tự động tạo PostPlan."))
                return

            converted_count = 0
            for topic in topics:
                if not topic.is_converted_to_plan:
                    plan = convert_topic_to_post_plan(topic, user=user, auto_generate_variants=True)
                    self.stdout.write(self.style.SUCCESS(f"  + Đã tạo PostPlan #{plan.id}: '{plan.title}'"))
                    converted_count += 1

            self.stdout.write(self.style.SUCCESS(f"-> Đã chuyển đổi {converted_count} chủ đề thành kế hoạch đăng bài."))

        self.stdout.write(self.style.SUCCESS("Hoàn tất tác vụ thu thập & gợi ý chủ đề công nghệ."))
