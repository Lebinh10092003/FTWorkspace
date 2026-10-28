import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Plug, Unplug } from 'lucide-react';

type ClientId = 'claude-web' | 'claude-desktop' | 'claude-code' | 'cursor' | 'chatgpt';
type OAuthConnection = { id: number; client: string; created_at: string; last_used_at: string | null };

const KEY_PLACEHOLDER = 'ft_ai_MA_CUA_BAN';
const LOGIN_STEP = 'Trang đăng nhập FTWorkspace sẽ tự mở: đăng nhập (hoặc bấm "Cho phép" nếu đang đăng nhập web) là xong.';

// Mặc định đăng nhập OAuth: chỉ cần URL, ứng dụng AI tự mở trang đăng nhập FTWorkspace.
// Mã ft_ai_ chỉ dùng khi ứng dụng không hỗ trợ OAuth.
function buildSnippet(client: ClientId, mcpUrl: string, key: string, useKey: boolean): { steps: string[]; code: string } {
  const url = useKey ? `${mcpUrl}?key=${key}` : mcpUrl;
  const auth = useKey ? 'URL đã kèm mã nên không cần đăng nhập.' : LOGIN_STEP;
  switch (client) {
    case 'claude-web':
      return {
        steps: [
          'Mở claude.ai > Settings > Connectors > Add custom connector.',
          'Đặt tên "FTWorkspace", dán URL bên dưới, để trống OAuth Client ID/Secret, bấm Add rồi bấm Connect.',
          auth,
          'Trong khung chat, bật FTWorkspace ở nút công cụ rồi hỏi bình thường, ví dụ "Tôi là ai trên FTWorkspace?".',
        ],
        code: url,
      };
    case 'claude-desktop':
      return {
        steps: [
          'Cách nhanh nhất: Claude Desktop > Settings > Connectors > Add custom connector, dán URL như bản web.',
          'Hoặc cài Node.js 18+, mở Settings > Developer > Edit Config, dán đoạn dưới vào claude_desktop_config.json, lưu rồi mở lại Claude Desktop.',
          auth,
        ],
        code: JSON.stringify({ mcpServers: { ftworkspace: { command: 'npx', args: ['-y', 'mcp-remote', url] } } }, null, 2),
      };
    case 'claude-code':
      return useKey
        ? {
            steps: ['Chạy lệnh dưới trong terminal, sau đó gõ /mcp trong Claude Code để kiểm tra.'],
            code: `claude mcp add --transport http ftworkspace ${mcpUrl} --header "Authorization: Bearer ${key}"`,
          }
        : {
            steps: ['Chạy lệnh dưới trong terminal.', 'Trong Claude Code gõ /mcp, chọn ftworkspace > Authenticate.', LOGIN_STEP],
            code: `claude mcp add --transport http ftworkspace ${mcpUrl}`,
          };
    case 'cursor':
      return {
        steps: [
          'Mở Cursor > Settings > MCP > Add new MCP server (hoặc sửa file ~/.cursor/mcp.json).',
          'Dán đoạn dưới, lưu lại. Với VS Code dùng cùng nội dung trong .vscode/mcp.json, đổi "mcpServers" thành "servers".',
          useKey ? 'Mã nằm trong header nên không cần đăng nhập.' : `Bấm Connect/Login cạnh ftworkspace. ${LOGIN_STEP}`,
        ],
        code: JSON.stringify(
          { mcpServers: { ftworkspace: useKey ? { url: mcpUrl, headers: { Authorization: `Bearer ${key}` } } : { url: mcpUrl } } },
          null,
          2,
        ),
      };
    case 'chatgpt':
    default:
      return {
        steps: [
          'ChatGPT (web) > Settings > Apps & Connectors > Advanced settings > bật Developer mode.',
          `Bấm Create, đặt tên "FTWorkspace", dán URL bên dưới, Authentication chọn ${useKey ? 'No authentication' : 'OAuth'}, bấm Create.`,
          auth,
          'Trong chat mới: bấm + > Developer mode > bật FTWorkspace rồi hỏi bình thường.',
        ],
        code: url,
      };
  }
}

const CLIENTS: { id: ClientId; label: string }[] = [
  { id: 'chatgpt', label: 'ChatGPT' },
  { id: 'claude-web', label: 'Claude (web/app)' },
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor / VS Code' },
];

