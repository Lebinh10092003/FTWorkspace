# Xác nhận FIMO đợt 2

Nút trong thư mời FIMO gọi Workspace để thêm lượt vòng loại ngày 06/12/2026. Workspace ghi nhật ký và dùng hàng đợi hiện tại để cập nhật `FT - FIMO` trong Sheet Khảo thí. Bấm lại cùng link vẫn chỉ có một lượt ngày 06/12 và giữ kết quả của các đợt khác.

1. Đặt một khóa ngẫu nhiên riêng, dài ít nhất 32 ký tự, trong `FIMO_BATCH_2_WEBHOOK_SECRET` ở môi trường Django và Script properties của dự án gửi thư mời. Giữ khóa ngoài mã nguồn và Google Sheet.
2. Thêm `WorkspaceConfirmation.gs` vào dự án đang phục vụ link trong thư đã gửi. Trong nhánh bấm xác nhận, ngay sau khi xác thực token và tìm đúng dòng lời mời, gọi `syncFimoBatch2Confirmation_(maFT)` bằng mã FT lấy từ dòng đó. Gọi cả khi dòng đã được đánh dấu xác nhận để hỗ trợ bấm lại. Sau khi lời gọi thành công, giữ cách ghi trạng thái, thời gian và phản hồi thành công của dự án. Nếu có lỗi, hiển thị thông báo thử lại và ghi lỗi vào nhật ký thực thi.
3. Cập nhật bản triển khai web app hiện tại lên phiên bản mới để các link trong thư đã gửi vẫn dùng được. Nếu dự án giới hạn OAuth scopes, cấp thêm quyền `https://www.googleapis.com/auth/script.external_request` cho `UrlFetchApp`.
4. Kiểm tra bằng hồ sơ thử đã có điểm đợt 1. Xác nhận hai lần, kiểm tra mỗi đợt có một lượt và ngày 06/12 xuất hiện trong khối đợt 2 của `FT - FIMO`. Dùng đường dẫn thiếu token để kiểm tra nhánh từ chối.
