import React from "react";

export const questionTypeLabels: Record<string, string> = {
  single_choice: "Trắc nghiệm",
  multiple_choice: "Trắc nghiệm nhiều đáp án",
  short_answer: "Trả lời ngắn",
  matching: "Ghép nối",
  ordering: "Sắp xếp",
  practical_submission: "Điền đáp án (Gắn link)",
  file_upload: "Tải tệp ảnh",
};
export const questionTypes = Object.entries(questionTypeLabels);
const optionText = (question: any) => (question.options || []).map((option: any) => question.type === "matching"
  ? `${option.text || ""} | ${option.match_text || ""}`
  : option.text || "").join("\n");
const optionsFromText = (type: string, value: string) => value.split("\n").map((line, index) => {
  const [left, right] = type === "matching" ? line.split(/\s*(?:\||→|=>)\s*/, 2) : [line];
  return { key: String(index + 1), text: String(left || "").trim(), ...(type === "matching" ? { match_text: String(right || "").trim() } : {}) };
}).filter((option) => option.text || option.match_text);

export default function QuestionEditor({ question, onChange, onClose }: { question: any; onChange: (next: any) => void; onClose: () => void }) {
  const needsOptions = ["single_choice", "multiple_choice", "matching", "ordering"].includes(question.type);
  return <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-sm">
    <div className="grid gap-3 sm:grid-cols-2"><label className="sm:col-span-2"><span className="mb-1 block font-bold">Nội dung câu hỏi</span><textarea className="ft-input min-h-20 bg-white" value={question.text || ""} onChange={(event) => onChange({ ...question, text: event.target.value })} /></label><label><span className="mb-1 block font-bold">Dạng câu</span><select className="ft-input bg-white" value={question.type} onChange={(event) => onChange({ ...question, type: event.target.value, options: optionsFromText(event.target.value, optionText(question)) })}>{questionTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span className="mb-1 block font-bold">Điểm</span><input type="number" min="0" step="0.25" className="ft-input bg-white" value={question.points ?? 1} onChange={(event) => onChange({ ...question, points: Number(event.target.value) })} /></label>{needsOptions && <label className="sm:col-span-2"><span className="mb-1 block font-bold">{question.type === "matching" ? "Các cặp ghép (mỗi dòng: vế trái | vế phải)" : "Phương án (mỗi dòng một phương án)"}</span><textarea className="ft-input min-h-28 bg-white" value={optionText(question)} onChange={(event) => onChange({ ...question, options: optionsFromText(question.type, event.target.value) })} /></label>}<label className="sm:col-span-2"><span className="mb-1 block font-bold">Đáp án đúng</span><input className="ft-input bg-white" value={(question.correct_answers || []).join(question.type === "matching" || question.type === "ordering" ? "" : " | ")} onChange={(event) => onChange({ ...question, correct_answers: event.target.value ? (question.type === "matching" || question.type === "ordering" ? [event.target.value] : event.target.value.split(/[|;]/).map((item) => item.trim()).filter(Boolean)) : [] })} placeholder={question.type === "matching" ? "VD: 1-A|2-B" : question.type === "ordering" ? "VD: 3|1|2" : "VD: 1 | 3"} /></label></div><div className="mt-3 flex justify-end"><button type="button" onClick={onClose} className="ft-btn ft-btn-secondary">Đóng chỉnh sửa</button></div>
  </div>;
}
