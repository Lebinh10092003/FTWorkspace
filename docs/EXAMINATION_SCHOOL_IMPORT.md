# Nhập đăng ký khảo thí theo trường

Trong Khảo thí → Nhập dữ liệu, chọn **Nhập Excel theo trường**. Một lần nhập xử lý nhiều cuộc thi/kỳ tổ chức trong cùng tab danh sách. Mẫu được đối chiếu với file TH&THCS Kim Đồng (Gia Lai): tab “Đăng ký tham dự”, phần thông tin trường ở đầu trang và bảng chi tiết phía dưới. Khi có bản sao danh sách trong workbook, chỉ nhập tab được chọn; mặc định ưu tiên “Đăng ký tham dự”. Không tự nhập các tab hướng dẫn hoặc bảng tổng hợp.

Các cột: STT, họ tên thí sinh, ngày sinh đầy đủ, CCCD/hộ chiếu/số định danh, lớp đang học, cuộc thi đăng ký, lệ phí, phụ huynh/người giám hộ, điện thoại, email, ghi chú. Các trường mở rộng như tỉnh, phường, trường, khối, môn, bảng thi, ngôn ngữ được ánh xạ bằng bộ tên cột hiện có. Giấy tờ và điện thoại nên lưu dạng văn bản để giữ số 0 đầu. Lệ phí là giá trị số; file có công thức cần được lưu lại bằng Excel để có kết quả tính sẵn.

Chọn đối tác có sẵn để hiện thông tin liên lạc hoặc nhập trường mới. Khi tên trường trong file khớp duy nhất một đối tác, dùng đối tác đó. Trường mới cần tên trường, người liên lạc, số điện thoại và email. Hồ sơ mới và thông tin đăng ký dùng các model Candidate, CandidateParticipation, RoundResult hiện có. Hồ sơ đã có chỉ được bổ sung trường còn trống; không ghi đè thông tin đã biết.

Học sinh lặp ở nhiều cuộc thi dùng cùng một hồ sơ. Dòng trùng học sinh + kỳ được tính một lần; lệ phí/thông tin đăng ký mâu thuẫn được báo lỗi. Trùng chưa rõ cần xác nhận hồ sơ trong popup. Cùng số điện thoại/email nhưng khác giấy tờ hoặc ngày sinh không được tự gộp. Kỳ được đối chiếu theo mã cuộc thi/mã kỳ và năm học; nếu có nhiều kỳ cùng mã thì chọn rõ kỳ trong popup.

Xem trước hiện toàn bộ lỗi và lưu ý, số học sinh, số lượt đăng ký, lệ phí theo kỳ và số lượt sẽ phân phòng. Lỗi chặn toàn bộ lần nhập. Bản xem trước hết hạn sau 30 phút hoặc khi dữ liệu liên quan thay đổi; cần kiểm tra lại. Ghi dữ liệu trong một transaction để lỗi không để lại lượt đăng ký dở dang.

Sau khi nhập, popup giữ mở với báo cáo kết quả: tổng học sinh duy nhất, số hồ sơ mới, số hồ sơ đã có được dùng lại và lượt đăng ký bổ sung. Bảng từng cuộc thi/kỳ cho biết số học sinh đăng ký, hồ sơ mới/đã có, lượt đăng ký bổ sung/đã thuộc kỳ, lệ phí và kết quả phân phòng. Học sinh đăng ký nhiều cuộc thi được tính một lần ở tổng học sinh, một lần trong mỗi cuộc thi đã đăng ký. Báo cáo từng kỳ được lưu vào nhật ký kỳ để xem lại; nhập lại cùng file báo 0 hồ sơ mới và 0 lượt bổ sung.

Phân phòng dùng phòng đã cấu hình ở vòng đầu, giữ các phân công đã có và tôn trọng sức chứa. Vòng có nhiều đợt chưa xác định, chưa có phòng hoặc hết chỗ được ghi nhận chờ phân phòng trong popup. Không tự tạo phòng hoặc đoán đợt thi. Sau nhập, hàng đợi sao lưu thí sinh và các Sheet kỳ đã liên kết tiếp tục chạy theo cơ chế hiện có; đồng bộ Google là bất đồng bộ và có retry.

## Đối soát theo trường

SchoolRegistration gom một đối tác + một kỳ thành một tài khoản đối soát. Các lần nhập sau dùng lại nhóm; kế toán thấy một dòng của trường trong từng kỳ, không tính thêm các dòng cá nhân thuộc nhóm. Tổng tiền dựa trên các lượt đăng ký duy nhất, không nhân theo số dòng trong Excel. Thiếu lệ phí thì để số tiền chưa xác định để kế toán nhập.

Nhập lại không thay đổi xác nhận chuyển khoản, hóa đơn hay số tiền kế toán đã xử lý. Không tự chuyển lượt đăng ký cá nhân đã có số tiền/chứng từ sang nhóm trường. Không tự bổ sung học sinh vào nhóm đã được kế toán xem hoặc xử lý; popup yêu cầu xử lý khoản bổ sung trước. Các lượt cá nhân chưa có dữ liệu tài chính có thể chuyển sang nhóm và được báo trong xem trước.

Kế toán có thể thêm nhiều ảnh chuyển khoản vào mỗi dòng đối soát, bổ sung nhiều lần và xem từng ảnh. Khoản thu chưa xác định cũng nhận nhiều ảnh. Mỗi lần tối đa 20 ảnh, mỗi ảnh tối đa 5 MB, tổng tối đa 10 MB. Ảnh lưu riêng tư, chỉ người có quyền khảo thí/kế toán được truy cập; việc tải ảnh không tự xác nhận đã nhận tiền.

