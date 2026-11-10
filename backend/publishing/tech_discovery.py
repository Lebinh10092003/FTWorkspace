"""Tech crawler and AI-driven deep analysis for daily topic suggestions."""

from __future__ import annotations

import json
import logging
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone as dt_timezone
from typing import Any, Dict, List, Optional

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from authentication.models import UserProfile
from documents.ai_service import execute_ai_command
from .models import PostPlan, PostVariant, PublishChannel, TechTopicSuggestion
from .service import enqueue_publish_ai_job

logger = logging.getLogger(__name__)

USER_AGENT = "FTWorkspace-TechBot/1.0 (+https://workspace.fermat.vn)"
REQUEST_TIMEOUT = 12


def _clean_text(text: Optional[str]) -> str:
    """Clean whitespace, newlines, and strip markdown artifacts."""
    if not text:
        return ""
    cleaned = re.sub(r"\s+", " ", text).strip()
    return cleaned


def fetch_arxiv_papers(limit: int = 5, query: str = "cat:cs.AI OR cat:cs.LG OR cat:cs.CL") -> List[Dict[str, Any]]:
    """Fetch latest AI/ML papers from official arXiv Atom feed."""
    encoded_query = urllib.parse.quote(query)
    url = (
        f"http://export.arxiv.org/api/query?search_query={encoded_query}"
        f"&sortBy=submittedDate&sortOrder=descending&max_results={max(1, min(limit, 20))}"
    )
    items: List[Dict[str, Any]] = []

    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            content = resp.read()

        root = ET.fromstring(content)
        # Atom namespace
        ns = {"atom": "http://www.w3.org/2005/Atom"}

        for entry in root.findall("atom:entry", ns):
            entry_id = _clean_text(entry.findtext("atom:id", default="", namespaces=ns))
            title = _clean_text(entry.findtext("atom:title", default="", namespaces=ns))
            summary = _clean_text(entry.findtext("atom:summary", default="", namespaces=ns))
            published_str = entry.findtext("atom:published", default="", namespaces=ns)

            authors = []
            for author in entry.findall("atom:author", ns):
                name = author.findtext("atom:name", default="", namespaces=ns)
                if name:
                    authors.append(name.strip())

            # URL extraction
            link_url = entry_id
            for link in entry.findall("atom:link", ns):
                if link.attrib.get("type") == "text/html" or link.attrib.get("rel") == "alternate":
                    link_url = link.attrib.get("href", link_url)
                    break

            pub_dt = parse_datetime(published_str) if published_str else None

            # Categorize
            category = TechTopicSuggestion.CATEGORY_AI_ML
            lowered = (title + " " + summary).lower()
            if any(k in lowered for k in ["agent", "multi-agent", "workflow", "tool use", "autonomous"]):
                category = TechTopicSuggestion.CATEGORY_AGENTIC
            elif any(k in lowered for k in ["education", "exam", "assessment", "student", "teacher", "tutoring"]):
                category = TechTopicSuggestion.CATEGORY_EDTECH

            items.append({
                "source": TechTopicSuggestion.SOURCE_ARXIV,
                "external_id": entry_id,
                "title": title,
                "source_url": link_url,
                "author": ", ".join(authors[:3]) if authors else "arXiv Authors",
                "published_date": pub_dt or timezone.now(),
                "raw_summary": summary[:2500],
                "category": category,
            })
    except Exception as exc:
        logger.warning("Error fetching arXiv papers: %s", exc)

    return items


