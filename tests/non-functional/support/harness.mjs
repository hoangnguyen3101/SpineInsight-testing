// Mục đích: Dựng môi trường chạy thật backend SUT cho kiểm thử hiệu năng và bảo mật:
// máy chủ giả Supabase + máy chủ AI giả (cùng tiến trình này) và backend SUT (tiến trình con, cwd = backend SUT).
// Backend được nạp trước noDotenv.cjs nên không đọc .env thật; mọi biến môi trường được đặt rõ ràng, chỉ trỏ tới localhost.
// Chạy tay: node tests/non-functional/support/harness.mjs  (Ctrl+C để dừng)
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMockAi } from './mockAi.mjs'
import { createMockSupabase } from './mockSupabase.mjs'

const SUPPORT_DIR = path.dirname(fileURLToPath(import.meta.url))
export const REPO_DIR = path.resolve(SUPPORT_DIR, '..', '..', '..')
const { backendDir, frontendDir } = createRequire(import.meta.url)('../../../sut.config.cjs')
export { backendDir, frontendDir }

export const PORTS = { backend: 3101, supabase: 54401, ai: 54402, frontend: 5181 }
export const HOST = '127.0.0.1'

export async function waitForHttp(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.status < 500) return
    } catch {
      // chưa sẵn sàng
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Hết thời gian chờ ${url}`)
}

/** Biến môi trường cho backend SUT: chỉ giữ biến hệ thống cần để chạy node, ghi đè mọi biến cấu hình bằng giá trị giả. */
function backendEnv({ ports, nodeEnv, allowedOrigins, memoryLog }) {
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC', 'WINDIR']
  const env = Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]))
  return {
    ...env,
    PORT: String(ports.backend),
    NODE_ENV: nodeEnv,
    SUPABASE_URL: `http://${HOST}:${ports.supabase}`,
    SUPABASE_KEY: 'nf-fake-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'nf-fake-service-role-key',
    SPINE_API_URL: `http://${HOST}:${ports.ai}`,
    SPINE_API_KEY: 'nf-fake-spine-key',
    P2VG_API_URL: `http://${HOST}:${ports.ai}`,
    P2VG_API_KEY: 'nf-fake-p2vg-key',
    ALLOWED_ORIGINS: allowedOrigins,
    DICOM_STORAGE_PATH: path.join(REPO_DIR, 'reports', 'nf-dicom-storage'),
    ...(memoryLog ? { HARNESS_MEMORY_LOG: memoryLog } : {}),
  }
}

export async function startHarness({
  ports = PORTS,
  aiLatencyMs = 0,
  nodeEnv = 'production',
  allowedOrigins = '',
  memoryLog,
  logFile,
} = {}) {
  const supabase = createMockSupabase()
  const ai = createMockAi({ latencyMs: aiLatencyMs })
  await supabase.listen(ports.supabase, HOST)
  await ai.listen(ports.ai, HOST)

  const preload = path.join(SUPPORT_DIR, 'noDotenv.cjs')
  const backend = spawn(process.execPath, ['--max-old-space-size=4096', '-r', preload, 'src/server.js'], {
    cwd: backendDir,
    env: backendEnv({ ports, nodeEnv, allowedOrigins, memoryLog }),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  if (logFile) {
    mkdirSync(path.dirname(logFile), { recursive: true })
    const log = createWriteStream(logFile)
    backend.stdout.pipe(log)
    backend.stderr.pipe(log)
  } else {
    backend.stdout.resume()
    backend.stderr.resume()
  }

  const backendUrl = `http://${HOST}:${ports.backend}`
  let exited = false
  backend.on('exit', () => { exited = true })

  async function stop() {
    if (!exited) {
      backend.kill()
      await new Promise((resolve) => (exited ? resolve() : backend.once('exit', resolve)))
    }
    await Promise.all([supabase.close(), ai.close()])
  }

  try {
    await waitForHttp(`${backendUrl}/health`, 30000)
  } catch (err) {
    await stop()
    throw err
  }
  return { backendUrl, supabaseUrl: `http://${HOST}:${ports.supabase}`, aiUrl: `http://${HOST}:${ports.ai}`, backendPid: backend.pid, ai, supabase, stop }
}

/** Biến VITE_* cho dev server frontend: mọi dịch vụ trỏ về máy chủ giả, không khoá thật nào. */
export function viteEnv(mockUrl) {
  return {
    ...process.env,
    VITE_SUPABASE_URL: mockUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: 'nf-publishable-key',
    VITE_API_URL: mockUrl,
    VITE_AI_API_URL: mockUrl,
    VITE_AI_API_KEY: '',
    VITE_AI_SKIP_NGROK_WARNING: 'false',
    VITE_ENABLE_CLIENT_LOGS: 'false',
    VITE_P2VG_API_URL: mockUrl,
    VITE_IMPRESSION_API_URL: mockUrl,
    VITE_IMPRESSION_API_PATH: '/impression',
    VITE_IMPRESSION_API_KEY: '',
    VITE_IMPRESSION_SKIP_NGROK_WARNING: 'false',
    VITE_SPINE_API_URL: mockUrl,
    VITE_SPINE_API_KEY: '',
    VITE_GEMINI_API_KEY_1: '',
    VITE_GEMINI_API_KEY_2: '',
    VITE_GEMINI_API_KEY_3: '',
  }
}

/** Đăng nhập qua backend để lấy access token (dùng cho lượt quét có xác thực và kịch bản k6). */
export async function login(backendUrl, email, password) {
  const response = await fetch(`${backendUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) throw new Error(`Đăng nhập ${email} thất bại: ${response.status}`)
  return (await response.json()).data.accessToken
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const harness = await startHarness({ logFile: path.join(REPO_DIR, 'reports', 'nf-harness-backend.log') })
  console.log(`[harness] backend ${harness.backendUrl} (pid ${harness.backendPid}), supabase giả ${harness.supabaseUrl}, AI giả ${harness.aiUrl}`)
  console.log('[harness] Ctrl+C để dừng')
  const shutdown = async () => {
    await harness.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
