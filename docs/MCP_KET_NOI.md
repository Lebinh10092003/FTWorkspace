# Kết nối FTWorkspace với trợ lý AI qua MCP

FTWorkspace có một máy chủ MCP (Model Context Protocol). Kết nối xong, ChatGPT, Claude hoặc Cursor gọi được các công cụ nghiệp vụ: Đào tạo số, Khảo thí, Lịch công tác, Chấm công, Văn bản, Email. AI chỉ làm được những việc tài khoản của bạn được phép, và các thao tác thay đổi dữ liệu đều được ghi nhật ký.

- **URL MCP:** `https://workspace.fermat.vn/mcp` (hoặc `/api/mcp`, hai URL như nhau). Đường cũ `/api/mcp/rpc`, `/api/mcp/sse` vẫn nhận POST.
- **Xác thực mặc định: đăng nhập (OAuth 2.1).** Chỉ dán URL, ứng dụng AI tự mở trang đăng nhập FTWorkspace. Đăng nhập xong là dùng được, không cần mã.
- **Dự phòng:** Mã kết nối AI `ft_ai_...` (header `Authorization: Bearer ...` hoặc URL `?key=...`) cho ứng dụng không hỗ trợ OAuth.

## Cách kết nối (OAuth)

### ChatGPT
1. chatgpt.com > **Settings > Apps & Connectors > Advanced settings**, bật **Developer mode** (gói trả phí, bản web).
2. Bấm **Create**: tên `FTWorkspace`, URL `https://workspace.fermat.vn/mcp`, Authentication **OAuth**, bấm **Create**.
3. ChatGPT mở trang **Kết nối FTWorkspace**: đăng nhập email/mật khẩu (nếu đang đăng nhập web thì chỉ cần bấm **Cho phép**).
4. Chat mới: bấm **+ > Developer mode**, bật FTWorkspace.

### Claude (claude.ai, app điện thoại, Claude Desktop)
1. **Settings > Connectors > Add custom connector**, tên `FTWorkspace`, URL `https://workspace.fermat.vn/mcp`, để trống OAuth Client ID/Secret.
2. Bấm **Connect**, đăng nhập trên trang FTWorkspace hiện ra.

### Claude Code
```bash
claude mcp add --transport http ftworkspace https://workspace.fermat.vn/mcp
```
Gõ `/mcp`, chọn ftworkspace > **Authenticate**.

### Cursor / VS Code
`~/.cursor/mcp.json` (VS Code: `.vscode/mcp.json`, đổi `mcpServers` thành `servers`):
```json
{ "mcpServers": { "ftworkspace": { "url": "https://workspace.fermat.vn/mcp" } } }
```
Bấm Connect/Login cạnh ftworkspace.

### Ngắt kết nối
**Hồ sơ cá nhân > Trợ lý AI & MCP > Ứng dụng AI đã đăng nhập > Ngắt kết nối.** Khóa tài khoản cũng làm mọi kết nối ngừng hoạt động.

## Dự phòng: Mã kết nối AI (ft_ai_)

Chỉ dùng khi ứng dụng không hỗ trợ OAuth.

1. **Hồ sơ cá nhân > Trợ lý AI & MCP**, đặt tên rồi bấm **Tạo mã kết nối mới**, sao chép mã ngay (chỉ hiện một lần).
2. Dùng URL `https://workspace.fermat.vn/mcp?key=ft_ai_MA_CUA_BAN` (Authentication: none) hoặc header `Authorization: Bearer ft_ai_MA_CUA_BAN`.
3. Claude Desktop bằng file cấu hình: `"args": ["-y", "mcp-remote", "https://workspace.fermat.vn/mcp?key=ft_ai_MA_CUA_BAN"]` (mã để trong URL vì `npx` trên Windows tách tham số theo dấu cách).
4. Custom GPT Actions: schema `https://workspace.fermat.vn/api/mcp/openapi.json`, Authentication *API Key, Bearer*. Lưu ý mỗi GPT chỉ nhận khoảng 30 thao tác.

Mỗi ứng dụng dùng một mã riêng. Lộ mã thì bấm **Thu hồi** rồi tạo mã khác.

## Kiểm tra nhanh

Hỏi AI: *"Tôi là ai trên FTWorkspace?"*. AI sẽ gọi công cụ `system_whoami` và trả về email, vai trò của bạn.