def fetch_hacker_news_ai(limit: int = 5) -> List[Dict[str, Any]]:
    """Fetch trending AI stories from Hacker News via Algolia public search API."""
    url = (
        "https://hn.algolia.com/api/v1/search?query=AI%20OR%20LLM%20OR%20Claude%20OR%20GPT"
        f"&tags=story&hitsPerPage={max(1, min(limit, 20))}"
    )
    items: List[Dict[str, Any]] = []

    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        hits = data.get("hits", [])
        for hit in hits:
            obj_id = str(hit.get("objectID") or "")
            title = _clean_text(hit.get("title"))
            story_url = hit.get("url") or f"https://news.ycombinator.com/item?id={obj_id}"
            author = hit.get("author") or "HN Community"
            created_at_i = hit.get("created_at_i")
            pub_dt = (
                datetime.fromtimestamp(created_at_i, tz=dt_timezone.utc)
                if created_at_i
                else timezone.now()
            )
            story_text = _clean_text(hit.get("story_text") or "")
            points = hit.get("points") or 0
            comments = hit.get("num_comments") or 0
            summary = f"{story_text}\n(Hacker News: {points} điểm, {comments} bình luận)".strip()

            category = TechTopicSuggestion.CATEGORY_GENERAL_TECH
            lowered = (title + " " + summary).lower()
            if any(k in lowered for k in ["agent", "agentic", "tool", "copilot"]):
                category = TechTopicSuggestion.CATEGORY_AGENTIC
            elif any(k in lowered for k in ["llm", "deep learning", "neural", "gpt", "gemini", "claude"]):
                category = TechTopicSuggestion.CATEGORY_AI_ML

            items.append({
                "source": TechTopicSuggestion.SOURCE_HACKERNEWS,
                "external_id": f"hn_{obj_id}",
                "title": title,
                "source_url": story_url,
                "author": author,
                "published_date": pub_dt,
                "raw_summary": summary[:2500],
                "category": category,
            })
    except Exception as exc:
        logger.warning("Error fetching Hacker News AI stories: %s", exc)

    return items


def fetch_huggingface_daily_papers(limit: int = 5) -> List[Dict[str, Any]]:
    """Fetch top trending daily papers from Hugging Face Papers API."""
    url = f"https://huggingface.co/api/daily_papers?limit={max(1, min(limit, 20))}"
    items: List[Dict[str, Any]] = []

    try:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        papers = data if isinstance(data, list) else data.get("papers", [])
        for p in papers[:limit]:
            paper_info = p.get("paper", p)
            paper_id = paper_info.get("id") or str(p.get("id") or "")
            title = _clean_text(paper_info.get("title") or "")
            summary = _clean_text(paper_info.get("summary") or "")
            source_url = f"https://huggingface.co/papers/{paper_id}" if paper_id else "https://huggingface.co/papers"
            pub_str = paper_info.get("publishedAt") or p.get("publishedAt")
            pub_dt = parse_datetime(pub_str) if pub_str else timezone.now()

            category = TechTopicSuggestion.CATEGORY_AI_ML
            lowered = (title + " " + summary).lower()
            if any(k in lowered for k in ["agent", "workflow", "reasoning", "benchmark"]):
                category = TechTopicSuggestion.CATEGORY_AGENTIC

            items.append({
                "source": TechTopicSuggestion.SOURCE_HUGGINGFACE,
                "external_id": f"hf_{paper_id}",
                "title": title,
                "source_url": source_url,
                "author": "Hugging Face Daily Papers",
                "published_date": pub_dt or timezone.now(),
                "raw_summary": summary[:2500],
                "category": category,
            })
    except Exception as exc:
        logger.warning("Error fetching Hugging Face daily papers: %s", exc)

    return items


def get_curated_fallback_topics() -> List[Dict[str, Any]]:
    """Fallback high-quality topics when external internet feeds are unavailable or during tests."""
    now = timezone.now()
    return [
        {
            "source": TechTopicSuggestion.SOURCE_ARXIV,
            "external_id": "fallback_arxiv_llm_reasoning",
            "title": "Scaling Test-Time Compute vs Pre-training: Frontier Reasoning in Modern LLMs",
            "source_url": "https://arxiv.org/abs/2410.00001",
            "author": "Research Collective",
            "published_date": now,
            "raw_summary": "Phân tích cơ chế suy luận thời gian thực (test-time compute) và tác động đến chi phí triển khai mô hình AI trong doanh nghiệp.",
            "category": TechTopicSuggestion.CATEGORY_AI_ML,
        },
        {
            "source": TechTopicSuggestion.SOURCE_HACKERNEWS,
            "external_id": "fallback_hn_autonomous_agents",
            "title": "Production-Ready Multi-Agent Workflows: Lessons from 100K Active Deployments",
            "source_url": "https://news.ycombinator.com/item?id=40000001",
            "author": "TechArchitect",
            "published_date": now,
            "raw_summary": "Kinh nghiệm thực tiễn thiết kế kiến trúc AI Agent tự động hóa xử lý tài liệu, phân quyền và kiểm soát rủi ro dữ liệu.",
            "category": TechTopicSuggestion.CATEGORY_AGENTIC,
        },
    ]


