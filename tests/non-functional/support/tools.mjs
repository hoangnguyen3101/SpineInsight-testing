// Mục đích: Tải và giải nén k6 và OWASP ZAP vào .tools/ của repo (không cần quyền admin, không cài vào máy).
// Đặt K6_BIN hoặc ZAP_DIR để dùng bản đã có sẵn. Chạy tay: node tests/non-functional/support/tools.mjs [k6|zap|all]
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const TOOLS_DIR = path.join(REPO_DIR, '.tools')

const K6_VERSION = 'v2.3.0'
const ZAP_VERSION = '2.17.0'
const K6_URL = `https://github.com/grafana/k6/releases/download/${K6_VERSION}/k6-${K6_VERSION}-windows-amd64.zip`
const ZAP_URL = `https://github.com/zaproxy/zaproxy/releases/download/v${ZAP_VERSION}/ZAP_${ZAP_VERSION}_Crossplatform.zip`

// tar.exe của Windows (bsdtar) giải nén được zip; tar của Git Bash thì không.
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'

async function download(url, file) {
  console.log(`[tools] Tải ${url}`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Tải thất bại ${response.status}: ${url}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file))
}

async function fetchAndExtract(url, targetDir) {
  mkdirSync(TOOLS_DIR, { recursive: true })
  const archive = path.join(TOOLS_DIR, path.basename(url))
  if (!existsSync(archive)) await download(url, archive)
  mkdirSync(targetDir, { recursive: true })
  execFileSync(TAR, ['-xf', archive, '-C', targetDir], { stdio: 'inherit' })
  rmSync(archive)
}

export async function ensureK6() {
  if (process.env.K6_BIN) return process.env.K6_BIN
  const dir = path.join(TOOLS_DIR, 'k6')
  const bin = path.join(dir, `k6-${K6_VERSION}-windows-amd64`, 'k6.exe')
  if (!existsSync(bin)) await fetchAndExtract(K6_URL, dir)
  return bin
}

export async function ensureZap() {
  if (process.env.ZAP_DIR) return process.env.ZAP_DIR
  const dir = path.join(TOOLS_DIR, 'zap')
  const home = path.join(dir, `ZAP_${ZAP_VERSION}`)
  if (!existsSync(path.join(home, 'zap.bat'))) await fetchAndExtract(ZAP_URL, dir)
  return home
}

export { REPO_DIR, TOOLS_DIR }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const which = process.argv[2] || 'all'
  if (which === 'k6' || which === 'all') console.log('[tools] k6:', await ensureK6())
  if (which === 'zap' || which === 'all') console.log('[tools] ZAP:', await ensureZap())
  console.log('[tools] .tools:', readdirSync(TOOLS_DIR).join(', '))
}
