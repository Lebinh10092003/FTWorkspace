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
