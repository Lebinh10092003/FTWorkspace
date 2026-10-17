# Coi thi: quy trình cho mỗi vòng thi

Áp dụng cho mọi cuộc thi (FIMO, FIEO, SIAIO, SIPhO…). Mọi bước làm trên web,
trang **Khảo thí → Coi thi**, sau khi chọn kỳ thi ở ô chọn kỳ.

## 1. Phân phòng
- Cách nhanh: trên tab khảo thí của kỳ (vd `FT - FIEO`), điền cùng một link
  phòng (Google Meet) vào cột **"Địa điểm/Phòng thi"** cho mọi thí sinh của một
  phòng. Web tự nhập thay đổi của Sheet.
- Trên Coi thi bấm **"Tạo phòng từ link Meet"** → xem trước → **"Tạo phòng & ca coi thi"**.
  Mỗi link thành một phòng (đặt tên theo thứ tự SBD), thí sinh được xếp vào phòng,
  mỗi phòng có sẵn một ca coi thi theo ngày giờ của đợt thi. Hệ thống sao lưu dữ liệu
  trước khi ghi; chỉ ghi việc xếp phòng, Sheet giữ nguyên.
- Bấm lại sau khi sửa Sheet: chỉ thêm phần còn thiếu, không tạo trùng. Đợt đã đủ ghi "Đã xong".

## 2. Phân công giám thị
Bấm vào từng phòng → **"Lịch & giám thị"**:
- Nhân viên: tích tên trong danh sách giám thị (vào bằng tài khoản Workspace).
- Giám thị ngoài: điền **họ tên và email** ở mục "Giám thị ngoài". Hệ thống tạo
  link riêng `/coi-thi/…`; giám thị phải nhập đúng email này mới mở được.
  Link mở từ 24 giờ trước giờ thi đến 12 giờ sau ca; **Đổi link**/**Thu hồi** khi cần.

## 3. Gửi thông tin cho giám thị
Bấm **"Gửi thông tin cho giám thị"**. Thư theo mẫu đã duyệt, tự điền từ dữ liệu kỳ thi:
tên cuộc thi, năm học, vòng/đợt, thứ ngày giờ, phòng, số thí sinh, hình thức thi,
mốc vào phòng (trước 30 phút), mốc tự đánh Vắng (sau 15 phút), hạn xác nhận
(20:00 hôm trước), nút **Mở trang điểm danh** và **Vào phòng thi**.
- Đã cài tài khoản gửi thư trên server (`EMAIL_HOST`, `EMAIL_HOST_USER`,
  `EMAIL_HOST_PASSWORD` trong `backend/.env`): chọn phòng → **Gửi email**.
- Chưa cài: bấm **Soạn trong Gmail** ở từng giám thị rồi bấm Gửi.

## 4. Sheet phân phòng (lưu trữ)
Thanh **"Sheet phân phòng"** trên Coi thi: tạo một file Google Sheets trống, chia sẻ
quyền chỉnh sửa cho tài khoản hệ thống (hiện sẵn trên màn hình), dán link → Lưu.
Mỗi phòng một tab + tab "Danh sách phòng"; web tự ghi lại mỗi khi có điểm danh.
Điểm danh chỉ ghi file này, không ghi tab khảo thí (xem `AGENTS.md`).

## 5. Trong giờ thi
Giám thị điểm danh Có mặt / Muộn / Vắng, ghi điểm và ghi chú sự cố. Sau 15 phút,
thí sinh chưa điểm danh tự chuyển "Vắng" (giám thị vẫn sửa được). Mọi lần sửa đều
ghi tên người sửa.