def deep_analyze_topic(topic_data: Dict[str, Any]) -> Dict[str, Any]:
    """Perform deep technical analysis via LLM (or robust heuristic fallback) to produce key takeaways."""
    title = topic_data.get("title", "")
    summary = topic_data.get("raw_summary", "")
    source_url = topic_data.get("source_url", "")
    category = topic_data.get("category", TechTopicSuggestion.CATEGORY_AI_ML)

    prompt = f"""Bạn là Chuyên gia phân tích AI và kiến trúc sư giải pháp công nghệ cấp cao tại Việt Nam.
Hãy đọc thông tin bài nghiên cứu/chủ đề công nghệ sau:

- Tiêu đề: {title}
- Nguồn tham khảo: {source_url}
- Tóm tắt nội dung gốc: {summary}
- Chuyên mục: {category}

Nhiệm vụ: Phân tích sâu nội dung trên và trả về kết quả ĐÚNG định dạng JSON sau (không kèm markdown ngoài block json):
{{
  "key_takeaways": [
    "Điểm đột phá kỹ thuật 1 (súc tích, có dẫn chứng cốt lõi)",
    "Giá trị thực tế và so sánh với phương pháp trước đây",
    "Thách thức hoặc điểm cần lưu ý khi ứng dụng"
  ],
  "suggested_angle": "Định hướng phân tích sâu cho cộng đồng công nghệ & doanh nghiệp Việt Nam (2-3 câu ngắn gọn)",
  "target_audience": "Đối tượng độc giả mục tiêu phù hợp nhất",
  "recommended_base_post": "Nội dung bài viết phân tích mẫu (300-500 từ, định dạng Markdown rõ ràng, kèm tiêu đề, phân tích cốt lõi và bài học thực tiễn)."
}}
"""
    try:
        raw_output = execute_ai_command(prompt)
        # Extract JSON
        clean_json = raw_output.strip()
        match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", clean_json, re.DOTALL)
        if match:
            clean_json = match.group(1)
        data = json.loads(clean_json)

        return {
            "key_takeaways": data.get("key_takeaways", []),
            "suggested_angle": data.get("suggested_angle", ""),
            "target_audience": data.get("target_audience", "Kỹ sư công nghệ, nhà quản trị và cộng đồng AI"),
            "recommended_base_post": data.get("recommended_base_post", ""),
        }
    except Exception as exc:
        logger.info("AI analysis fallback for '%s': %s", title, exc)
        # Fallback heuristic analysis
        takeaways = [
            f"Đột phá công nghệ mới trong lĩnh vực {category.replace('_', ' ').title()}.",
            "Tối ưu hóa hiệu năng và khả năng ứng dụng thực tế vào sản phẩm phần mềm.",
            f"Thông tin chi tiết và mã nguồn kiểm chứng tại nguồn tham khảo ({source_url}).",
        ]
        angle = f"Phân tích chuyên sâu về tác động của {title} đối với các giải pháp EdTech và quy trình tự động hóa doanh nghiệp."
        recommended_post = (
            f"### Khám phá công nghệ: {title}\n\n"
            f"**1. Bối cảnh & Điểm đột phá**\n{summary}\n\n"
            f"**2. Ý nghĩa thực tiễn**\nNghiên cứu mang lại tiềm năng ứng dụng lớn cho các bài toán phân tích dữ liệu và tự động hóa quy trình.\n\n"
            f"**3. Nguồn tham khảo**\nXem chi tiết công bố tại: {source_url}"
        )
        return {
            "key_takeaways": takeaways,
            "suggested_angle": angle,
            "target_audience": "Kỹ sư công nghệ, nhà quản trị và cộng đồng AI",
            "recommended_base_post": recommended_post,
        }


