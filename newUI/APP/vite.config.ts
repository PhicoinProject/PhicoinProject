import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    // SECURITY: Prevent HMR from accepting connections from arbitrary hosts
    // Disable HMR to prevent headless Chrome/MCP WebSocket connection hangs
    hmr: false,
    allowedHosts: false,
    // SECURITY: CORS enabled for dev server (only localhost access needed)
    cors: true,
    // SECURITY: Content Security Policy headers for development and preview
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      // Note: Full CSP should be enforced by the production web server.
      // Development server uses relaxed policy for HMR to function.
    },
    // Proxy RPC requests to phicoind with Basic Auth (dev only)
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:28966',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
        headers: {
          Authorization: `Basic ${Buffer.from('phi:phi').toString('base64')}`,
        },
      },
    },
  },
  preview: {
    // SECURITY: Production preview server headers
    headers: {
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://localhost:*; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    },
  },
  build: {
    outDir: 'dist',
    // SECURITY: Disable sourcemaps in production to prevent source code exposure
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@noble/')) return 'vendor-crypto';
          if (id.includes('@scure/')) return 'vendor-hd';
          if (id.includes('/qrcode/')) return 'vendor-qrcode';
          if (id.includes('/react/') || id.includes('/react-dom/')) return 'vendor-react';
          if (id.includes('/@tanstack/react-query/')) return 'vendor-query';
        },
      },
    },
  },
  // SECURITY: Content Security Policy headers for production
  // These should be enforced by the web server. Recommended server headers:
  //   Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
  //   Strict-Transport-Security: max-age=31536000; includeSubDomains
  //   X-Frame-Options: DENY
  //   X-Content-Type-Options: nosniff
  //   Referrer-Policy: strict-origin-when-cross-origin
  //   Permissions-Policy: camera=(), microphone=(), geolocation=()
});
