import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// CỐ TÌNH không cấu hình manualChunks — để WPSA gợi ý code-splitting
export default defineConfig({
  plugins: [react()],
});
