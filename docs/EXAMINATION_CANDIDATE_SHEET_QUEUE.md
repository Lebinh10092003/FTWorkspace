# Đồng bộ thí sinh theo sự kiện

Khi lưu hồ sơ, tham gia kỳ thi hoặc kết quả vòng thi, hệ thống ghi `CandidateSheetOutbox` và `SessionSheetOutbox` vào cơ sở dữ liệu. Sau khi giao dịch hoàn thành, một worker được gọi để gửi dữ liệu. Các thay đổi liên tiếp của cùng hồ sơ được gộp lại; phiên bản hàng đợi giúp giữ lại thay đổi mới phát sinh trong lúc worker đang gửi.

- Tab `Phụ huynh Thí sinh từng tham gi` của Sheet danh bạ được cập nhật theo hồ sơ đang chờ. Không chạy quét lại toàn bộ thí sinh mỗi 15 phút. Các cột danh bạ hiện có được giữ làm bản sao hồ sơ cơ bản, không bổ sung CCCD, địa chỉ hay tài khoản thi vào tab này.
- Mọi kỳ thi có tab Google Sheet liên kết ở trạng thái `registration-source` hoặc `session-output` nhận thí sinh mới qua hàng đợi. Worker kiểm tra hàng tiêu đề của mẫu thí sinh trước khi ghi, tìm hồ sơ đã có rồi chỉ ghi thêm người còn thiếu. Dữ liệu hiện có của Sheet không bị ghi đè.
- Workbook Form đăng ký cá nhân có định dạng riêng và dùng hàng đợi `PublicExamRegistration` cùng Apps Script để nhận dữ liệu từ web.
- Worker lỗi giữ nguyên công việc và ghi số lần thử, thông báo lỗi. Timer một phút chỉ thử công việc còn chờ; khi hàng đợi rỗng sẽ không gọi Google Sheets. Công việc mới được ưu tiên trước các công việc đã lỗi nhiều lần.

Kiểm tra/ chạy lại: `python backend/manage.py sync_examination_candidate_queue`. Danh bạ và các kỳ thi được xử lý độc lập nên lỗi tab danh bạ không ngăn xử lý các kỳ thi.

Lần triển khai đầu tiên tạo việc chờ cho các hồ sơ đã có trong những kỳ thi đang liên kết Sheet, để bổ sung phần còn thiếu. Những lần triển khai tiếp theo không quét lại toàn bộ danh sách.

Kiểm tra Apps Script: `node apps-script/registration-2026-2027/Code.test.cjs`.