| Hiện tượng | Nguyên nhân và cách xử lý |
|---|---|
| "Không thể kết nối: ứng dụng chưa đăng ký" trên trang đăng nhập | Phiên kết nối cũ. Xóa connector trong ứng dụng AI rồi tạo lại. |
| 401 sau một thời gian dài không dùng | Phiên đăng nhập hết hạn (60 ngày không dùng) hoặc đã bị ngắt. Bấm Connect lại. |
| "Từ chối quyền truy cập ... phân hệ" | Tài khoản chưa được cấp phân hệ đó. Nhờ quản trị viên cấp quyền. |
| Claude Desktop báo lỗi `npx` | Chưa cài Node.js, hoặc cần khởi động lại máy sau khi cài. |

## Lưu ý bảo mật

- **OAuth:** PKCE S256 bắt buộc; client tự đăng ký (RFC 7591) hoặc dùng client_id dạng URL tài liệu metadata. Access token `ft_oat_` sống 8 giờ, refresh token `ft_ort_` 60 ngày và đổi mới mỗi lần làm mới. Mã ủy quyền dùng một lần, sống 5 phút. Mọi mã chỉ lưu dạng SHA-256 (`backend/mcp_oauth`).
- Trang đăng nhập OAuth dùng chung bộ chặn dò mật khẩu với trang web: khóa 15 phút khi một email sai 10 lần hoặc một IP sai 50 lần trong 15 phút.
- AI không bao giờ nhận mật khẩu: người dùng chỉ gõ mật khẩu trên trang FTWorkspace. MCP không nhận email/mật khẩu trong header, body hay khung chat.
- Mã `ft_ai_` trong URL có thể nằm trong nhật ký nginx và lịch sử ứng dụng; ưu tiên OAuth.
- Mật khẩu tài khoản AI của khách hàng bị che khi tra cứu (`crm_list_ai_accounts`); chỉ hiện khi gửi `show_passwords: true`, và mỗi lần hiện hoặc xuất danh sách đều ghi nhật ký.
- Nhật ký audit MCP tự che mọi trường mật khẩu/token/mã kết nối (`redact_secrets` trong `security.py`).
- Tài khoản công ty (`company_*`) chỉ Admin dùng được. Xem mật khẩu phải nêu lý do (`company_get_account_password`), được ghi vào nhật ký của tài khoản đó.

## Công cụ mới (v1.2)

| Công cụ | Quyền | Việc |
|---|---|---|
| `crm_pipeline_overview` | Nhân viên Đào tạo số | Khách hàng mới theo giai đoạn, dịch vụ sắp/đã hết hạn, tài khoản AI sắp hết hạn |
| `crm_list_meetings` | Nhân viên Đào tạo số | Lịch gặp khách hàng theo khoảng ngày, khách hàng, nhân viên |
| `crm_update_customer` | Quản lý | Sửa liên hệ, địa chỉ, trạng thái hợp đồng; thêm đầu mối; nối thêm ghi chú chăm sóc |
| `company_list_accounts`, `company_accounts_overview` | Admin | Tra cứu tài khoản công ty, chi phí/tháng, lịch gia hạn |
| `company_create_account`, `company_update_account`, `company_delete_account` | Admin | Thêm/sửa/xóa (xóa cần `confirm: true`) |
| `company_get_account_password` | Admin | Lấy mật khẩu, bắt buộc có `reason` |
| `exam_list_round_results` | Nhân viên Khảo thí | Thí sinh của một vòng: SBD, phòng, điểm, xếp hạng, kết quả; lọc người chưa có điểm |
| `exam_update_round_results` | Quản lý Khảo thí | Nhập điểm/kết quả theo mã FT vào bản kết quả sẵn có của vòng; tự ghi ra Sheet như web; dòng lỗi chỉ bỏ qua dòng đó |
| `exam_list_rooms` | Nhân viên Khảo thí | Phòng thi, sức chứa, số thí sinh đã xếp, ca và giám thị (chỉ xem) |
| `exam_billing_overview` | Có quyền Báo cáo thu chi | Đối soát lệ phí: chờ chuyển khoản, chờ hóa đơn, đã thu (chỉ xem) |

Mỗi công cụ có `annotations` theo đặc tả MCP (`readOnlyHint`, `destructiveHint`) để ứng dụng AI biết khi nào cần hỏi xác nhận.

## Nhập tài khoản có mật khẩu (ChatGPT chặn lệnh gọi chứa mật khẩu)

