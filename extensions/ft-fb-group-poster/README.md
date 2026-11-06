# FT Workspace - Facebook Group Auto Poster Extension

Tiện ích mở rộng Google Chrome (Manifest V3) hỗ trợ kết nối FT Workspace để đăng bài viết đã duyệt vào các nhóm Facebook cá nhân đang tham gia một cách an toàn và tiện lợi.

---

## 1. Tính năng chính
- **Đồng bộ hàng đợi**: Lấy tự động danh sách các bài viết đã duyệt (`FbDraftPost`) từ FT Workspace.
- **Tự động mở nhóm**: 1-click mở nhóm Facebook đích và sao chép nội dung bài viết kèm hashtag vào Clipboard.
- **Trợ lý điền bài thông minh (Floating Helper)**: Khi vào trang Facebook Group, tiện ích hiển thị trợ lý nổi giúp tự động mở khung soạn thảo và điền nội dung.
- **Đồng bộ trạng thái**: Khi đăng xong, bấm "Đã đăng xong" để cập nhật trực tiếp link bài viết về FT Workspace.
- **An toàn tuyệt đối**: Chạy trên trình duyệt thật với IP thật và tài khoản thành viên thật của bạn, không bị Facebook quét checkpoint như các bot chạy server.

---

## 2. Hướng dẫn cài đặt trên trình duyệt Google Chrome / Brave / Edge

1. Mở trình duyệt Chrome, truy cập vào đường dẫn: `chrome://extensions/`
2. Bật công tắc **Chế độ dành cho nhà phát triển** (**Developer mode**) ở góc trên bên phải màn hình.
3. Bấm vào nút **Tải tiện ích đã giải nén** (**Load unpacked**).
4. Chọn thư mục: `FTWorkspace/extensions/ft-fb-group-poster`.
5. Tiện ích **FT Workspace - Facebook Group Auto Poster** sẽ xuất hiện trên thanh công cụ của Chrome. Bạn nên bấm vào biểu tượng ghim (Pin) để cố định icon trên thanh công cụ.

---

## 3. Cách sử dụng

1. **Cấu hình máy chủ**:
   - Bấm vào biểu tượng FT Group Poster trên thanh công cụ.
   - Nhập URL máy chủ Workspace (mặc định: `https://workspace.fermat.vn` hoặc `http://localhost:8000` nếu chạy local) và nhấn **Lưu**.
2. **Chọn bài và đăng nhóm**:
   - Bấm **Tải lại** để tải các bài viết đã duyệt từ Workspace.
   - Chọn nhóm Facebook mục tiêu trong danh sách xổ xuống.
   - Bấm **Mở nhóm & Điền bài**: Trình duyệt sẽ copy nội dung và mở tab nhóm Facebook đó ra.
3. **Đăng bài trên Facebook**:
   - Trên tab Facebook Group, bấm nút **Tự động điền** trên widget nổi góc dưới màn hình (hoặc bấm `Ctrl + V`).
   - Kiểm tra nội dung / đính kèm ảnh nếu muốn, rồi bấm nút **Đăng** của Facebook.
   - Bấm nút **Đã đăng xong ✓** trên widget để cập nhật về Workspace.
