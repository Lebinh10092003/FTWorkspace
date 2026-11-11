# Đối chiếu đăng ký trên web với form gốc

Đối chiếu ngày 11/11/2026. Nguồn: [Form FIMO/FIEO do chủ dự án cung cấp](https://docs.google.com/forms/d/e/1FAIpQLSfXolj88aqSMC7LTSK9WRc0gfQTZkbNuUosiIdbvFmudrqNfQ/viewform). Đã đọc đủ ba phần bằng bản người trả lời và bản biên tập; không sửa hay gửi phản hồi vào Google Form.

| Nội dung nguồn | Bản web |
| --- | --- |
| Email được Google Form thu thập, bắt buộc | Email của người đăng ký; có nút dùng lại email liên hệ |
| Họ tên có dấu; ngày sinh; CCCD/hộ chiếu, bắt buộc | Giữ đủ, kiểm tra cả phía trình duyệt và máy chủ |
| Email liên hệ, tỉnh/thành, xã/phường, địa chỉ, điện thoại, trường, bắt buộc | Giữ đủ; 34 lựa chọn tỉnh/thành theo form nguồn |
| Khối và lớp, bắt buộc | Tách khối và tên lớp, kiểm tra hai giá trị khớp nhau |
| Chọn FIMO/FIEO hoặc cả hai, bắt buộc | Thẻ có logo, tên, kỳ tổ chức; chọn sẵn từ landing page |
| Chứng từ nộp lệ phí, bắt buộc; một ảnh tối đa 10 MB | Theo yêu cầu chủ dự án: lưu hồ sơ trước, gửi chứng từ ở bước thanh toán sau; một ảnh hoặc PDF tối đa 10 MB; kéo thả, dán ảnh và xem trước |
| QR và thông tin tài khoản trong ảnh | Tạo VietQR trên máy từ đúng tài khoản VPBank trong ảnh nguồn; tự điền tổng tiền và nội dung riêng theo hồ sơ, tải QR vào điện thoại |
| Lệ phí vòng loại 250.000đ/cuộc thi/lần dự thi | Cấu hình mặc định cho FIMO/FIEO hiện tại, tính tổng theo lựa chọn |
| Chung kết Quốc gia 450.000đ, chỉ nộp sau thông báo đủ điều kiện | Giữ trong hướng dẫn; không cộng vào lệ phí vòng loại |
| Lệ phí quốc tế thông báo sau | Không tự đặt số tiền |

Bản web bổ sung họ tên phụ huynh theo tiêu đề đã thấy trong bảng phản hồi; đây là trường tùy chọn. Người dùng nhập qua hai bước thông tin, xác nhận rồi lưu hồ sơ vào Khảo thí trước khi mở bước thanh toán. Có mã thí sinh, liên kết riêng để quay lại, và in/lưu phiếu. Bổ sung ảnh sau không tạo thêm thí sinh; gửi lại cùng ảnh không nhân đôi chứng từ. Thoát ở bước thanh toán không làm mất hồ sơ. Lệ phí được lưu tại thời điểm đăng ký, thay đổi cấu hình sau đó không đổi số tiền của hồ sơ đã nhận. Liên kết có chữ ký, hết hạn sau 90 ngày; chứng từ không có URL công khai.

Yêu cầu bắt buộc FIMO/FIEO được trả cùng cấu hình từng cuộc thi và áp dụng lại trên máy chủ. Không suy diễn các yêu cầu riêng này cho SCO, AYSBC hoặc WAICY khi chưa có form/thể lệ tương ứng.

Hồ sơ đi vào thí sinh và lượt tham gia của đúng kỳ trong Khảo thí. Có chống gửi trùng theo mã lượt gửi, không tự xác nhận thanh toán, không xếp phòng hoặc tạo kết quả vòng thi. Kỳ thi và lệ phí có thể cấu hình từ trình sửa đăng ký; các kỳ mới phải có sẵn trong Khảo thí.

Phần giới thiệu FIMO/FIEO ở trang chi tiết/popup được biên tập từ nguồn: định hướng chương trình 80/20, đề song ngữ Việt–Anh của FIMO và tham chiếu CEFR của FIEO. Trang tổng quan giữ ngắn.

Không sao chép cam kết email trong 24 giờ thành thông báo “đã gửi email tự động”, vì luồng tự gửi thư xác nhận chưa được triển khai. Xác nhận trên web và mã hồ sơ có ngay sau khi lưu thành công. Phần chiến dịch email được nghiên cứu riêng trong `EMAIL_CAMPAIGNS_RESEARCH.md`.

Các bảng phản hồi Google hiện tại chỉ được đọc tiêu đề, không sửa dữ liệu. Cơ chế đồng bộ và lịch quét của dự án được giữ nguyên.
