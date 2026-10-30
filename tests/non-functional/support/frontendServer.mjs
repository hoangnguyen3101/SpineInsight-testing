// Mục đích: Chạy Vite dev server của frontend SUT bằng JS API của chính Vite trong SUT, với:
// - envDir trỏ tới một thư mục rỗng nên KHÔNG đọc bất kỳ tệp .env nào của SUT (biến VITE_* chỉ lấy từ giá trị giả);
// - proxy /api trỏ về backend của harness thay vì localhost:3000 trong vite.config.ts.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { HOST, REPO_DIR, frontendDir, viteEnv } from './harness.mjs'

export async function startFrontend({ port, backendUrl, supabaseUrl, aiUrl }) {
  const emptyEnvDir = path.join(REPO_DIR, 'reports', 'nf-empty-envdir')
  mkdirSync(emptyEnvDir, { recursive: true })
  const fake = viteEnv(supabaseUrl)
  for (const [key, value] of Object.entries(fake)) {
    if (key.startsWith('VITE_')) process.env[key] = value
  }
  process.env.VITE_API_URL = backendUrl
  process.env.VITE_AI_API_URL = aiUrl
  process.env.VITE_SPINE_API_URL = aiUrl
  process.env.VITE_P2VG_API_URL = aiUrl
  process.env.VITE_IMPRESSION_API_URL = aiUrl

  const vite = await import(pathToFileURL(path.join(frontendDir, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href)
  const server = await vite.createServer({
    root: frontendDir,
    configFile: path.join(frontendDir, 'vite.config.ts'),
    envDir: emptyEnvDir,
    logLevel: 'warn',
    clearScreen: false,
    server: {
      host: HOST,
      port,
      strictPort: true,
      proxy: { '/api': { target: backendUrl, changeOrigin: true } },
    },
  })
  await server.listen()
  return { url: `http://${HOST}:${port}`, close: () => server.close() }
}
