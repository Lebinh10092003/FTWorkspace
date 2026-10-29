"""Phân mảng cho khoản thu chi: Khảo thí hay Công nghệ số & Đào tạo.

Quy tắc chủ dự án đã chốt:
- Khảo thí: khoản gắn với cuộc thi/kỳ thi (FIMO, FIEO, SIAIO, SCO…), lệ phí dự thi,
  coi thi, phòng thi, đề thi, giải thưởng.
- Công nghệ số & Đào tạo: hợp đồng khách hàng/trường đối tác, BNDC, tài khoản AI,
  khóa đào tạo, giảng viên.
- Không khớp rõ, hoặc khớp cả hai: không đoán, phải hỏi người dùng.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Iterable, List, Optional, Tuple

EXAMINATION = "examination"
DIGITAL_TRAINING = "digital_training"
DIVISION_CHOICES = [
    (EXAMINATION, "Khảo thí"),
    (DIGITAL_TRAINING, "Công nghệ số & Đào tạo"),
]
DIVISION_LABELS = dict(DIVISION_CHOICES)

# Viết không dấu, chữ thường. So khớp theo ranh giới từ.
EXAMINATION_KEYWORDS = (
    "khao thi", "ky thi", "cuoc thi", "le phi thi", "le phi du thi", "phi du thi", "du thi",
    "thi sinh", "coi thi", "giam thi", "phong thi", "de thi", "ra de", "cham thi",
    "giai thuong", "trao giai", "sbd", "vong thi", "olympiad",
    "fimo", "fieo", "siaio", "sco",
)
DIGITAL_TRAINING_KEYWORDS = (
    "cong nghe so", "dao tao", "dao tao so", "khoa hoc", "khoa dao tao", "lop hoc", "tap huan",
    "giang vien", "bndc", "ban quyen", "tai khoan ai", "goi dich vu", "phan mem", "hop dong",
    "gia han", "chuyen doi so",
)


def fold(text: str) -> str:
    """Bỏ dấu tiếng Việt, đổi đ → d, chữ thường."""
    value = unicodedata.normalize("NFD", str(text or "")).replace("đ", "d").replace("Đ", "D")
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", value.lower()).strip()


def _hits(text: str, keywords: Iterable[str]) -> List[str]:
    found = []
    for word in keywords:
        word = fold(word)
        if word and re.search(rf"(?<![a-z0-9]){re.escape(word)}(?![a-z0-9])", text):
            found.append(word)
    return found


def _competition_codes() -> List[str]:
    try:
        from examination.models import Competition

        return [code for code in Competition.objects.values_list("code", flat=True) if code and len(code) >= 3]
    except Exception:  # Bảng chưa có (migration) thì chỉ dùng từ khóa tĩnh.
        return []


def classify_division(*texts: str) -> Tuple[Optional[str], List[str], List[str]]:
    """Trả về (mảng, từ khóa Khảo thí, từ khóa CNS&ĐT). Mảng là None khi không chắc."""
    text = fold(" ".join(str(t or "") for t in texts))
    exam = _hits(text, tuple(EXAMINATION_KEYWORDS) + tuple(_competition_codes()))
    training = _hits(text, DIGITAL_TRAINING_KEYWORDS)
    # "đào tạo" nằm trong "khóa đào tạo"… nên chỉ cần so số mảng khớp, không so số từ.
    if exam and not training:
        return EXAMINATION, exam, training
    if training and not exam:
        return DIGITAL_TRAINING, exam, training
    return None, exam, training


def division_question(exam_hits: List[str], training_hits: List[str]) -> str:
    if exam_hits and training_hits:
        reason = (
            f"Nội dung có dấu hiệu của cả Khảo thí ({', '.join(exam_hits)}) "
            f"và Công nghệ số & Đào tạo ({', '.join(training_hits)})."
        )
    else:
        reason = "Nội dung chưa đủ để biết khoản này thuộc mảng nào."
    return (
        f"{reason} Hãy hỏi người dùng: khoản này ghi vào thu chi của Khảo thí "
        "(cuộc thi/kỳ thi, lệ phí dự thi, coi thi, đề thi, giải thưởng) hay Công nghệ số & Đào tạo "
        "(hợp đồng khách hàng, BNDC, tài khoản AI, khóa đào tạo, giảng viên)? "
        "Sau đó gọi lại với division='examination' hoặc 'digital_training'."
    )


_MONEY_RE = re.compile(
    r"\d[\d.,]*\s*(?:vnd|dong|d\b|k\b|tr\b|trieu|ty|nghin|ngan)|\d{1,3}(?:[.,]\d{3}){1,}|\d{5,}"
)
_FINANCE_WORDS = (
    "doanh thu", "da thu", "thu tien", "khoan thu", "khoan chi", "chi phi", "thanh toan", "chuyen khoan",
    "cong no", "tam ung", "hoa don", "le phi", "hoc phi", "nop tien", "tien mat",
)


def looks_like_finance_record(text: str) -> bool:
    """Ghi chú có số tiền và từ thu/chi: là khoản thu chi, phải ghi vào Báo cáo thu chi."""
    folded = fold(text)
    return bool(_MONEY_RE.search(folded)) and bool(_hits(folded, _FINANCE_WORDS))


FINANCE_NOTE_REDIRECT = (
    "Nội dung này là doanh thu/khoản thu chi. Không ghi vào ghi chú khách hàng: dùng công cụ "
    "finance_create_entry để ghi vào Báo cáo thu chi (/finance-report), chọn mảng Khảo thí hoặc "
    "Công nghệ số & Đào tạo (không rõ thì hỏi người dùng). Nếu người dùng nói rõ chỉ muốn lưu ghi chú "
    "chăm sóc, gọi lại với not_finance_record=true."
)
