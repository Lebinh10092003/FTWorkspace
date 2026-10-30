import re
import unicodedata

# Ký tự bị cấm trên hệ điều hành Windows và macOS: \ / : * ? " < > |
FORBIDDEN_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|]')

# Ký tự điều khiển (ASCII 0-31 và 127-159)
CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f]")

# Regex phát hiện emoji, biểu tượng đồ họa, variation selectors, zero-width joiners
EMOJI_PATTERN = re.compile(
    "["
    "\U00010000-\U0010ffff"  # Supplementary Multilingual Plane (bao gồm emojis, pictographs)
    "\u2600-\u27bf"          # Miscellaneous Symbols và Dingbats
    "\u2300-\u23ff"          # Miscellaneous Technical
    "\u2b50-\u2b55"          # Ngôi sao và ký hiệu đặc biệt
    "\ufe00-\ufe0f"          # Variation selectors
    "\u200d"                 # Zero-width joiner
    "\u20e3"                 # Combining enclosing keycap
    "]+",
    flags=re.UNICODE,
)

DOCX_EXTENSION = ".docx"
MAX_FILENAME_LENGTH = 120
MAX_STEM_LENGTH = MAX_FILENAME_LENGTH - len(DOCX_EXTENSION)  # 115 ký tự


def sanitize_docx_filename(filename: str, default_stem: str = "tai-lieu") -> str:
    """Làm sạch tên file Word (.docx) theo chuẩn công ty:

    1. Bỏ ký tự cấm trên Windows/macOS (\\ / : * ? " < > |), ký tự điều khiển, emoji.
    2. Gộp khoảng trắng liên tiếp, loại bỏ khoảng trắng thừa đầu/cuối.
    3. Độ dài tối đa ~120 ký tự (tính cả .docx, cắt ở ranh giới từ).
    4. Không để dấu chấm hoặc khoảng trắng cuối trước đuôi .docx.
    5. Đuôi file luôn là .docx.
    """
    if not filename or not isinstance(filename, str):
        return f"{default_stem}{DOCX_EXTENSION}"

    name = filename.strip()
    if name.lower().endswith(DOCX_EXTENSION):
        stem = name[:-len(DOCX_EXTENSION)]
    else:
        stem = name

    # Thay thế emoji và ký tự điều khiển bằng khoảng trắng
    stem = EMOJI_PATTERN.sub(" ", stem)
    stem = CONTROL_CHARS.sub(" ", stem)

    # Thay thế ký tự cấm trên Windows/macOS bằng khoảng trắng
    stem = FORBIDDEN_FILENAME_CHARS.sub(" ", stem)

    # Gộp khoảng trắng
    stem = re.sub(r"\s+", " ", stem).strip()

    # Xóa khoảng trắng thừa sát dấu ngoặc và trước dấu câu
    stem = re.sub(r"\(\s+", "(", stem)
    stem = re.sub(r"\s+\)", ")", stem)
    stem = re.sub(r"\[\s+", "[", stem)
    stem = re.sub(r"\s+\]", "]", stem)
    stem = re.sub(r"\s+([,.:;!?])", r"\1", stem)

    if not stem:
        stem = default_stem

    # Cắt ở ranh giới từ nếu vượt quá độ dài tối đa cho phần thân
    if len(stem) > MAX_STEM_LENGTH:
        truncated = stem[:MAX_STEM_LENGTH]
        last_space = truncated.rfind(" ")
        if last_space > 0:
            stem = truncated[:last_space]
        else:
            stem = truncated

    # Không để dấu chấm hoặc khoảng trắng cuối trước đuôi .docx
    stem = stem.rstrip(". ").strip()

    if not stem:
        stem = default_stem

    return f"{stem}{DOCX_EXTENSION}"


def to_ascii_filename(filename: str, default_name: str = "tai-lieu.docx") -> str:
    """Chuyển đổi tên file có dấu tiếng Việt sang bản ASCII không dấu dự phòng

    dùng cho tham số filename="..." trong header HTTP Content-Disposition.
    """
    if not filename or not isinstance(filename, str):
        return default_name

    # Xử lý đ/Đ riêng vì chuẩn NFKD không phân rã ký tự 'đ' thành 'd' + dấu
    name = filename.replace("Đ", "D").replace("đ", "d")
    folded = unicodedata.normalize("NFKD", name)
    plain = folded.encode("ascii", "ignore").decode("ascii")

    default_stem = default_name.removesuffix(DOCX_EXTENSION) if default_name.endswith(DOCX_EXTENSION) else default_name
    return sanitize_docx_filename(plain, default_stem=default_stem)
