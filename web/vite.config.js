import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiUrl = env.VITE_API_URL || 'http://localhost:20128'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': apiUrl,
        '/v1': apiUrl,
        '/skills': apiUrl,
      },
    },
  }
})
