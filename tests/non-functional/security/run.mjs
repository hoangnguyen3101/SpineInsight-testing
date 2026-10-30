// Mục đích: Kiểm thử bảo mật bằng OWASP ZAP (bản portable trong .tools, chạy headless bằng Java, cờ -silent nên ZAP
// không tự gọi ra Internet) trên backend SUT thật (harness, cổng riêng) và Vite dev server của frontend, rồi chạy các
// kiểm tra tái hiện (checks.test.mjs). Mọi lưu lượng ở 127.0.0.1.
// Ba lượt quét theo Automation Framework: API không xác thực (OpenAPI + active scan), API có xác thực (thêm header
// Authorization bằng replacer), baseline frontend (spider + passive scan). SECURITY_SKIP_ZAP=1 để chỉ chạy kiểm tra tái hiện.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCOUNTS } from '../support/fixtures.mjs'
import { startFrontend } from '../support/frontendServer.mjs'
import { REPO_DIR, login, startHarness } from '../support/harness.mjs'
import { ensureZap, TOOLS_DIR } from '../support/tools.mjs'
import { TRIAGE } from './triage.mjs'

const SEC_DIR = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(REPO_DIR, 'reports', 'security')
const PLAN_DIR = path.join(OUT_DIR, 'plans')
const PORTS = { backend: 3102, supabase: 54411, ai: 54412 }
const FRONTEND_PORT = 5181
const posix = (p) => p.split(path.sep).join('/')

function apiPlan({ name, backendUrl, token }) {
  const replacer = token
    ? `
  - type: replacer
    parameters:
      deleteAllRules: true
    rules:
      - description: "Authorization admin"
        url: ""
        matchType: req_header
        matchString: Authorization
        matchRegex: false
        replacementString: "Bearer ${token}"
        tokenProcessing: false`
    : ''
  return `env:
  contexts:
    - name: backend
      urls:
        - "${backendUrl}"
      includePaths:
        - '${backendUrl.replace(/\./g, '\\.')}.*'
  parameters:
    failOnError: true
    failOnWarning: false
    progressToStdout: true
jobs:${replacer}
  - type: openapi
    parameters:
      apiFile: "${posix(path.join(SEC_DIR, 'openapi.yaml'))}"
      targetUrl: "${backendUrl}"
      context: backend
  - type: passiveScan-wait
    parameters:
      maxDuration: 5
  - type: activeScan
    parameters:
      context: backend
      maxRuleDurationInMins: 2
      maxScanDurationInMins: 20
  - type: passiveScan-wait
    parameters:
      maxDuration: 5
  - type: report
    parameters:
      template: traditional-html
      reportDir: "${posix(OUT_DIR)}"
      reportFile: "zap-${name}"
      reportTitle: "ZAP ${name} - SpineInsight AI backend"
  - type: report
    parameters:
      template: traditional-json
      reportDir: "${posix(OUT_DIR)}"
      reportFile: "zap-${name}"
`
}

function frontendPlan({ frontendUrl }) {
  return `env:
  contexts:
    - name: frontend
      urls:
        - "${frontendUrl}"
      includePaths:
        - '${frontendUrl.replace(/\./g, '\\.')}.*'
  parameters:
    failOnError: true
    failOnWarning: false
    progressToStdout: true
jobs:
  - type: spider
    parameters:
      context: frontend
      url: "${frontendUrl}/"
      maxDuration: 2
  - type: passiveScan-wait
    parameters:
      maxDuration: 5
  - type: report
    parameters:
      template: traditional-html
      reportDir: "${posix(OUT_DIR)}"
      reportFile: "zap-frontend-baseline"
      reportTitle: "ZAP baseline - SpineInsight AI frontend (Vite dev server)"
  - type: report
    parameters:
      template: traditional-json
      reportDir: "${posix(OUT_DIR)}"
      reportFile: "zap-frontend-baseline"
`
}

