# Chiến dịch email cho FermatTech

Ngày khảo sát: 11/11/2026.

## Vị trí trong Workspace

Đề xuất đặt **Chiến dịch email** trong **Truyền thông**. Khảo thí cung cấp đối tượng, cuộc thi, kỳ tổ chức và trạng thái đăng ký; nhân sự truyền thông quản lý nội dung, lịch gửi và kết quả chiến dịch. Từ một kỳ thi có thể mở các chiến dịch liên quan mà không cần tạo hai hệ thống gửi mail.

Mã nguồn hiện có trình thiết kế/mẫu email và Hộp thư AI. `gmail_assistant/gmail_client.py` hiện chỉ đọc thư và tạo nháp, không có hàm gửi. Chưa có mô hình chiến dịch, chuỗi thư, danh sách loại trừ hay thống kê chuyển đổi theo chiến dịch.

## Những gì YAMM đáp ứng

YAMM gửi email cá nhân hóa từ bản nháp Gmail và danh sách Google Sheets; theo dõi mở, nhấp, phản hồi, trả lại và hủy đăng ký. Có gửi tiếp cho các nhóm như chưa mở/chưa phản hồi. [Giới thiệu và tính năng YAMM](https://yamm.com/), [Theo dõi và gửi tiếp](https://yamm.com/blog/track-email-opens-in-google-sheets/).

YAMM cho đặt một lượt gửi theo lịch tại một thời điểm, tối đa hai tuần trước; thời điểm thực gửi có thể lệch tới 30 phút. Vì vậy không nên coi việc nối một Sheet với YAMM là đã có bộ điều phối đầy đủ cho nhiều chuỗi chiến dịch. [Tài liệu đặt lịch](https://yamm.com/help/usage/launch-campaign/schedule-mail-merge/).

Cột `Merge status` cập nhật trực tiếp khi thanh báo cáo YAMM mở. Một trạng thái mới thay trạng thái trước; không phải nhật ký sự kiện đầy đủ. Dashboard Workspace đọc Sheet cần ghi rõ lúc cập nhật và nguồn dữ liệu, tránh trình bày đó là kết quả liên tục tự động. [Mô tả chính thức về trạng thái và cập nhật](https://yamm.com/blog/track-email-opens-in-google-sheets/).

Trong các tài liệu chính thức đã kiểm tra chưa tìm được hợp đồng REST API/webhook công khai đủ để điều khiển toàn bộ chiến dịch YAMM từ Workspace. Đây là giới hạn thông tin đã xác minh, không phải khẳng định YAMM không có tích hợp riêng.

## Hai phương án triển khai

| Phương án | Cách vận hành | Phù hợp |
| --- | --- | --- |
| Kết hợp YAMM | Workspace quản lý chiến dịch, phân nhóm và mẫu; dùng Sheet riêng cho mỗi đợt, mở YAMM để gửi; nhập/đọc kết quả được cập nhật về dashboard | Chạy sớm nếu đội đã có YAMM; vẫn có thao tác ngoài Workspace |
| Gửi qua Gmail API | Workspace tạo từng thư, quản lý tiến trình, gửi tiếp và loại trừ; bổ sung sự kiện nhấp, phản hồi, trả lại và đăng ký | Mục tiêu vận hành hoàn toàn trong Workspace và theo dõi nhiều ngày |

Gmail API hỗ trợ gửi trực tiếp hoặc từ bản nháp. Việc bổ sung phải là mô-đun gửi chiến dịch có quyền riêng, không tự đổi hành vi “chỉ tạo nháp” của Hộp thư AI. [Gmail API: gửi thư](https://developers.google.com/workspace/gmail/api/guides/sending).

Hạn mức phụ thuộc tài khoản và sản phẩm: YAMM Pro Workspace quảng bá tối đa 1.500 người nhận/ngày khi đủ điều kiện; Gmail mail merge cũng có điều kiện và giới hạn riêng. Không dùng một con số cố định cho mọi hộp thư. [Hạn mức YAMM](https://yamm.com/pricing/), [Hạn mức Gmail mail merge](https://support.google.com/mail/answer/12921167?hl=en).

## Phạm vi nên có

- Chiến dịch: mục tiêu, ngày bắt đầu/kết thúc, cuộc thi/kỳ liên quan, người phụ trách, hộp thư gửi.
- Nhóm nhận: danh sách được phép sử dụng; gộp trùng email, ghi nguồn; loại người đã đăng ký, đã phản hồi, từ chối nhận hoặc bị trả lại theo mục tiêu từng thư.
- Các đợt gửi: thư giới thiệu, thư tài liệu, thư nhắc hạn; ngày gửi riêng và điều kiện dừng gửi tiếp.
- Nội dung: dùng lại trình thiết kế email; xem trước dữ liệu cá nhân hóa và gửi thử trước khi phát hành.
- Nhật ký: từng người nhận, từng đợt, trạng thái gửi và lỗi; thao tác gửi lại không tạo thư trùng.
- Báo cáo: số gửi, lỗi/trả lại, người mở, người nhấp, phản hồi, đăng ký và thanh toán đã được kế toán xác nhận; xem theo ngày và toàn chiến dịch.

Ưu tiên đo **nhấp → đăng ký → thanh toán xác nhận**. Tỷ lệ mở chỉ là chỉ báo vì ảnh bị chặn hoặc nạp trước có thể làm sai số; ngay YAMM cũng khuyến nghị tin phản hồi hơn mở thư. [Giới hạn đo lường](https://yamm.com/blog/track-email-opens-in-google-sheets/).

## Liên kết với đăng ký trên web

Đường dẫn email có mã chiến dịch và mã đợt gửi, không chứa thông tin cá nhân. Khi triển khai phần chiến dịch, trang đăng ký sẽ lưu nguồn này cùng hồ sơ để phân biệt lượt nhấp và đăng ký thực tế. Một người đăng ký nhiều cuộc thi cần báo cáo riêng số người và số lượt dự thi.

Lộ trình đề xuất: hoàn thiện đăng ký trực tiếp → thí điểm một chiến dịch với YAMM nếu đã dùng → chọn tích hợp YAMM hay Gmail API sau khi đối chiếu khối lượng gửi và mức tự động hóa cần thiết. Chưa cài YAMM, cấp thêm quyền Gmail hoặc gửi email trong đợt sửa này.
