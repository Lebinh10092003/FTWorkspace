# Kế hoạch: giao diện theo phòng ban và chức danh

Trạng thái: **đã thống nhất hướng, chưa làm**. Ghi lại ngày 13/10/2026 để làm sau.

## Mục tiêu
Nhân viên đăng nhập chỉ thấy màn hình thuộc về mình: chức năng gọn, phẳng, không có
module chứa nhiều module khác. Ví dụ người Đào tạo số chỉ thấy chức năng Đào tạo số.
**Ưu tiên phòng ban trước, chức danh sau.**

## Hiện trạng (vì sao rối)
- Quyền đến từ ba nguồn: `role` (ADMIN/MANAGER/EMPLOYEE), `access_modules`, và dò chữ
  trong tên chức danh/phòng ban ("ke toan", "giam doc", "quan ly") ở `src/App.tsx`
  (`normalisedEmployeeIdentity`, `canViewFinance`). Đổi tên phòng ban là đổi quyền.
- Một chức năng nằm nhiều chỗ: "Đối soát khảo thí" ở Thu chi; "Trang giới thiệu cuộc thi"
  ở Bộ công cụ; lịch tập huấn Đào tạo số chảy sang Lịch làm việc.
- "Bộ công cụ" gom thứ không liên quan: Email, chữ ký, QR, đề xuất kinh phí, cấp số
  công văn, báo cáo tuần, trang giới thiệu cuộc thi.
- Menu có nhiều tầng thả xuống (Khảo thí: Cuộc thi ▸ …, Đề thi ▸ …).

## Thiết kế đã thống nhất
1. **Phòng ban → khu.** Mỗi phòng sở hữu một hoặc vài khu. Thanh bên chỉ hiện khu của
   phòng mình + mục cá nhân dùng chung (Lịch làm việc, Công ca, Đề xuất kinh phí, Báo cáo
   tuần, Cấp số công văn, Lịch coi thi của tôi). Người thuộc nhiều phòng thấy nhiều khu
   (`UserProfile.departments` đã là M2M). Đăng nhập vào thẳng khu phòng mình.
2. **Chức danh → mục trong khu.** Bậc: Nhân viên / Trưởng phòng–Quản lý / Ban giám đốc.
3. **Bật tắt tới từng mục nhỏ** (khoảng 60 mục, id lấy theo `src/config/workspaceNavigation.ts`).
   Mỗi mục 3 mức: **Ẩn / Xem / Sửa**. Chồng lớp: phòng ban → chức danh chỉnh trong phạm vi
   đó → cá nhân chỉ là ngoại lệ (đánh dấu rõ ô khác mẫu).
4. **Ẩn menu phải đi kèm chặn API** ở backend. Làm trước cho mục nhạy cảm: thu chi,
   đối soát, cấu hình, nhập dữ liệu, quản lý nhân viên.
5. Menu một tầng. Chức năng dùng chung giữa hai phòng hiện đúng một lần ở mỗi phòng cần
   nó (cùng component, cùng dữ liệu).
6. Tách "Bộ công cụ": Email/chữ ký/QR → Truyền thông; trang giới thiệu cuộc thi → Khảo thí;
   đề xuất kinh phí/cấp số/báo cáo tuần → mục cá nhân.
7. Bỏ dò chữ trong tên để suy quyền.
8. Liên kết chéo giữa các mục (vd Kỳ thi → Thí sinh) phải ẩn hoặc báo không có quyền khi
   mục đích bị tắt, không để màn hình trắng.

## Bảng phân khu tạm (chờ chủ dự án sửa)
| Phòng ban | Khu sở hữu |
|---|---|
| Khảo thí | Khảo thí (kỳ thi, thí sinh, coi thi, đề, lớp ôn, đối tác, trang giới thiệu) |
| Công nghệ & Đào tạo số | Đào tạo số (khách hàng, lịch tập huấn, BNDC, sản phẩm, bài kiểm tra cuối khóa) |
| Truyền thông | Truyền thông + Email, chữ ký, QR |
| Kế toán | Thu chi (báo cáo, đối soát khảo thí, chuyển khoản, hạn hợp đồng) |
| Hành chính – Nhân sự | Quản lý nhân viên, bảng công |
| Ban giám đốc | Xem tất cả |

## Thứ tự làm (mỗi bước một lần deploy)
1. Mô hình dữ liệu (khu/mục theo phòng ban, bậc chức danh, ngoại lệ cá nhân);
   `/api/auth/me` trả danh sách khu + mục + mức quyền.
2. Shell đọc danh sách đó: thanh bên, trang vào mặc định, menu một tầng.
3. Màn hình ma trận cho admin trong "Quản lý nhân viên" (hàng: khu ▸ mục; cột: phòng ban,
   mở rộng ra chức danh; ô: Ẩn/Xem/Sửa; hồ sơ cá nhân hiện kết quả cuối, tô ô khác mẫu).
4. Chặn backend cho mục nhạy cảm, rồi mở rộng dần.
5. Dọn "Bộ công cụ" và chức năng đặt sai chỗ; bỏ dò chữ trong tên.

## Câu hỏi còn chờ chủ dự án chốt
1. Danh sách phòng ban thật; ai thuộc nhiều phòng.
2. Nhân viên có được xem khu phòng khác ở chế độ chỉ xem không, hay ẩn hẳn
   (đề xuất: ẩn hẳn, admin bật riêng khi cần).
3. Ban giám đốc chỉ xem hay được sửa.

## Việc liên quan đang chờ
- Tăng tốc hàng đợi Lịch công tác (`sync_to_sheet`): chạy hết hàng đợi trong một lượt
  (lặp lại khi có thay đổi mới, gia hạn khóa, giới hạn số vòng) và bớt gọi Google API
  trùng lặp (`ensure_sync_columns` gọi hai lần, `_sheet_properties`/`ensure_sheet_row_capacity`
  đọc metadata lặp). Giữ timer 2 phút làm dự phòng. Chờ chủ dự án đồng ý vì đổi cơ chế hàng đợi.