function formatShort(value: string) {
  return new Date(value).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

export default function McpConnectGuide({ mcpUrl, apiKey, idToken }: { mcpUrl: string; apiKey: string | null; idToken?: string | null }) {
  const [client, setClient] = useState<ClientId>('chatgpt');
  const [copied, setCopied] = useState<string | null>(null);
  const [useKey, setUseKey] = useState(false);
  const [connections, setConnections] = useState<OAuthConnection[]>([]);
  const key = apiKey || KEY_PLACEHOLDER;
  const { steps, code } = buildSnippet(client, mcpUrl, key, useKey);

  const loadConnections = useCallback(async () => {
    if (!idToken) return;
    try {
      const response = await fetch('/api/mcp/oauth-connections', { headers: { Authorization: `Bearer ${idToken}` }, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(data.connections)) setConnections(data.connections);
    } catch {
      // Danh sách chỉ để xem; lỗi mạng thì giữ danh sách cũ.
    }
  }, [idToken]);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  const disconnect = async (id: number) => {
    if (!idToken) return;
    await fetch(`/api/mcp/oauth-connections/${id}/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${idToken}` } }).catch(() => undefined);
    void loadConnections();
  };

  const copy = (text: string, id: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="rounded-2xl border border-violet-200 dark:border-violet-900/60 bg-violet-50/50 dark:bg-violet-950/20 p-4 sm:p-5 text-[var(--ft-text-main)]">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-violet-600 dark:bg-violet-500 text-white shadow-xs shrink-0">
          <Plug className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-extrabold text-[var(--ft-text-main)] text-base">Kết nối MCP với ChatGPT, Claude, Cursor</h3>
          <p className="mt-1 text-xs sm:text-sm text-[var(--ft-text-sub)] leading-relaxed">
            Chỉ cần dán URL bên dưới vào ứng dụng AI. Ứng dụng sẽ tự mở trang đăng nhập FTWorkspace, bạn đăng nhập là kết nối xong.
            AI chỉ làm được những việc tài khoản của bạn được phép.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <input
          readOnly
          value={mcpUrl}
          aria-label="URL máy chủ MCP"
          className="ft-input w-full min-w-0 bg-[var(--ft-card-bg)] font-mono text-xs text-[var(--ft-text-main)] min-h-[44px] px-3.5 rounded-xl border border-[var(--ft-border)]"
        />
        <button
          type="button"
          onClick={() => copy(mcpUrl, 'url')}
          className="ft-primary inline-flex items-center justify-center gap-1.5 text-xs font-bold whitespace-nowrap shrink-0 min-h-[44px] px-4 w-full sm:w-auto rounded-xl cursor-pointer shadow-xs"
        >
          {copied === 'url' ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
          {copied === 'url' ? 'Đã sao chép' : 'Sao chép URL MCP'}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Chọn ứng dụng AI">
        {CLIENTS.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={client === item.id}
            onClick={() => setClient(item.id)}
            className={`min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-bold transition cursor-pointer ${
              client === item.id
                ? 'bg-violet-600 dark:bg-violet-500 text-white shadow-xs'
                : 'bg-[var(--ft-card-bg)] text-[var(--ft-text-sub)] border border-[var(--ft-border)] hover:bg-[var(--ft-surface-2)] hover:text-[var(--ft-text-main)]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <ol className="mt-3.5 list-decimal space-y-1.5 pl-5 text-xs text-[var(--ft-text-sub)] leading-relaxed">
        {steps.map(step => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <div className="mt-3.5 relative">
        <pre className="max-h-60 overflow-auto rounded-xl bg-slate-900 dark:bg-slate-950 p-3.5 pr-24 text-xs leading-relaxed text-slate-100 whitespace-pre-wrap break-all border border-slate-800">
          {code}
        </pre>
        <button
          type="button"
          onClick={() => copy(code, 'code')}
          className="absolute right-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-bold text-white transition cursor-pointer min-h-[36px]"
        >
          {copied === 'code' ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
          {copied === 'code' ? 'Đã chép' : 'Chép mã'}
        </button>
      </div>

      <label className="mt-3.5 flex items-start gap-2.5 text-xs text-[var(--ft-text-sub)] cursor-pointer">
        <input
          type="checkbox"
          checked={useKey}
          onChange={event => setUseKey(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
        />
        <span>Ứng dụng không hỗ trợ đăng nhập (OAuth)? Dùng Mã kết nối AI (ft_ai_) ở khung trên thay thế.</span>
      </label>
      {useKey && !apiKey && (
        <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
          Thay <span className="font-mono font-bold">{KEY_PLACEHOLDER}</span> bằng mã ft_ai_ bạn đã lưu. Mã vừa tạo sẽ tự điền vào đây.
        </p>
      )}

      {connections.length > 0 && (
        <div className="mt-4 rounded-xl border border-[var(--ft-border)] bg-[var(--ft-card-bg)] overflow-hidden">
          <div className="border-b border-[var(--ft-border)] bg-[var(--ft-surface-2)] px-3.5 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--ft-text-sub)]">
            Ứng dụng AI đã đăng nhập
          </div>
          <ul className="divide-y divide-[var(--ft-border)]/60">
            {connections.map(item => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold text-[var(--ft-text-main)]">{item.client}</div>
                  <div className="text-xs text-[var(--ft-text-sub)]">
                    Kết nối {new Date(item.created_at).toLocaleDateString('vi-VN')} ·{' '}
                    {item.last_used_at ? `dùng gần nhất ${formatShort(item.last_used_at)}` : 'chưa dùng'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void disconnect(item.id)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 min-h-[44px] cursor-pointer"
                >
                  <Unplug className="h-4 w-4" /> Ngắt kết nối
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
