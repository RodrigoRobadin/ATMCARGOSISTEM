// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,           // permite acceder desde la red local si hace falta
    cors: true,
    // port: 5173,        // descomentá si querés fijar el puerto
    // strictPort: true,  // descomentá si NO querés que Vite cambie de puerto
    proxy: {
      // --- API backend ---
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
        ws: true,
        timeout: 30000,
        proxyTimeout: 30000,
        // Si tu backend NO tiene el prefijo /api y expone directamente /deals, podés usar:
        // rewrite: (path) => path.replace(/^\/api/, ''),
      },

      // --- Archivos subidos (previews en el front) ---
      // Ej.: /uploads/xxx.pdf -> http://localhost:4000/uploads/xxx.pdf
      '/uploads': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
        timeout: 30000,
        proxyTimeout: 30000,
      },
    },
  },
});
