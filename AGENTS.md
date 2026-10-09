# Quy tắc cho AI agent (Codex, Claude…)

Đọc hết file này trước khi sửa code. Các mục dưới đây là **quyết định đã chốt của chủ dự án**, không phải gợi ý. Muốn làm khác thì hỏi lại trước, không tự đổi.

## Luồng dữ liệu Khảo thí ↔ Google Sheet

### Nguyên tắc
1. **Web là nguồn gốc.** Sheet khảo thí (vd `11h9E1WPewoUzoMK8UToIC2oJqRyFrvrw5oZfl81NZM8`, các tab `FT - FIMO`, `FT - FIEO`, `SCO - …`) là bản xuất từ web.
2. **Web → Sheet: ghi thẳng.** Lưu hồ sơ, đăng ký, kết quả trên web thì hàng đợi `SessionSheetOutbox` ghi ra tab tương ứng (`session_sheet_queue.py`). Không hỏi, không chờ duyệt.
3. **Sheet → Web: tự cập nhật theo từng dòng, KHÔNG chờ duyệt.** Ai sửa tay trên Sheet thì web nhận đúng nội dung đó.
   - Dòng có mã FT khớp họ tên/CCCD: ghép đúng hồ sơ đó, kể cả khi web có hồ sơ trùng giống hệt.
   - Ô trống trên Sheet không xóa dữ liệu web. Hồ sơ không có trên Sheet không bị xóa.
   - Chỉ ghi dòng mới hoặc dòng có thay đổi, không ghi lại cả tab.
   - Dòng không ghép chắc chắn được (mã FT không khớp người, nghi trùng, trùng tên mà thiếu định danh): **chỉ bỏ qua dòng đó** và ghi vào nhật ký kỳ (`LogNote`). Không chặn các dòng khác.
   - Thay đổi web còn đang chờ ghi ra Sheet (job vừa vào hàng đợi, chưa thử, dưới 10 phút) thì không bị giá trị cũ trên Sheet đè lên.

### Kích hoạt: theo sự kiện, không quét liên tục
- **Đường chính:** Apps Script gắn vào Sheet (`apps-script/examination-sheet-alert/Code.gs`), dùng trigger onEdit/onChange, gọi `POST /api/examination/sheets/change-webhook`. Web đọc lại đúng tab đó rồi tự nhập.
- **Dự phòng:** `workspace-examination-sheet-scan.timer` chỉ chạy **06:00, 12:00, 18:00**. Lần quét chỉ so dấu vân tay (fingerprint) của tab, không đổi thì bỏ qua.
- **CẤM** đổi lịch quét thành mỗi phút hoặc mỗi giờ. CẤM thêm polling để "phát hiện nhanh hơn". Cần nhanh hơn thì sửa Apps Script/webhook.
- Lượt web tự ghi ra Sheet (fingerprint khớp `last_content_fingerprint`) không được coi là có người sửa.
- **Không bao giờ xóa trắng rồi ghi lại cả tab.** Mọi lần xuất (kể cả lịch 11:00/16:00) chỉ cập nhật đúng dòng tại chỗ và thêm dòng mới ở cuối, để giữ thứ tự dòng và các ô chỉ có trên Sheet.
- Dòng vừa nhập từ Sheet vào web **không được ghi ngược lại** chính tab đó (xóa job `SessionSheetOutbox` của các hồ sơ vừa cập nhật).
- Nhập kết quả vòng thi phải ghép vào kết quả sẵn có của cùng vòng (kể cả bản có mã ca rỗng), giữ tên vòng theo cấu hình kỳ. Không tạo bản kết quả thứ hai cho cùng một vòng.

### Những điều CẤM
- **Không** gắn cờ `pending_manual_import`, không đặt `status='attention'`, không gửi `notify_workspace` kiểu "Sheet thay đổi, cần xem trước và nhập".
- **Không** hiện banner kiểu "N nguồn Sheet khảo thí cần kiểm tra" hoặc "Google Sheet có thay đổi đang chờ đưa vào web" trong `ExaminationModule.tsx`.
- **Không** để một dòng lỗi chặn cả tab, cả file hay cả lô hàng đợi.
- **Không** sửa test để hợp thức hóa hành vi ngược với các quy tắc trên. Test hiện có ở `SheetChangeScanTests` (`backend/examination/tests.py`) mô tả đúng hành vi mong muốn.

Commit `6985864` từng chuyển sang "duyệt tay + banner + quét mỗi phút" và **đã bị hoàn tác** ở `65f23b6`. Đừng làm lại.