## Chuẩn bị lưu ảnh vào Drive

Drive mặc định tắt. TransferProof giữ bản ảnh riêng tư và session_id từ chính hồ sơ đối soát. Chứng từ của form đăng ký mới cũng tạo bản ghi theo từng cuộc thi được chọn. Khoản thu chưa xác định chưa có session_id, chỉ được gắn kỳ sau khi khảo thí xác minh. Không đưa ảnh vào một thư mục mặc định dùng chung.

Thiết lập SystemConfig với key `examination_proof_drive`:

```json
{
  "enabled": false,
  "sessionFolders": {"ID_KY_TO_CHUC": "ID_THU_MUC_DRIVE"},
  "competitionFolders": {"ID_CUOC_THI_HOAC_MA_IN_HOA": "ID_THU_MUC_DRIVE"}
}
```

Ánh xạ kỳ cụ thể được ưu tiên, sau đó đến ID cuộc thi hoặc mã cuộc thi in hoa. Giá trị là **ID thư mục**, không phải URL. Có thể thay thế ánh xạ cuộc thi bằng biến môi trường `EXAMINATION_PROOF_DRIVE_FOLDERS` (JSON) và bật bằng `EXAMINATION_PROOF_DRIVE_ENABLED=true`.

Sau khi cấp quyền Google cho đúng thư mục, bật cấu hình và chạy:

```text
python manage.py sync_examination_proofs --limit 100
```

Công cụ sử dụng thông tin xác thực Google hiện có và hỗ trợ Shared Drive. Cần quyền đọc/ghi thư mục qua scope drive.file. Có thể đặt lệnh trên vào lịch chạy sau khi thiết lập. Retry tìm theo examinationProofId trong đúng thư mục nên không tạo ảnh trùng sau lỗi mạng/DB. Trạng thái `pending_configuration`, `failed`, `synced` và lỗi được lưu trong DB. Ảnh đã đồng bộ không tự di chuyển khi thay cấu hình; khoản thu có ảnh đã lưu Drive không được đổi sang kỳ khác trong bước xác minh.

Ảnh/chứng từ lịch sử nằm trong các trường legacy vẫn xem được qua luồng cũ. Chưa tự tải link ảnh bên ngoài hoặc chuyển toàn bộ chứng từ lịch sử sang Drive trong thay đổi này.

Triển khai: chạy migration `0052_school_import_and_transfer_proofs` trước khi dùng giao diện mới. File mẫu chỉ được đọc để kiểm tra cấu trúc; chưa nhập dữ liệu thật hoặc bật Drive.

## Cập nhật 10/2026

- Trang Khảo thí → Nhập dữ liệu chỉ còn một luồng: **Nhập Excel đăng ký của trường** (chọn file hoặc kéo thả). Đăng ký cá nhân đi qua Form; Sheet khảo thí tự đồng bộ hai chiều nên không còn nhập tay từ Google Sheets/CSV. File mẫu: `public/templates/Mau_dang_ky_theo_truong.xlsx` (Phụ lục 4).
- Đọc khối thông tin trường của mẫu Phụ lục 4 (nhãn không có dấu ":", "Họ và tên: … Chức vụ: …", "Số điện thoại: … Email: …").
- Lệ phí dạng chữ ("500.000VNĐ", "250,000 đ") được đọc thành số. Dòng nhiều cuộc thi có một lệ phí được chia đều cho từng cuộc thi; không chia đều được thì báo lỗi.
- Popup tự kiểm tra lại sau mỗi lựa chọn, gom lỗi/lưu ý theo loại và chỉ liệt kê học sinh cần chọn hồ sơ.
- Sửa dữ liệu do bộ nhập Excel cũ để lại (ngày sinh đảo ngày/tháng, trống tên trường) và bổ sung lượt còn thiếu:

```text
python manage.py reconcile_school_registrations --file <file.xlsx> --sheet "Cả trường" --academic-year 2026-2027 [--partner-id <id>] [--apply]
```

  Mặc định chỉ chạy thử và hoàn tác. Ngày sinh chỉ được thay khi giá trị trên web là ngày/tháng bị đảo hoặc năm nhập nhầm; các trường khác chỉ được điền khi đang trống.

## Đồng bộ Sheet khảo thí

Sửa tay trên tab Sheet của kỳ thi được tự cập nhật về web theo từng dòng (Apps Script báo ngay khi có sửa; quét dự phòng lúc 06:00, 12:00, 18:00 để bắt sự kiện bị lỡ và các file chưa gắn script). Dòng có mã FT khớp họ tên/CCCD luôn ghép đúng hồ sơ đó. Dòng không ghép chắc chắn được thì giữ nguyên và ghi vào nhật ký kỳ; không gắn cờ "cần kiểm tra" và không chặn các dòng khác. Hàng đợi ghi ra Sheet coi dòng cùng họ tên nhưng mang mã FT khác là người khác, nên không còn kẹt khi có học sinh trùng tên.

## Phân phòng (cập nhật 09/10/2026)

Nhập Excel theo trường **không tự xếp phòng** và không điền ngày thi, giờ/ca, hình thức, link. Lượt đăng ký mới để trống và hiển thị là "chờ phân phòng"; Khảo thí xếp phòng sau. Trước đây hệ thống tự xếp vào phòng của vòng đầu, kể cả khi vòng đó đã diễn ra (vd 25 học sinh Trưng Vương SIAIO bị gán phòng ngày 04/10).
