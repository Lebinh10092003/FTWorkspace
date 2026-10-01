# Đăng ký khảo thí 2026–2027

Sheet nguồn: <https://docs.google.com/spreadsheets/d/1gqO1Tp4YSBp0UVBgXjJgvL8CuqftVKGNd74PPRX9i8E/edit>. Ba tab gốc được giữ nguyên. Web tách các lựa chọn trong tab gộp thành bảy kỳ tổ chức: SIAIO, SIPhO, SIChO, SIBO, SILSO, FIMO và FIEO. Nếu dòng trong tab gộp chưa chọn cuộc thi, hệ thống bỏ qua và ghi cảnh báo trong Apps Script.

## Kích hoạt trên máy chủ

1. Triển khai mã nguồn và chạy Django migrations `0042` đến `0044` bằng quy trình `deploy.sh` hiện có.
2. Tạo một khóa ngẫu nhiên riêng, đặt `EXAMINATION_REGISTRATION_WEBHOOK_SECRET` trong `backend/.env` của máy chủ, rồi khởi động lại `workspace-django.service`. Không đưa khóa vào Git.
3. Mở [dự án Apps Script đã gắn với Sheet](https://script.google.com/u/0/home/projects/1Yt7a_vNApfr9L2jiYbU6KHs-xGd4F0NvMXeQ1_LhSjzyEOWy9qWq1HoY/edit). Mã [Code.gs](../apps-script/registration-2026-2027/Code.gs) đã được lưu tại đây; đối chiếu bản mã nếu sau này chỉnh sửa.
4. Trong **Project settings → Script Properties**, `WEBHOOK_URL=https://workspace.fermat.vn/api/examination/form-registration/webhook` đã được lưu. Người quản trị nhập `WEBHOOK_SECRET` bằng khóa ở bước 2, trực tiếp trong Google Apps Script; không gửi khóa qua chat hay đưa vào Git.
5. Chạy `installRegistrationTriggers()` một lần và cấp quyền cần thiết; sau đó chạy `syncAllRegistrations()` một lần để nhập các dòng đã có. Các lần sau, chỉnh sửa trực tiếp và gửi biểu mẫu sẽ lưu dòng vào hàng đợi rồi gửi ngay. Tác vụ `syncWorkspaceRegistrations` mười phút chỉ xử lý dòng đang chờ và đăng ký web chưa được Sheet xác nhận; `syncAllRegistrations` chỉ dùng để sửa dữ liệu thủ công.

Webhook từ chối yêu cầu khi khóa hoặc ID Sheet không đúng. Sheet vẫn giữ quyền truy cập riêng tư; Apps Script chỉ đọc các tab nguồn và gửi thông tin cần thiết đến Workspace. Nhập lại cùng dòng không tạo thêm lượt đăng ký. Ảnh người đăng ký tải lên Google Form được giữ dạng liên kết để kế toán xem; trạng thái đã nhận tiền và hóa đơn chỉ do kế toán cập nhật trên web.

Trong **Báo cáo thu chi → Đối soát khảo thí**, kế toán nhận hồ sơ mới, nhập số tiền phải thu, xác nhận tiền và số hóa đơn. Phần **Chuyển khoản chưa xác định** nhận ảnh bằng chọn tệp, kéo thả hoặc Ctrl+V (tối đa 5 MB). **Khảo thí → Khoản thu cần tra soát** cho phép tìm thí sinh và gửi kết quả lại kế toán.
