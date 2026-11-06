# Lịch thi và lịch công tác 2027

Lịch công tác chọn file theo ngày thực hiện. File 2026 và 2027 được định tuyến
riêng trong `work_schedule/sheet_routing.py`; cấu hình liên kết theo tháng vẫn
có quyền ưu tiên. Năm chưa cấu hình sẽ báo lỗi thay vì ghi nhầm sang năm khác.

Các vòng thi cùng BTC quốc tế và cùng ngày được gộp thành một việc. Người nhận
gồm hai người phụ trách và danh sách thành viên Khảo thí tại cấu hình
`examination_schedule_staff`. Các việc cá nhân và công việc khác giữ nguyên.

Đối chiếu dữ liệu trước khi ghi:

```sh
python manage.py reconcile_calendar_2027
python manage.py reconcile_calendar_2027 --apply --export
```

Lệnh apply tự sao lưu SQLite vào thư mục `backups` cạnh DB, cập nhật cả ngày,
nhãn và các slot của năm cuộc thi SCO, cấu hình đủ 12 tháng 2027, gộp lịch,
loại bản nhập trùng khớp tuyệt đối chưa có đánh giá, rồi xuất sang đúng file.
Đầu ra chỉ chứa số lượng và kết quả đúng/sai; không xuất danh sách nhân sự.

Apps Script gắn với file 2027:
https://script.google.com/u/0/home/projects/1ekuueIdTSGGmRqC6sl1LHisCJkPgYdqbfUwfKUjLP2TknA_waiHaPYE8/edit

Hai payload gửi webhook phải có `spreadsheet_id` của file đang gắn. Các hàm
trong `apps-script/sheet-sync/Calendar2027.gs` đã được thêm ở cuối file Mã.gs
trên dự án trực tiếp. Chạy `setupCalendar2027Integration` để cài trigger còn
thiếu, rồi `verifyCalendar2027Webhook` sau khi triển khai backend.
Không đưa giá trị WEBHOOK_SECRET vào mã nguồn hoặc log.
