import { defineConfig }   from 'vite'
import react              from '@vitejs/plugin-react'
import wasm               from 'vite-plugin-wasm'
import topLevelAwait      from 'vite-plugin-top-level-await'

const devPort = Number(process.env.AVI_DEV_PORT || 3000)

export default defineConfig({
  plugins: [
    react(),
    wasm(),           // enables .wasm imports (wasm-pack --target web output)
    topLevelAwait(),  // required: wasm init uses top-level await
  ],
  server: {
    host: '127.0.0.1',
    port: Number.isFinite(devPort) ? devPort : 3000,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
