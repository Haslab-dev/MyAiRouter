import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiUrl = env.VITE_API_URL || 'http://localhost:20128'

  return {
    plugins: [react()],
    build: {
      target: 'esnext',
      cssMinify: true,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
                return 'vendor-react'
              }
              if (id.includes('zustand')) {
                return 'vendor-state'
              }
            }
          },
        },
      },
    },
    server: {
      proxy: {
        '/api': apiUrl,
        '/v1': apiUrl,
        '/skills': apiUrl,
      },
    },
  }
})
