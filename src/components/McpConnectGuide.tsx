import React, { useState } from 'react';
import { Check, Copy, Plug } from 'lucide-react';

type ClientId = 'claude-web' | 'claude-desktop' | 'claude-code' | 'cursor' | 'chatgpt';

const KEY_PLACEHOLDER = 'ft_ai_MA_CUA_BAN';

function buildSnippet(client: ClientId, mcpUrl: string, key: string): { steps: string[]; code: string } {
  switch (client) {
    case 'claude-web':
      return {
        steps: [
          'Mở claude.ai > Settings > Connectors > Add custom connector.',
          'Đặt tên "FTWorkspace", dán URL bên dưới (đã kèm mã), bấm Add. Không cần điền OAuth.',
          'Trong khung chat, bật FTWorkspace ở nút công cụ rồi hỏi bình thường, ví dụ "Tôi là ai trên FTWorkspace?".',
        ],
        code: `${mcpUrl}?key=${key}`,
      };
    case 'claude-desktop':
      return {
        steps: [
          'Cài Node.js (bản 18 trở lên) trên máy.',
          'Mở Claude Desktop > Settings > Developer > Edit Config, dán đoạn dưới vào file claude_desktop_config.json.',
          'Lưu file, thoát hẳn Claude Desktop rồi mở lại.',
        ],
        code: JSON.stringify(
          {
            mcpServers: {
              ftworkspace: {
                command: 'npx',
                // Mã đặt trong URL: trên Windows npx tách tham số theo dấu cách nên "--header Authorization: Bearer ..." bị hỏng.
                args: ['-y', 'mcp-remote', `${mcpUrl}?key=${key}`],
              },
            },
          },
          null,
          2,
        ),
      };
    case 'claude-code':
      return {
        steps: ['Chạy lệnh dưới trong terminal, sau đó gõ /mcp trong Claude Code để kiểm tra.'],
        code: `claude mcp add --transport http ftworkspace ${mcpUrl} --header "Authorization: Bearer ${key}"`,
      };
    case 'cursor':
      return {
        steps: [
          'Mở Cursor > Settings > MCP > Add new MCP server (hoặc sửa file ~/.cursor/mcp.json).',
          'Dán đoạn dưới, lưu lại. Với VS Code dùng cùng nội dung trong .vscode/mcp.json, đổi "mcpServers" thành "servers".',
        ],
        code: JSON.stringify(
          {
            mcpServers: {
              ftworkspace: {
                url: mcpUrl,
                headers: { Authorization: `Bearer ${key}` },
              },
            },
          },
          null,
          2,
        ),
      };
    case 'chatgpt':
    default:
      return {
        steps: [
          'ChatGPT > Settings > Apps & Connectors > Advanced > bật Developer mode.',
          'Bấm Create, đặt tên "FTWorkspace", dán URL bên dưới, chọn Authentication: No authentication.',
          'Hoặc dùng Custom GPT Actions với URL OpenAPI ở khung phía trên.',
        ],
        code: `${mcpUrl}?key=${key}`,
      };
  }
}

const CLIENTS: { id: ClientId; label: string }[] = [
  { id: 'claude-web', label: 'Claude (web/app)' },
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor / VS Code' },
  { id: 'chatgpt', label: 'ChatGPT' },
];

export default function McpConnectGuide({ mcpUrl, apiKey }: { mcpUrl: string; apiKey: string | null }) {
  const [client, setClient] = useState<ClientId>('claude-web');
  const [copied, setCopied] = useState<string | null>(null);
  const key = apiKey || KEY_PLACEHOLDER;
  const { steps, code } = buildSnippet(client, mcpUrl, key);

  const copy = (text: string, id: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-5">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-violet-600 text-white shadow-sm shrink-0">
          <Plug className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-extrabold text-slate-900 text-base">Kết nối MCP với Claude, Cursor, ChatGPT</h3>
          <p className="mt-1 text-xs text-slate-600 leading-relaxed">
            Bước 1: tạo Mã kết nối AI ở khung trên. Bước 2: chọn ứng dụng bên dưới và làm theo hướng dẫn.
            AI chỉ làm được những việc tài khoản của bạn được phép.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <input readOnly value={mcpUrl} className="ft-input w-full min-w-0 bg-white font-mono text-xs text-slate-700" />
        <button
          type="button"
          onClick={() => copy(mcpUrl, 'url')}
          className="ft-primary inline-flex items-center gap-1.5 text-xs whitespace-nowrap shrink-0 py-2.5 px-4"
        >
          {copied === 'url' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied === 'url' ? 'Đã sao chép' : 'Sao chép URL MCP'}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5" role="tablist">
        {CLIENTS.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={client === item.id}
            onClick={() => setClient(item.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              client === item.id ? 'bg-violet-600 text-white' : 'bg-white text-slate-700 border border-slate-200 hover:bg-violet-50'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-slate-700">
        {steps.map(step => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <div className="mt-3 relative">
        <pre className="max-h-60 overflow-auto rounded-xl bg-slate-900 p-3 pr-24 text-[11px] leading-relaxed text-slate-100 whitespace-pre-wrap break-all">
          {code}
        </pre>
        <button
          type="button"
          onClick={() => copy(code, 'code')}
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] font-bold text-white hover:bg-white/20"
        >
          {copied === 'code' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied === 'code' ? 'Đã chép' : 'Chép'}
        </button>
      </div>

      {!apiKey && (
        <p className="mt-2 text-[11px] text-amber-700">
          Thay <span className="font-mono font-bold">{KEY_PLACEHOLDER}</span> bằng mã ft_ai_ bạn đã lưu. Mã vừa tạo sẽ tự điền vào đây.
        </p>
      )}
      <p className="mt-2 text-[11px] text-slate-500">
        Giữ kín mã kết nối. Nếu lộ, bấm "Thu hồi" ở khung trên và tạo mã mới.
      </p>
    </div>
  );
}
