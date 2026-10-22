// Mục đích: Chạy bộ E2E Selenium: mở Vite dev server của frontend SUT (vị trí lấy từ sut.config.cjs)
// với biến môi trường giả trỏ tới máy chủ giả, chạy các kịch bản bằng node:test rồi dừng dev server.
// Tuỳ chọn: E2E_HEADED=1 để hiện trình duyệt khi chạy.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const E2E_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_DIR = path.resolve(E2E_DIR, '..', '..')
const { frontendDir } = createRequire(import.meta.url)('../../sut.config.cjs')
const VITE_BIN = path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js')

const HOST = '127.0.0.1'
const APP_PORT = 5180
const MOCK_PORT = 54399
const APP_URL = `http://${HOST}:${APP_PORT}`
const MOCK_URL = `http://${HOST}:${MOCK_PORT}`

// Mọi biến VITE_* mà mã nguồn SUT đọc đều bị ghi đè (biến môi trường của tiến trình được Vite ưu tiên
// hơn tệp .env), nên trình duyệt không nhận khoá thật và không gọi ra Supabase hay máy chủ AI thật.
const viteEnv = {
  ...process.env,
  VITE_SUPABASE_URL: MOCK_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: 'e2e-publishable-key',
  VITE_API_URL: MOCK_URL,
  VITE_AI_API_URL: MOCK_URL,
  VITE_AI_API_KEY: '',
  VITE_AI_SKIP_NGROK_WARNING: 'false',
  VITE_ENABLE_CLIENT_LOGS: 'false',
  VITE_P2VG_API_URL: MOCK_URL,
  VITE_IMPRESSION_API_URL: MOCK_URL,
  VITE_IMPRESSION_API_PATH: '/impression',
  VITE_IMPRESSION_API_KEY: '',
  VITE_IMPRESSION_SKIP_NGROK_WARNING: 'false',
  VITE_SPINE_API_URL: MOCK_URL,
  VITE_SPINE_API_KEY: '',
  VITE_GEMINI_API_KEY_1: '',
  VITE_GEMINI_API_KEY_2: '',
  VITE_GEMINI_API_KEY_3: '',
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // dev server chưa sẵn sàng
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`Hết thời gian chờ ${url}`)
}

function runTests() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--test', '--test-concurrency=1', '--test-reporter=spec', 'tests/e2e/specs/*.e2e.mjs'],
      {
        cwd: REPO_DIR,
        env: { ...process.env, E2E_BASE_URL: APP_URL, E2E_MOCK_PORT: String(MOCK_PORT) },
        stdio: 'inherit',
      },
    )
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

async function main() {
  if (!existsSync(VITE_BIN)) {
    throw new Error(`Không thấy Vite của SUT tại ${VITE_BIN}. Hãy chạy npm install trong ${frontendDir}.`)
  }

  const devServer = spawn(
    process.execPath,
    [VITE_BIN, '--host', HOST, '--port', String(APP_PORT), '--strictPort'],
    { cwd: frontendDir, env: viteEnv, stdio: ['ignore', 'ignore', 'inherit'] },
  )
  try {
    await waitForHttp(`${APP_URL}/login`, 60000)
    console.log(`[e2e] SUT: ${frontendDir}`)
    console.log(`[e2e] Ứng dụng: ${APP_URL}, máy chủ giả: ${MOCK_URL}`)
    return await runTests()
  } finally {
    devServer.kill()
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err)
    process.exit(1)
  },
)