function runZap(zapDir, planFile, logFile) {
  return new Promise((resolve, reject) => {
    const home = path.join(TOOLS_DIR, 'zap-home')
    mkdirSync(home, { recursive: true })
    const child = spawn('java', ['-Xmx2g', '-jar', path.join(zapDir, 'zap-2.17.0.jar'), '-cmd', '-silent', '-dir', home, '-autorun', planFile], {
      cwd: zapDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const chunks = []
    child.stdout.on('data', (d) => { chunks.push(d); process.stdout.write(d) })
    child.stderr.on('data', (d) => chunks.push(d))
    child.on('error', reject)
    child.on('exit', (code) => {
      writeFileSync(logFile, Buffer.concat(chunks))
      resolve(code ?? 1)
    })
  })
}

function runChecks() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=spec', path.join(SEC_DIR, 'checks.test.mjs')], { cwd: REPO_DIR, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

const RISK = { 3: 'High', 2: 'Medium', 1: 'Low', 0: 'Informational' }

function summarize(names) {
  const rows = []
  for (const name of names) {
    const file = path.join(OUT_DIR, `zap-${name}.json`)
    if (!existsSync(file)) continue
    const report = JSON.parse(readFileSync(file, 'utf8'))
    for (const site of report.site || []) {
      for (const alert of site.alerts || []) {
        const base = TRIAGE[alert.pluginid] || { verdict: 'Chưa phân loại', owasp: '-', bug: '-', note: '' }
        const { byScan, ...triage } = { ...base, ...(base.byScan?.[name] || {}) }
        rows.push({
          scan: name,
          pluginId: alert.pluginid,
          alert: alert.name || alert.alert,
          risk: RISK[alert.riskcode] || alert.riskcode,
          confidence: alert.confidence,
          count: Number(alert.count || alert.instances?.length || 0),
          example: alert.instances?.[0] ? `${alert.instances[0].method} ${alert.instances[0].uri}` : '',
          cwe: alert.cweid,
          ...triage,
        })
      }
    }
  }
  return rows
}

async function main() {
  mkdirSync(PLAN_DIR, { recursive: true })
  const zapCodes = {}
  if ((process.env.SECURITY_SKIP_ZAP || '').trim() !== '1') {
    const zapDir = await ensureZap()
    const harness = await startHarness({ ports: PORTS, logFile: path.join(OUT_DIR, 'backend.log') })
    let frontend
    try {
      const token = await login(harness.backendUrl, ACCOUNTS.admin.email, ACCOUNTS.admin.password)
      frontend = await startFrontend({ port: FRONTEND_PORT, backendUrl: harness.backendUrl, supabaseUrl: harness.supabaseUrl, aiUrl: harness.aiUrl })
      const plans = {
        'api-unauth': apiPlan({ name: 'api-unauth', backendUrl: harness.backendUrl }),
        'api-auth': apiPlan({ name: 'api-auth', backendUrl: harness.backendUrl, token }),
        'frontend-baseline': frontendPlan({ frontendUrl: frontend.url }),
      }
      for (const [name, plan] of Object.entries(plans)) {
        // Kế hoạch có xác thực chứa token giả của máy chủ giả, không phải bí mật thật.
        const planFile = path.join(PLAN_DIR, `${name}.yaml`)
        writeFileSync(planFile, plan)
        console.log(`[security] ZAP: ${name}`)
        zapCodes[name] = await runZap(zapDir, planFile, path.join(OUT_DIR, `zap-${name}.log`))
      }
    } finally {
      await frontend?.close()
      await harness.stop()
    }
  }

  const rows = summarize(['api-unauth', 'api-auth', 'frontend-baseline'])
  console.log('[security] Kiểm tra tái hiện (checks.test.mjs)')
  const checksCode = await runChecks()

  const byRisk = rows.reduce((acc, r) => ({ ...acc, [r.risk]: (acc[r.risk] || 0) + 1 }), {})
  writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify({ generatedAt: new Date().toISOString(), zapExitCodes: zapCodes, alertsByRisk: byRisk, alerts: rows, checksExitCode: checksCode }, null, 2))
  const lines = ['# Kết quả kiểm thử bảo mật (OWASP ZAP 2.17.0)', '', `Mã thoát ZAP: ${JSON.stringify(zapCodes)}; kiểm tra tái hiện: ${checksCode === 0 ? 'đạt' : 'lỗi'}`, '', '| Lượt quét | Plugin | Cảnh báo | Mức | Số chỗ | Phân loại | OWASP 2021 | Lỗi | Ví dụ |', '|---|---|---|---|---|---|---|---|---|']
  for (const r of rows) lines.push(`| ${r.scan} | ${r.pluginId} | ${r.alert} | ${r.risk} | ${r.count} | ${r.verdict} | ${r.owasp} | ${r.bug} | ${r.example} |`)
  lines.push('', '## Ghi chú phân loại', '')
  for (const [id, t] of Object.entries(TRIAGE)) if (rows.some((r) => String(r.pluginId) === id)) lines.push(`- ${id} (${t.verdict}): ${t.note}`)
  writeFileSync(path.join(OUT_DIR, 'summary.md'), lines.join('\n'))
  console.log(lines.join('\n'))
  if (checksCode !== 0 || Object.values(zapCodes).some((c) => c !== 0 && c !== 2)) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
