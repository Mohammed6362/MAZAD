/**
 * إعداد خادم تطوير React والبناء؛ يثبت المنفذ ويمرر API والصور للخلفية ويكشف هوية خدمة التطوير.
 * راجع docs/code-guide.md لخريطة الملفات ومسارات العمل.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'mazad-dev-status',
      configureServer(server) {
        server.middlewares.use('/__mazad_dev', (_req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ service: 'mazad-libya-frontend' }));
        });
      },
    },
  ],
  server: {
    fs: {
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        fileURLToPath(new URL('../shared', import.meta.url)),
      ],
    },
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/uploads': 'http://127.0.0.1:3000',
    },
  },
});
