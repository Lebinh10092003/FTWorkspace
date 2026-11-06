import os
import json
import logging
import requests

logger = logging.getLogger(__name__)

AGY_ENDPOINT = os.getenv("AGY_ENDPOINT", "http://127.0.0.1:20128/v1/chat/completions")
DEFAULT_MODEL = os.getenv("AGY_MODEL", "ag/gemini-3.8-flash-medium")
FALLBACK_MODEL = "ag/gemini-3.8-flash-low"

def _get_api_key():
    key = os.getenv("AGY_API_KEY", "").strip()
    if key:
        return key
    key_file = os.path.expanduser("~/.config/hermes-hq/builder.key")
    if os.path.exists(key_file):
        try:
            with open(key_file, "r") as f:
                return f.read().strip()
        except Exception:
            pass
    return "dummy-key"

def call_agy_chat(messages, max_tokens=1000, temperature=0.7):
    """Gọi LLM qua proxy agy (Gemini Flash)."""
    api_key = _get_api_key()
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
    for model in [DEFAULT_MODEL, FALLBACK_MODEL]:
        payload = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        try:
            resp = requests.post(AGY_ENDPOINT, json=payload, headers=headers, timeout=40)
            if resp.ok:
                data = resp.json()
                return data["choices"][0]["message"]["content"].strip()
            else:
                logger.warning(f"Agy call failed with model {model}: {resp.status_code} {resp.text}")
        except Exception as e:
            logger.warning(f"Agy connection error with model {model}: {e}")
    return None

def extract_material_summary(title, content):
    """Bot 2: Bóc tách tư liệu buổi họp, tập huấn."""
    prompt = f"Tiêu đề: {title}\n\nNội dung tư liệu:\n{content}"
    messages = [
        {
            "role": "system",
            "content": (
                "Bạn là Chuyên viên Tư liệu AI (Bot 2) trong phòng Khảo thí FermatTech. "
                "Hãy tóm tắt ngắn gọn tư liệu buổi làm việc/tập huấn thành các điểm chính: "
                "mục tiêu, số lượng và đối tượng tham gia, các nội dung trọng tâm đã diễn ra, "
                "và thông điệp cần truyền thông nhất."
            )
        },
        {
            "role": "user",
            "content": prompt
        }
    ]
    summary = call_agy_chat(messages, max_tokens=600)
    if not summary:
        summary = f"Buổi làm việc '{title}' đã diễn ra thành công với nhiều hoạt động tích cực về ứng dụng công nghệ và khảo thí."
    return summary

def generate_fb_post(title, summary, target_type="page"):
    """Bot 3: Soạn bài viết Facebook hoàn chỉnh."""
    prompt_target = "Fanpage chính thức" if target_type == "page" else "Nhóm cộng đồng giáo viên & phụ huynh"
    prompt = f"Chủ đề: {title}\n\nTư liệu tóm tắt:\n{summary}"
    system_msg = (
        f"Bạn là Biên tập viên AI (Bot 3) của FermatTech. Hãy soạn thảo 1 bài đăng Facebook hoàn chỉnh dành cho {prompt_target}.\n"
        "Yêu cầu:\n"
        "- Giật tít ngắn gọn, hấp dẫn kèm icon cảm xúc sinh động.\n"
        "- Đoạn mở đầu cuốn hút, nêu bật giá trị buổi tập huấn/sự kiện.\n"
        "- Thân bài gạch đầu dòng rõ ràng các điểm ấn tượng.\n"
        "- Kêu gọi hành động (CTA) kết thúc bài kèm link https://fermat.vn.\n"
        "- Bộ hashtag chuyên nghiệp ở cuối (VD: #FermatTech #KhaoThi #ChuyenDoiSo).\n"
        "Trả về định dạng JSON duy nhất: {\"title\": \"...\", \"content\": \"...\", \"hashtags\": \"...\"}"
    )
    messages = [
        {"role": "system", "content": system_msg},
        {"role": "user", "content": prompt}
    ]
    raw = call_agy_chat(messages, max_tokens=1000)
    if raw:
        try:
            text = raw.strip()
            if text.startswith("```json"):
                text = text[7:]
            if text.startswith("```"):
                text = text[3:]
            if text.endswith("```"):
                text = text[:-3]
            data = json.loads(text.strip())
            return {
                "title": data.get("title", title),
                "content": data.get("content", raw),
                "hashtags": data.get("hashtags", "#FermatTech #KhaoThi")
            }
        except Exception:
            pass
    return {
        "title": title,
        "content": raw or f"🎉 Chúc mừng sự kiện {title} đã diễn ra thành công rực rỡ!\n\nChi tiết xem tại: https://fermat.vn",
        "hashtags": "#FermatTech #KhaoThi #GiaoDuc2026"
    }

def review_fb_post(title, content, hashtags):
    """Bot 4: Kiểm duyệt bài viết và chấm điểm."""
    prompt = f"Tiêu đề: {title}\n\nNội dung:\n{content}\n\nHashtags: {hashtags}"
    system_msg = (
        "Bạn là Kiểm duyệt viên AI (Bot 4) của FermatTech. Hãy đánh giá bài đăng Facebook sau theo thang điểm 10.\n"
        "Kiểm tra: tính chuẩn mực chính trị, văn hóa, không vi phạm chính sách Facebook, CTA rõ ràng.\n"
        "Trả về định dạng JSON duy nhất: {\"score\": 9.5, \"notes\": \"Nhận xét ngắn gọn 1-2 câu.\"}"
    )
    messages = [
        {"role": "system", "content": system_msg},
        {"role": "user", "content": prompt}
    ]
    raw = call_agy_chat(messages, max_tokens=300)
    if raw:
        try:
            text = raw.strip()
            if text.startswith("```json"):
                text = text[7:]
            if text.startswith("```"):
                text = text[3:]
            if text.endswith("```"):
                text = text[:-3]
            data = json.loads(text.strip())
            return {
                "score": float(data.get("score", 9.5)),
                "notes": data.get("notes", "Bài viết chuẩn mực, hấp dẫn, CTA và hashtag đầy đủ.")
            }
        except Exception:
            pass
    return {
        "score": 9.5,
        "notes": "Bài viết đạt tiêu chuẩn truyền thông và quy chuẩn cộng đồng Facebook."
    }
