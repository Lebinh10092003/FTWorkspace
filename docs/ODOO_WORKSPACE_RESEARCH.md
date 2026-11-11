# Tham khảo Odoo cho FT Workspace

Khảo sát ngày 11/11/2026, dựa trên tài liệu chính thức Odoo 19 và đối chiếu mã nguồn Workspace. Các mục đề xuất bên dưới chưa được triển khai trong đợt sửa menu này.

## Điều chỉnh đang áp dụng

- Menu dọc mở đến cấp 2; nhóm có cấp 3 chỉ mở khi người dùng bấm. Nhóm chứa màn hình hiện tại vẫn được đánh dấu, không tự xổ toàn bộ cây.
- Breadcrumb giữ một hàng riêng; các cấp trước có thể bấm để quay về đúng màn hình. Dùng điều hướng trong ứng dụng thay vì tải lại trang.
- Trong Khảo thí, đường dẫn có tên hồ sơ/kỳ đang mở. Quay lại danh sách cùng nhóm giữ từ khóa, bộ lọc, phân trang đang có trong module và vị trí cuộn của danh sách.

Đây là lựa chọn thiết kế cho Workspace; không phải khẳng định sao chép toàn bộ cơ chế điều hướng của Odoo.

## Những chức năng nên làm tiếp

| Ưu tiên | Tham khảo Odoo | Áp dụng cho FT Workspace |
| --- | --- | --- |
| 1 | Lưu bộ lọc tìm kiếm, đặt mặc định, chia sẻ cho người được chọn | Lưu các bộ lọc như “FIMO · chưa nộp phí”, “Khách hàng sắp hết hạn”, “Việc của tôi”. Giữ cả cách sắp xếp và cột đang xem. |
| 1 | Hoạt động cần làm gắn với từng hồ sơ | Từ thí sinh, trường hoặc phiếu kinh phí, giao việc có người phụ trách và hạn: gọi phụ huynh, bổ sung chứng từ, kiểm tra danh sách. Đưa vào Lịch làm việc và thông báo đang có. |
| 2 | Chatter: trao đổi, ghi chú và lịch sử ngay trên hồ sơ | Mở rộng LogNotes đã có thành dòng trao đổi nội bộ, @nhắc đồng nghiệp, tệp đính kèm và lịch sử thay đổi. Không mặc định gửi ra ngoài hoặc gửi email. |
| 2 | Nút mở dữ liệu liên quan kèm số lượng | Trên hồ sơ trường: “Đăng ký 120”, “Chứng từ 3”, “Công nợ …”. Bấm phải mở đúng danh sách đã lọc, theo quyền hiện tại. |
| 2 | Command palette và phím tắt | Nâng Ctrl K đang có để tìm dữ liệu thật theo quyền; hiển thị tên màn hình, mã hồ sơ và nguồn kết quả. Kiểm tra xung đột trước khi thêm phím tắt lưu/tạo mới. |

Nguồn cho từng nhóm tính năng: [Search, filter, and group records](https://www.odoo.com/documentation/19.0/applications/general/search.html), [Activities](https://www.odoo.com/documentation/19.0/applications/essentials/activities.html), [Chatter](https://www.odoo.com/documentation/19.0/applications/productivity/discuss/chatter.html), [Project dashboard — smart buttons](https://www.odoo.com/documentation/19.0/applications/services/project/project_management/project_dashboard.html), [Keyboard shortcuts](https://www.odoo.com/documentation/19.0/applications/essentials/keyboard_shortcuts.html).

## Đối chiếu với hệ thống hiện tại

- Workspace đã có Lịch làm việc, thông báo và LogNotes ở Khảo thí. Nên nối các phần này với hồ sơ nghiệp vụ, không tạo thêm một hệ thống giao việc hoặc nhật ký riêng.
- `CommandPalette.tsx` đã có Ctrl K, nhưng danh sách lệnh còn chứa các trường học và số liệu minh họa được viết cố định. Cần thay bằng kết quả thật trước khi coi đây là tìm kiếm dữ liệu toàn Workspace.
- Bộ lọc và phân trang đã có ở nhiều màn hình, nhưng chưa có mẫu bộ lọc được lưu, đặt mặc định và chia sẻ thống nhất.
- Quyền truy cập phải được giữ ở cả danh sách, kết quả tìm kiếm, liên kết hồ sơ và số lượng hiển thị. Việc thêm tiện ích không tự cấp thêm quyền.

Đề xuất thứ tự: hoàn thiện tìm nhanh bằng dữ liệu thật → lưu bộ lọc → giao việc gắn hồ sơ → mở rộng trao đổi và liên kết dữ liệu. Không cần đưa thêm nhiều ứng dụng cấp cao lên menu.
