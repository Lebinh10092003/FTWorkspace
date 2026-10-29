import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: '/', // Hỗ trợ đường dẫn tương đối khi deploy lên GitHub Pages
    plugins: [react(), tailwindcss()],
    build: {
      // Keep hashed assets until the post-health-check retention step has
      // safely retained the latest frontend releases.
      emptyOutDir: false,
      manifest: true,
      rollupOptions: {
        output: {
          // React hiếm khi đổi giữa các lần deploy: tách riêng để trình duyệt giữ cache.
          // Không gom react-dom/server (chỉ trình soạn email dùng) để nó vẫn tải khi cần.
          manualChunks(id) {
            const file = id.split('\\').join('/');
            if (file.includes('/node_modules/react-dom/') && /server|static/.test(file.split('/node_modules/react-dom/')[1])) return undefined;
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(file)) return 'vendor-react';
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      strictPort: true,
      proxy: {
        '/api': {
          target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000',
          changeOrigin: true,
          secure: false,
        },
        // URL MCP ngắn /mcp (giống /api/mcp), khớp cấu hình nginx production.
        '^/mcp/?$': {
          target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000',
          changeOrigin: true,
          secure: false,
        },
        // Metadata OAuth cho MCP (nginx production cũng chuyển vào Django).
        '^/\\.well-known/(oauth-|openid-configuration)': {
          target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000',
          changeOrigin: true,
          secure: false,
        },
        '/uploads': {
          target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000',
          changeOrigin: true,
          secure: false,
        }
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // Khi chạy ở local, bỏ qua toàn bộ dữ liệu runtime của backend để tránh
      // reload liên tục khi SQLite, upload hoặc file tạm thay đổi.
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: ['**/backend/**', '**/.tmp/**'],
      },
    },
  };
});
