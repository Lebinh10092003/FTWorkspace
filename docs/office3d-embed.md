# Hợp đồng nhúng Văn phòng 3D (Workspace Embed Contract)

Tài liệu đặc tả cơ chế giao tiếp qua `window.postMessage` giữa FT Workspace (ứng dụng cha) và ứng dụng 3D `my-office` đặt tại `/office3d/vi/?embed=1` (iframe con).

---

## 1. Nguyên tắc bảo mật
1. **Kiểm tra Origin:** Cả ứng dụng cha và con đều bắt buộc kiểm tra `event.origin === window.location.origin` trước khi xử lý bất kỳ thông điệp nào.
2. **Kiểm tra Nguồn (Source):** Ứng dụng cha chỉ xử lý các thông điệp có `event.source === iframeElement.contentWindow`.
3. **Phân quyền nghiêm ngặt:** Khi nhận yêu cầu mở phân hệ (`ft-office:openModule`), ứng dụng cha đối soát với quyền hiện có của tài khoản (`access_modules` và vai trò). Nếu không có quyền, ứng dụng cha sẽ bỏ qua thông điệp.
4. **Không rò rỉ dữ liệu cá nhân:** Danh sách nhân sự (`roster`) do máy chủ cung cấp và chuyển tiếp vào iframe tuyệt đối không chứa email, số điện thoại, mã nhân viên hay dữ liệu cá nhân nhạy cảm của người khác.

---

## 2. Thông điệp từ Con (iframe) gửi lên Cha (Workspace)

### 2.1. Sẵn sàng nhận dữ liệu (`ready`)
Được gửi một lần sau khi thế giới 3D khởi tạo xong canvas và các hệ thống điều khiển:
```json
{
  "type": "ft-office:ready"
}
```

### 2.2. Người dùng nhấn vào lối vào phân hệ (`openModule`)
Được gửi khi người dùng nhấp vào đồ vật tương tác tương ứng trong phòng làm việc:
```json
{
  "type": "ft-office:openModule",
  "module": "work-schedule"
}
```
Các mã phân hệ (`module id`) chuẩn:
- `workspace`: Trang chủ Workspace
- `work-schedule`: Lịch làm việc & Nhiệm vụ
- `attendance`: Chấm công & Công ca
- `weekly-report`: Báo cáo tuần
- `examination`: Khảo thí
- `digital-training`: Công nghệ & Đào tạo số
- `finance-report`: Báo cáo thu chi
- `social-dashboard`: Truyền thông
- `communication-tools`: Bộ công cụ FermatTech
- `account-management`: Quản lý nhân viên
- `resources`: Tài nguyên dùng chung

### 2.3. Lỗi dựng hình / Không có WebGL (`error`)
Được gửi khi iframe phát hiện lỗi WebGL hoặc không thể khởi tạo ngữ cảnh 3D:
```json
{
  "type": "ft-office:error",
  "message": "Không thể khởi tạo WebGL context."
}
```

---

## 3. Thông điệp từ Cha (Workspace) gửi xuống Con (iframe)

### 3.1. Khởi tạo dữ liệu ban đầu (`init`)
Được gửi ngay sau khi nhận được thông điệp `ready` từ con:
```json
{
  "type": "ft-office:init",
  "theme": "light",
  "modules": [
    { "id": "workspace", "label": "Trang chủ" },
    { "id": "work-schedule", "label": "Lịch làm việc" }
  ],
  "roster": [
    {
      "name": "Nguyễn Văn A",
      "department": "Phòng Công nghệ",
      "job_title": "Lập trình viên",
      "seat": {
        "room": "tech",
        "seat_index": 2,
        "is_head": false
      },
      "online": true,
      "is_me": false,
      "avatar": {
        "skin_color": "#fadcbc",
        "hair_style": "short",
        "hair_color": "#090806",
        "outfit_color": "#2563eb",
        "glasses": "round"
      }
    }
  ]
}
```

### 3.2. Cập nhật nhịp hiện diện và danh sách nhân sự (`roster`)
Được gửi định kỳ mỗi ~30 giây khi tab đang hiển thị để đồng bộ người đang online / offline:
```json
{
  "type": "ft-office:roster",
  "roster": [ /* Danh sách cập nhật mới nhất từ /api/office/roster/ */ ]
}
```