ChatGPT tự chặn lệnh gọi công cụ có mật khẩu trong tham số ("bị chặn bởi cơ chế kiểm tra an toàn của OpenAI"). Lệnh đó không tới FTWorkspace. Vì vậy dữ liệu có mật khẩu nhập qua Google Sheet: AI chỉ gửi link và tên cột, máy chủ tự đọc Sheet. Kết quả trả về không chứa mật khẩu.

| Công cụ | Quyền | Việc |
|---|---|---|
| `crm_import_ai_accounts_from_sheet` | Nhân viên Đào tạo số | Tài khoản AI của khách hàng: email, mật khẩu, người nhận, nền tảng; cột Trường (nếu có) để chia theo từng khách hàng |
| `company_import_accounts_from_sheet` | Admin | Tài khoản công ty: tên dịch vụ, email đăng nhập, mật khẩu (mã hóa khi lưu), 2FA, phụ trách, gói, chi phí, ngày gia hạn |

1. Chia sẻ file Sheet (quyền Xem) cho email Service Account của FTWorkspace. Nếu chưa chia sẻ, công cụ báo lỗi kèm đúng email cần chia sẻ.
2. Nói với AI, ví dụ: *"Nhập tài khoản AI cho THCS Thực Nghiệm từ Sheet <link>, tab 'Tài khoản', chạy thử trước."*
3. AI chạy `dry_run: true`: xem cột nhận được, số dòng, dòng bị bỏ qua (không ghi gì). Đúng thì AI chạy lại để nhập.

- Tự nhận tên cột tiếng Việt/Anh ("Email", "Mật khẩu", "Họ và tên giáo viên", "Tên dịch vụ"...). Không nhận ra thì truyền `columns`, ví dụ `{"username": "Hộp thư", "password": "Khóa"}`.
- Dòng lỗi (thiếu email, trường không có trên web, dữ liệu sai) chỉ bỏ qua dòng đó. Trùng tài khoản thì cập nhật; ô mật khẩu trống không xóa mật khẩu đã có (tài khoản AI mới thì tự sinh).
- `crm_import_ai_accounts` cũ vẫn dùng được cho dữ liệu không có mật khẩu, và không còn trả mật khẩu về khung chat.

## Cho lập trình viên

- Endpoint chính `/mcp` = `/api/mcp` (nginx chuyển `/mcp` vào Django, route ở `config/urls.py`): `backend/mcp/streamable.py` (Streamable HTTP, stateless, không cấp session). Đường cũ `/api/mcp/rpc`, `/api/mcp/sse`, `/api/mcp/messages` nằm ở `views.py`.
- Xác thực: `security.py` (`resolve_user_context`) nhận `Bearer ft_oat_` (OAuth) hoặc mã `ft_ai_`. Thiếu hoặc sai thì 401 kèm `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"`.
- OAuth: `backend/mcp_oauth` (models, services, views, template `authorize.html`). Metadata `/.well-known/oauth-protected-resource[/mcp|/api/mcp]` và `/.well-known/oauth-authorization-server` do Django trả (nginx chuyển vào). Endpoint: `/api/oauth/register`, `/api/oauth/authorize`, `/api/oauth/token`, `/api/oauth/revoke`. Danh sách/ngắt kết nối của người dùng: `/api/mcp/oauth-connections`. Đặt `MCP_PUBLIC_BASE_URL` nếu cần ép URL gốc.
- Phiên bản giao thức hỗ trợ: `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`. Notification trả HTTP 202. Không hỗ trợ batch (đặc tả 2025-06-18 đã bỏ).
- Gọi công cụ thiếu quyền, sai tham số hoặc công cụ lỗi đều trả kết quả `isError` (HTTP 200) để AI đọc được. Mã sai/đã thu hồi trả 401 với `WWW-Authenticate: Bearer error="invalid_token"`.
- Kho mã (`keys.py`) ghi trong giao dịch có khóa dòng để không mất mã khi tạo đồng thời; "lần dùng cuối" ghi tối đa 10 phút một lần. Tài khoản ngừng hoạt động (`is_active=False`) không dùng được mã.
- Test: `backend/mcp/test_streamable.py`, `test_client_flow.py`, `tests.py` (`MCPStreamableHttpTests`), `backend/mcp_oauth/tests.py`. Workflow CI: `.github/workflows/mcp-transport.yml`.
