# FTWorkspace Remote MCP

Full guide (Vietnamese): [MCP_KET_NOI.md](MCP_KET_NOI.md). The profile screen (Hồ sơ cá nhân > Trợ lý AI & MCP) also generates ready-to-paste configs per client.

- **URL:** `https://workspace.fermat.vn/api/mcp` (Streamable HTTP, stateless; GET/DELETE return 405).
- **Auth:** per-user AI Access Key `ft_ai_...`, created in the profile screen and revocable.
  - Header: `Authorization: Bearer ft_ai_...` (Cursor, VS Code, Claude Code).
  - URL: `https://workspace.fermat.vn/api/mcp?key=ft_ai_...` for clients that only take a URL (claude.ai and ChatGPT connectors, `mcp-remote` on Windows). The URL key may show up in server logs, so use one key per client.
  - Missing, invalid or revoked key: HTTP 401 with `WWW-Authenticate: Bearer`.
- **Protocol versions:** 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05.
- **ChatGPT Custom GPT Actions:** OpenAPI schema at `/api/mcp/openapi.json`, auth "API Key (Bearer)".

## Quick test (PowerShell)
~~~powershell
$key = Read-Host "FTWorkspace AI Access Key"
$headers = @{ Authorization = "Bearer $key"; Accept = "application/json, text/event-stream" }
$init = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"ps","version":"1"}}}'
Invoke-RestMethod -Uri "https://workspace.fermat.vn/api/mcp" -Method Post -Headers $headers -ContentType "application/json" -Body $init
~~~

Tests: `cd backend && python manage.py test mcp`
