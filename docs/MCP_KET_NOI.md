# Kết nối FTWorkspace với trợ lý AI qua MCP

FTWorkspace có một máy chủ MCP (Model Context Protocol). Kết nối xong, Claude, Cursor hoặc ChatGPT gọi được các công cụ nghiệp vụ: Đào tạo số, Khảo thí, Lịch công tác, Chấm công, Văn bản, Email. AI chỉ làm được những việc tài khoản của bạn được phép, và các thao tác thay đổi dữ liệu đều được ghi nhật ký.

- **URL MCP:** `https://workspace.fermat.vn/mcp`
- **Kiểu kết nối:** Streamable HTTP. Đường cũ `/api/mcp/rpc` và `/api/mcp/sse` vẫn nhận POST để cấu hình cũ không hỏng, nhưng cấu hình mới nên dùng `/mcp` (hoặc `/api/mcp`, hai URL như nhau).
- **Xác thực:** Mã kết nối AI dạng `ft_ai_...`, gửi qua header `Authorization: Bearer ...` hoặc trên URL `?key=...`. Không có mã thì máy chủ trả 401.

## Bước 1: Tạo mã kết nối AI

1. Đăng nhập web, mở **Hồ sơ cá nhân > Trợ lý AI & MCP**.
2. Đặt tên (ví dụ "Claude Desktop") rồi bấm **Tạo mã kết nối mới**.
3. Sao chép mã ngay, vì mã chỉ hiện một lần.

Mỗi ứng dụng nên dùng một mã riêng. Mã bị lộ thì bấm **Thu hồi** rồi tạo mã khác.

Ngay dưới khung tạo mã có phần **Kết nối MCP**. Mã vừa tạo được điền sẵn vào cấu hình, chỉ cần chép.

## Bước 2: Kết nối từng ứng dụng

### Claude (claude.ai, app điện thoại)
1. **Settings > Connectors > Add custom connector**.
2. Tên: `FTWorkspace`. URL: `https://workspace.fermat.vn/mcp?key=ft_ai_MA_CUA_BAN`. Bỏ trống phần OAuth.
3. Trong khung chat, bật FTWorkspace ở nút công cụ.

### Claude Desktop
Cần Node.js 18 trở lên. Mở **Settings > Developer > Edit Config** và thêm đoạn sau:

```json
{
  "mcpServers": {
    "ftworkspace": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://workspace.fermat.vn/mcp?key=ft_ai_MA_CUA_BAN"]
    }
  }
}
```

Mã đặt trong URL vì trên Windows `npx` tách tham số theo dấu cách, làm hỏng `--header "Authorization: Bearer ..."`.

Lưu file, thoát hẳn Claude Desktop (cả biểu tượng ở khay hệ thống) rồi mở lại.

### Claude Code

```bash
claude mcp add --transport http ftworkspace https://workspace.fermat.vn/mcp --header "Authorization: Bearer ft_ai_MA_CUA_BAN"
```

Gõ `/mcp` trong Claude Code để kiểm tra kết nối.

### Cursor
Thêm vào `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ftworkspace": {
      "url": "https://workspace.fermat.vn/mcp",
      "headers": { "Authorization": "Bearer ft_ai_MA_CUA_BAN" }
    }
  }
}
```

VS Code dùng cùng nội dung trong `.vscode/mcp.json`, chỉ đổi `mcpServers` thành `servers`.

### ChatGPT
- **Connector (Developer mode):** vào Settings > Apps & Connectors > Advanced, bật Developer mode, bấm Create. Dán URL `https://workspace.fermat.vn/mcp?key=ft_ai_MA_CUA_BAN` và chọn *No authentication*.
- **Custom GPT Actions:** nhập schema `https://workspace.fermat.vn/api/mcp/openapi.json`. Authentication chọn *API Key, Bearer* rồi dán mã.

## Kiểm tra nhanh

Hỏi AI: *"Tôi là ai trên FTWorkspace?"*. AI sẽ gọi công cụ `system_whoami` và trả về email, vai trò của bạn.

| Hiện tượng | Nguyên nhân và cách xử lý |
|---|---|
| Báo lỗi 401, "Missing/Invalid MCP access token", hoặc "không xác định được cài đặt OAuth" | Chưa gắn mã, mã sai hoặc đã bị thu hồi. Kiểm tra header `Authorization: Bearer ft_ai_...` hoặc `?key=` trên URL, tạo mã mới nếu cần. |
| "Từ chối quyền truy cập ... phân hệ" | Tài khoản chưa được cấp phân hệ đó. Nhờ quản trị viên cấp quyền. |
| Claude Desktop báo lỗi `npx` | Chưa cài Node.js, hoặc cần khởi động lại máy sau khi cài. |
| Kết nối treo khi dùng URL `/api/mcp/sse` | Đổi sang URL `/mcp`. |

## Lưu ý bảo mật

- Mã đặt trong URL (`?key=`) có thể bị ghi vào nhật ký máy chủ (nginx) và lịch sử của ứng dụng. Chỉ dùng cách này khi ứng dụng không cho nhập header (claude.ai, ChatGPT, Claude Desktop trên Windows). Mỗi ứng dụng dùng một mã riêng để thu hồi được riêng.
- URL chỉ nhận mã `ft_ai_`, không bao giờ nhận mật khẩu.

## Cho lập trình viên

- Endpoint chính `/mcp` = `/api/mcp` (nginx chuyển `/mcp` vào Django, route ở `config/urls.py`): `backend/mcp/streamable.py` (Streamable HTTP, stateless, không cấp session). Đường cũ `/api/mcp/rpc`, `/api/mcp/sse`, `/api/mcp/messages` nằm ở `views.py`.
- Xác thực: `security.py` (`resolve_user_context`). `/api/mcp` bắt buộc có mã (header hoặc `?key=ft_ai_`); thiếu hoặc sai thì trả 401 kèm `WWW-Authenticate: Bearer`. Nginx trả metadata RFC 9728 ở `/.well-known/oauth-protected-resource`.
- Phiên bản giao thức hỗ trợ: `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`. Notification trả HTTP 202. Không hỗ trợ batch (đặc tả 2025-06-18 đã bỏ).
- Gọi công cụ thiếu quyền, sai tham số hoặc công cụ lỗi đều trả kết quả `isError` (HTTP 200) để AI đọc được. Mã sai/đã thu hồi trả 401 với `WWW-Authenticate: Bearer error="invalid_token"`.
- Kho mã (`keys.py`) ghi trong giao dịch có khóa dòng để không mất mã khi tạo đồng thời; "lần dùng cuối" ghi tối đa 10 phút một lần. Tài khoản ngừng hoạt động (`is_active=False`) không dùng được mã.
- Test: `backend/mcp/test_streamable.py`, `test_client_flow.py`, `tests.py` (`MCPStreamableHttpTests`). Workflow CI: `.github/workflows/mcp-transport.yml`.
