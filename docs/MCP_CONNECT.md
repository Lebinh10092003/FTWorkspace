# FTWorkspace Remote MCP

## Server
Production: https://workspace.fermat.vn/api/mcp
Local: http://127.0.0.1:8000/api/mcp

Use the new Streamable HTTP endpoint for new remote MCP clients.
Do not select the old /api/mcp/rpc or /api/mcp/sse endpoints.
This service is stateless and responds with JSON-RPC over POST; GET
subscriptions return HTTP 405, as permitted by the protocol.

## Generate credentials
1. Sign in to FTWorkspace.
2. Account menu -> Chỉnh sửa hồ sơ -> Trợ lý AI & MCP (ChatGPT).
3. Create a separate AI Access Key for each integration.
4. Copy the ft_ai_... key: it is only displayed once.
5. To revoke access, revoke the key in FTWorkspace.

## Cursor (user settings or local .cursor/mcp.json)
~~~json
{
  "mcpServers": {
    "ftworkspace": {
      "url": "https://workspace.fermat.vn/api/mcp",
      "headers": {
        "Authorization": "Bearer ft_ai_REPLACE_WITH_YOUR_KEY"
      }
    }
  }
}
~~~

Do not commit real credentials into Git. Keep this config local or use a
client-supported environment variable or secret store.

## Claude and other remote MCP clients
Transport: Streamable HTTP
URL: https://workspace.fermat.vn/api/mcp
HTTP Header: Authorization: Bearer ft_ai_REPLACE_WITH_YOUR_KEY

For clients that do not accept custom HTTP headers, a local MCP bridge
may be needed to inject the Authorization header.

## ChatGPT
Custom GPT Actions are already supported:
https://workspace.fermat.vn/api/mcp/openapi.json
Choose API Key (Bearer) in the GPT Action authentication settings.

Native ChatGPT custom MCP plugins support OAuth or no authentication, not
arbitrary customer-provided static API keys. This endpoint is protected
by per-user FTWorkspace credentials. Do not make it anonymous to work
around this limitation. Native ChatGPT MCP requires an OAuth integration
with a proper identity provider / authorization server first.

## Test with PowerShell
~~~powershell
$key = Read-Host "FTWorkspace AI Access Key"
$headers = @{
  Authorization = "Bearer $key"
  Accept = "application/json, text/event-stream"
  "MCP-Protocol-Version" = "2025-11-25"
}
$init = @{
  jsonrpc = "2.0"
  id = 1
  method = "initialize"
  params = @{
    protocolVersion = "2025-11-25"
    capabilities = @{}
    clientInfo = @{name = "powershell-test"; version = "1.0"}
  }
} | ConvertTo-Json -Depth 8
Invoke-RestMethod -Uri "https://workspace.fermat.vn/api/mcp" -Method Post -Headers $headers -ContentType "application/json" -Body $init

$tools = @{jsonrpc="2.0"; id=2; method="tools/list"} | ConvertTo-Json
Invoke-RestMethod -Uri "https://workspace.fermat.vn/api/mcp" -Method Post -Headers $headers -ContentType "application/json" -Body $tools
~~~

Expected: initialize returns serverInfo.name = FTWorkspace-MCP. tools/list
returns only tools available to the authenticated user's role. A revoked
or missing key returns HTTP 401; an unauthorized tool call returns 403.

## Implementation / deployment
- Supports MCP versions 2025-03-26, 2025-06-18 and 2025-11-25.
- No server-side sessions or SSE subscriptions. Each POST is authenticated.
- Validates Origin and JSON-RPC envelopes.
- Preserves existing tool logic, authorization and audit logging.
- The existing Nginx /api/ reverse proxy sends traffic to Django/Gunicorn.
  Deploy with the repository's normal deployment process (deploy.sh).
- Django tests: cd backend && python manage.py test mcp.test_streamable mcp.tests