def crawl_and_suggest_daily_topics(
    limit_per_source: int = 3,
    use_fallback_if_empty: bool = True,
) -> List[TechTopicSuggestion]:
    """Crawl external sources, perform AI deep analysis, and store TechTopicSuggestion records."""
    raw_topics: List[Dict[str, Any]] = []

    # 1. Fetch arXiv
    raw_topics.extend(fetch_arxiv_papers(limit=limit_per_source))
    # 2. Fetch Hacker News
    raw_topics.extend(fetch_hacker_news_ai(limit=limit_per_source))
    # 3. Fetch Hugging Face
    raw_topics.extend(fetch_huggingface_daily_papers(limit=limit_per_source))

    if not raw_topics and use_fallback_if_empty:
        raw_topics.extend(get_curated_fallback_topics())

    created_or_updated: List[TechTopicSuggestion] = []

    for item in raw_topics:
        external_id = str(item.get("external_id") or item.get("source_url") or item.get("title") or "")
        title = item.get("title", "")
        if not title:
            continue

        existing = TechTopicSuggestion.objects.filter(external_id=external_id).first()
        if existing:
            created_or_updated.append(existing)
            continue

        # Perform deep analysis
        analysis = deep_analyze_topic(item)

        topic = TechTopicSuggestion.objects.create(
            title=title[:500],
            source=item.get("source", TechTopicSuggestion.SOURCE_ARXIV),
            source_url=item.get("source_url", ""),
            external_id=external_id[:255],
            author=item.get("author", "")[:255],
            published_date=item.get("published_date") or timezone.now(),
            raw_summary=item.get("raw_summary", ""),
            category=item.get("category", TechTopicSuggestion.CATEGORY_AI_ML),
            key_takeaways=analysis.get("key_takeaways", []),
            suggested_angle=analysis.get("suggested_angle", ""),
            target_audience=analysis.get("target_audience", "Kỹ sư công nghệ, nhà quản trị và cộng đồng AI"),
        )
        created_or_updated.append(topic)

    return created_or_updated


def convert_topic_to_post_plan(
    topic: TechTopicSuggestion,
    user: UserProfile,
    auto_generate_variants: bool = True,
    custom_instructions: str = "",
) -> PostPlan:
    """Convert a discovered tech topic into a concrete PostPlan with formatted base content and optional AI variants."""
    with transaction.atomic():
        if topic.created_plan:
            return topic.created_plan

        takeaways_md = "\n".join(f"- {pt}" for pt in topic.key_takeaways) if topic.key_takeaways else ""
        base_content_parts = [
            f"# {topic.title}\n",
            f"**Chủ đề & Nguồn tham khảo**: [{topic.get_source_display()}]({topic.source_url})",
            f"**Tác giả / Nhóm nghiên cứu**: {topic.author or 'Cộng đồng công nghệ'}\n",
            f"## Tóm tắt & Bối cảnh\n{topic.raw_summary}\n",
        ]

        if takeaways_md:
            base_content_parts.append(f"## Các điểm đột phá then chốt\n{takeaways_md}\n")

        if topic.suggested_angle:
            base_content_parts.append(f"## Định hướng phân tích & Ứng dụng\n{topic.suggested_angle}\n")

        if custom_instructions:
            base_content_parts.append(f"## Chỉ dẫn biên tập bổ sung\n{custom_instructions}\n")

        base_content_parts.append(f"🔗 Xem tài liệu gốc tại: {topic.source_url}")

        plan = PostPlan.objects.create(
            title=f"[Công nghệ] {topic.title}"[:255],
            base_content="\n\n".join(base_content_parts),
            creator=user,
            status=PostPlan.STATUS_DRAFT,
        )

        topic.is_converted_to_plan = True
        topic.created_plan = plan
        topic.save(update_fields=["is_converted_to_plan", "created_plan", "updated_at"])

    if auto_generate_variants:
        try:
            active_channels = list(PublishChannel.objects.filter(is_active=True))
            if active_channels:
                enqueue_publish_ai_job(plan=plan, user=user, channel_ids=[c.id for c in active_channels])
        except Exception as exc:
            logger.warning("Could not auto-enqueue AI variants for plan #%d: %s", plan.id, exc)

    return plan