## Nhập Excel đăng ký của trường
- Trang Khảo thí → Nhập dữ liệu **chỉ có một luồng**: "Nhập Excel đăng ký của trường" (`SchoolImportDialog.tsx`, `school_import.py`). Thí sinh cá nhân đi qua Form, không nhập tay. Đừng thêm lại nút nhập CSV hoặc Google Sheet chung.
- **Lỗi của một dòng chỉ bỏ qua dòng đó**, các học sinh khác vẫn nhập. Chỉ lỗi chung của cả file (thiếu tên trường, nhóm trường đã được kế toán xử lý) mới chặn.
- Cột "Cuộc thi đăng ký" nhận nhiều mã: `FIMO & FIEO & SIAIO`, `A, B và C`, `A - B`, `A | B`, `A + B / C`.
- Lệ phí chung của dòng nhiều cuộc thi được chia theo giá từng cuộc thi, học từ các dòng chỉ đăng ký một cuộc thi trong cùng file. Không có thông tin giá thì chia đều nếu chia hết; không chia được thì bỏ qua riêng dòng đó.
- Đọc ngày trong Excel bằng serial/ISO, **không** đọc chuỗi hiển thị (M/D/YY gây đảo ngày/tháng). Giữ số 0 đầu của CCCD/SĐT. Cột "Nộp lệ phí" là ô tích, không phải số tiền.
- Không ghi đè thông tin đã có của hồ sơ, trừ khi chủ dự án yêu cầu rõ (lệnh `reconcile_school_registrations --update-profiles`).
- **Lệ phí:** ô Excel số thực ("250000.0") là số, không bỏ dấu thập phân; "500.000VNĐ"/"250,000" là dấu phân cách nghìn; số dưới 10.000 là nghìn đồng ("250" = 250.000đ).
- **Lớp và khối** của học sinh luôn theo danh sách năm học mới nhất của trường (các trường khác chỉ điền khi trống).
- **Lượt cá nhân của học sinh có trong danh sách trường:** chỉ giữ riêng khi đã có thanh toán/chứng từ/kế toán xử lý (`has_individual_accounting`); còn lại chuyển vào nhóm trường và bỏ khoản thu cá nhân trống, để tổng của trường đủ và không tính hai lần.
- **Nhập tay cho học sinh của trường** (dòng file không nhập được): chọn "Đăng ký qua" trường + lệ phí trong "Thêm hồ sơ"/"Thêm thí sinh từ kho" (`attach_to_school`, `refresh_group_billing`).
- Khi đối chiếu danh sách trường với web: kiểm tra **cả thiếu lẫn thừa** theo từng cuộc thi, sai thông tin, tab Sheet, và tổng lệ phí.
- **Đăng ký không bao giờ tự xếp phòng, ngày thi, giờ/ca thi, hình thức thi hay link.** Nhóm nhập sau để trống, chờ Khảo thí xếp. Không sao chép theo nhóm trước hoặc theo vòng đã diễn ra.

## Dữ liệu thí sinh trong từng kỳ
- **Mỗi kỳ chỉ chứa kết quả của chính kỳ đó.** Thêm thí sinh có sẵn (từ kho, Excel, Sheet) vào kỳ mới **không bao giờ** chép kết quả vòng thi của kỳ khác. Mọi đường ghi kết quả đi qua `history_for_session` (bỏ dòng có `sessionId` khác hoặc mã vòng không có trong kỳ).
- **"Điều kiện tham gia" không có giá trị mặc định.** Vòng đầu nhận mọi thí sinh đã đăng ký trừ người bị đánh dấu "Không đủ điều kiện" (`eligible_for_round_q`); vòng sau chỉ nhận người được đánh dấu "Đủ điều kiện" sau khi có kết quả vòng trước. Không tự ghi "Đủ điều kiện" ra Sheet.
- **Khối lớp lưu dạng số** ("6"), theo lớp khi lớp bắt đầu bằng số (`normalize_grade`).
- Khi sửa một lỗi dữ liệu: rà **tất cả** kỳ và tab cùng loại, đọc từng cột và các dòng cuối, không chỉ dòng được báo.

## Lịch công tác và bảng chấm công
- Bảng chấm công tháng (`attendance/sheet_sync.py`) là bản phụ. Lỗi ở đó (thiếu tab, sai tháng, thiếu dòng ngày) **chỉ bỏ qua đúng nhân viên–ngày đó** và ghi log. Không được làm hỏng hàng đợi Lịch công tác (`push_attendance_safely` trong `work_schedule/sheet_sync.py`).
- File chấm công tháng do kế toán tạo bằng cách sao từ tháng trước. Tab thiếu ngày cuối tháng (vd ngày 31) thì hệ thống tự chèn dòng **bên trong** vùng công thức Tổng. Không chèn bên dưới dòng cuối, vì như vậy dòng mới nằm ngoài vùng SUM.

## Cách làm việc
- Trước khi đổi cơ chế đồng bộ, hàng đợi hoặc lịch timer: **hỏi chủ dự án**. Sửa lỗi cụ thể thì cần ví dụ cụ thể (tab, dòng, mã FT).
- Không hoàn tác commit của người khác khi chưa hỏi.
- Thay đổi dữ liệu production: chạy thử (dry-run) trước, sao lưu DB vào `/home/workspace/ft-workspace-data/backups/` rồi mới ghi.
- Chạy `python manage.py test examination attendance work_schedule` và `npm run lint` trước khi push. Đẩy lên `main` sẽ tự deploy.
