import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Phosphor ships every weight of each icon; keep the icon set in its own
        // long-cached chunk instead of the main bundle
        manualChunks(id) {
          if (id.includes('node_modules/@phosphor-icons/')) return 'icons';
        },
      },
    },
  },
})
