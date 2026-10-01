import io
from collections import Counter

from django.test import TestCase
from openpyxl import Workbook

from .assessment_service import generate_variants_from_import, parse_assessment_workbook


class AssessmentQuestionBankTests(TestCase):
    def test_bank_image_type_media_header_and_numeric_answer_cells(self):
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "TH"
        sheet.append(["STT", "Chủ đề", "Loại câu hỏi", "Kiểu câu hỏi", "Câu hỏi", "Link ảnh minh họa", "Phương án 1", "Phương án 2", "Đáp án"])
        sheet.append([1, "Gemini", "Thực hành", "Tải tệp ảnh", "Nộp ảnh", "https://drive.google.com/file/d/example_image_id/view", "", "", ""])
        sheet.append([2, "NotebookLM", "Thực hành", "Điền đáp án (Gắn link)", "Nộp link", "", "", "", ""])
        sheet.append([3, "Gemini", "Lý thuyết", "Trắc nghiệm", "Chọn đáp án", "", "Sai", "Đúng", 2.0])
        buffer = io.BytesIO()
        workbook.save(buffer)
        result = parse_assessment_workbook(buffer.getvalue(), "bank.xlsx")
        self.assertEqual(result["errors"], [])
        self.assertEqual([item["type"] for item in result["questions"]], ["file_upload", "practical_submission", "single_choice"])
        self.assertEqual(result["questions"][0]["media_file_id"], "example_image_id")
        self.assertEqual(result["questions"][0]["image_url"], result["questions"][0]["media_url"])
        self.assertEqual(result["questions"][2]["correct_answers"], ["2"])

    def test_global_practice_counts_are_spread_across_topics_with_capacity_bounds(self):
        questions = []
        for topic in ("A", "B", "C", "D"):
            for knowledge in ("Theory", "Practice"):
                for index in range(15):
                    questions.append({"id": f"{topic}-{knowledge}-{index}", "text": f"{topic}-{knowledge}-{index}", "category": topic, "knowledge_type": knowledge, "type": "file_upload" if knowledge == "Practice" else "short_answer", "points": 1})
        config = [{"category": topic, "total": 10} for topic in ("A", "B", "C", "D")]
        for restricted in (False, True):
            bank = [item for item in questions if not (restricted and item["category"] == "A" and item["knowledge_type"] == "Practice")]
            result = generate_variants_from_import(bank, variant_count=5, questions_per_variant=40, seed=42, topic_config=config, knowledge_config={"theory": 35, "practice": 5})
            for variant in result["variants"]:
                selected = [item for item in result["questions"] if item["variant"] == variant["name"]]
                self.assertEqual(Counter(item["category"] for item in selected), Counter({topic: 10 for topic in ("A", "B", "C", "D")}))
                practical = Counter(item["category"] for item in selected if item["knowledge_type"] == "Practice")
                self.assertEqual(sum(practical.values()), 5)
                if restricted:
                    self.assertEqual(practical["A"], 0)
                counts = [practical[topic] for topic in (("B", "C", "D") if restricted else ("A", "B", "C", "D"))]
                self.assertGreaterEqual(min(counts), 1)
                self.assertLessEqual(max(counts) - min(counts), 1)

