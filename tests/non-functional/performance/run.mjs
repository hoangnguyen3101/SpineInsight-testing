// Mục đích: Chạy kiểm thử hiệu năng bằng k6 trên backend SUT thật (Supabase và AI là máy chủ giả trên localhost).
// Các pha: api-load (smoke, load, stress) rồi các pha tải ảnh; đo bộ nhớ tiến trình backend (RSS) trong từng pha.
// Kết quả: reports/performance/summary.md, summary.json, k6-*.json, backend-memory.csv, backend.log.
// Dữ liệu ảnh thật chỉ lấy từ DICOM_TEST_DIR (bản đã ẩn danh); thiếu thì bỏ qua các pha dùng ảnh thật.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCOUNTS } from '../support/fixtures.mjs'
import { REPO_DIR, startHarness } from '../support/harness.mjs'
import { ensureK6 } from '../support/tools.mjs'

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(REPO_DIR, 'reports', 'performance')
const MEMORY_LOG = path.join(OUT_DIR, 'backend-memory.csv')
const dicomDir = process.env.DICOM_TEST_DIR

function listSeries(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

function filesOf(dir, seriesNames) {
  return seriesNames.flatMap((series) =>
    readdirSync(path.join(dir, series))
      .filter((f) => f.toLowerCase().endsWith('.dcm'))
      .sort()
      .map((f) => ({ path: path.join(dir, series, f).split(path.sep).join('/'), name: `CASE01/${series}/${f}` })),
  )
}

function runK6(k6, script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(k6, ['run', '--quiet', '--no-color', path.join(PERF_DIR, 'k6', script)], {
      cwd: PERF_DIR,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function readMemory() {
  return readFileSync(MEMORY_LOG, 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const [t, rss, heapUsed, external, arrayBuffers] = line.split(',').map(Number)
      return { t, rss, heapUsed, external, arrayBuffers }
    })
}

const MB = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10

function memoryWindow(samples, start, end) {
  const before = samples.filter((s) => s.t < start).slice(-10)
  const inside = samples.filter((s) => s.t >= start && s.t <= end)
  const startRss = before.length ? before[before.length - 1].rss : inside[0]?.rss
  const peak = inside.reduce((max, s) => (s.rss > max.rss ? s : max), inside[0] || { rss: 0, external: 0, arrayBuffers: 0 })
  return { startRssMb: MB(startRss), peakRssMb: MB(peak.rss), deltaMb: MB(peak.rss - startRss), peakArrayBuffersMb: MB(peak.arrayBuffers) }
}

function metric(summary, name) {
  return summary.metrics[name]?.values
}

function apiRows(summary) {
  const rows = []
  for (const scenario of ['smoke', 'load', 'stress']) {
    for (const endpoint of ['health', 'login', 'me', 'hospitals', 'studies']) {
      const tag = `{scenario:${scenario},endpoint:${endpoint}}`
      const duration = metric(summary, `http_req_duration${tag}`)
      const reqs = metric(summary, `http_reqs${tag}`)
      const failed = metric(summary, `http_req_failed${tag}`)
      const thresholds = Object.entries(summary.metrics)
        .filter(([name]) => name.endsWith(tag) && !name.startsWith('http_reqs'))
        .flatMap(([, m]) => Object.values(m.thresholds || {}))
      rows.push({
        scenario,
        endpoint,
        requests: reqs?.count ?? 0,
        rps: reqs ? Math.round(reqs.rate * 10) / 10 : 0,
        p50: duration?.med,
        p95: duration?.['p(95)'],
        p99: duration?.['p(99)'],
        max: duration?.max,
        errorPct: failed ? Math.round(failed.rate * 10000) / 100 : 0,
        thresholdsOk: thresholds.every((t) => t.ok),
      })
    }
  }
  return rows
}

const fmt = (n) => (n === undefined || n === null ? '-' : Math.round(n * 10) / 10)

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const k6 = await ensureK6()
  const harness = await startHarness({ memoryLog: MEMORY_LOG, logFile: path.join(OUT_DIR, 'backend.log') })
  const baseEnv = {
    BASE_URL: harness.backendUrl,
    ADMIN_EMAIL: ACCOUNTS.admin.email,
    ADMIN_PASSWORD: ACCOUNTS.admin.password,
    DOCTOR_EMAIL: ACCOUNTS.doctor.email,
    DOCTOR_PASSWORD: ACCOUNTS.doctor.password,
  }
  const phases = []
  async function phase(name, script, env, meta = {}) {
    const summaryPath = path.join(OUT_DIR, `k6-${name}.json`)
    const aiBefore = { ...harness.ai.stats }
    await sleep(3000)
    const start = Date.now()
    console.log(`[perf] Pha ${name}...`)
    const code = await runK6(k6, script, { ...baseEnv, ...env, SUMMARY_PATH: summaryPath })
    const end = Date.now()
    await sleep(1500)
    phases.push({
      name,
      script,
      start,
      end,
      exitCode: code,
      summaryPath,
      aiUploads: harness.ai.stats.uploads - aiBefore.uploads,
      aiBytes: harness.ai.stats.uploadBytes - aiBefore.uploadBytes,
      ...meta,
    })
  }

  try {
    console.log(`[perf] backend ${harness.backendUrl} (pid ${harness.backendPid}); DB và AI là máy chủ giả`)
    await phase('api-load', 'api-load.js', {})
    if (dicomDir && existsSync(dicomDir)) {
      const series = listSeries(dicomDir)
      const oneSeries = filesOf(dicomDir, [series.find((s) => s.includes('Sag_T1')) || series[0]])
      const wholeCase = filesOf(dicomDir, series)
      await phase('upload-series', 'upload.js', { UPLOAD_MODE: 'files', FILE_LIST: JSON.stringify(oneSeries), VUS: '1', ITERATIONS: '10', P95_MS: '5000' }, { files: oneSeries.length, vus: 1, iterationsPerVu: 10 })
      await phase('upload-case', 'upload.js', { UPLOAD_MODE: 'files', FILE_LIST: JSON.stringify(wholeCase), VUS: '1', ITERATIONS: '3', P95_MS: '15000' }, { files: wholeCase.length, vus: 1, iterationsPerVu: 3 })
      await phase('upload-case-x3', 'upload.js', { UPLOAD_MODE: 'files', FILE_LIST: JSON.stringify(wholeCase), VUS: '3', ITERATIONS: '2', P95_MS: '30000' }, { files: wholeCase.length, vus: 3, iterationsPerVu: 2 })
    } else {
      console.log('[perf] Không có DICOM_TEST_DIR: bỏ qua các pha tải ảnh thật')
    }
    await phase('upload-2000', 'upload.js', { UPLOAD_MODE: 'synthetic', SYNTH_COUNT: '2000', VUS: '1', ITERATIONS: '5', P95_MS: '5000' }, { files: 2000, vus: 1, iterationsPerVu: 5 })
    // 2001 tệp vượt giới hạn Multer: đặc tả mong đợi lỗi phía người dùng (4xx); SUT trả 500 (BUG-05) nên pha này ghi nhận mã thực tế.
    await phase('upload-2001', 'upload.js', { UPLOAD_MODE: 'synthetic', SYNTH_COUNT: '2001', VUS: '1', ITERATIONS: '1', EXPECT_STATUS: '500', P95_MS: '5000' }, { files: 2001, vus: 1, iterationsPerVu: 1, knownBug: 'BUG-05' })
  } finally {
    await harness.stop()
  }

  const samples = readMemory()
  const idle = samples.filter((s) => s.t < phases[0].start)
  const result = { generatedAt: new Date().toISOString(), note: 'Supabase và máy chủ AI là máy chủ giả trên cùng máy; số liệu phản ánh lớp Express/Multer của backend SUT.', idleRssMb: MB(idle.length ? idle[idle.length - 1].rss : samples[0].rss), phases: [] }
  for (const p of phases) {
    const summary = JSON.parse(readFileSync(p.summaryPath, 'utf8'))
    const entry = { name: p.name, exitCode: p.exitCode, durationS: Math.round((p.end - p.start) / 100) / 10, memory: memoryWindow(samples, p.start, p.end), aiUploads: p.aiUploads, aiForwardedMb: MB(p.aiBytes) }
    if (p.script === 'api-load.js') {
      entry.rows = apiRows(summary)
      entry.checksPassRate = metric(summary, 'checks')?.rate
    } else {
      const d = metric(summary, 'http_req_duration{endpoint:spine_analyze}')
      const r = metric(summary, 'http_reqs{endpoint:spine_analyze}')
      const f = metric(summary, 'http_req_failed{endpoint:spine_analyze}')
      const thresholds = Object.values(summary.metrics).flatMap((m) => Object.values(m.thresholds || {}))
      entry.upload = {
        files: p.files,
        vus: p.vus,
        requests: r?.count,
        payloadMb: MB(summary.payload.bytes),
        expectStatus: summary.payload.expectStatus,
        p50: d?.med,
        p95: d?.['p(95)'],
        p99: d?.['p(99)'],
        max: d?.max,
        errorPct: f ? Math.round(f.rate * 10000) / 100 : 0,
        thresholdsOk: thresholds.every((t) => t.ok),
        knownBug: p.knownBug,
      }
      entry.rssPerRequestPayload = entry.upload.payloadMb ? Math.round((entry.memory.deltaMb / (entry.upload.payloadMb * p.vus)) * 100) / 100 : null
    }
    result.phases.push(entry)
  }
  writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(result, null, 2))

  const lines = ['# Kết quả kiểm thử hiệu năng (k6)', '', `Thời điểm: ${result.generatedAt}`, '', result.note, '', `RSS backend lúc rảnh: ${result.idleRssMb} MB`, '']
  for (const p of result.phases) {
    lines.push(`## Pha ${p.name} (${p.durationS} s, k6 exit ${p.exitCode})`, '')
    if (p.rows) {
      lines.push('| Kịch bản | Endpoint | Request | RPS | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) | Lỗi % | Ngưỡng |', '|---|---|---|---|---|---|---|---|---|---|')
      for (const r of p.rows) lines.push(`| ${r.scenario} | ${r.endpoint} | ${r.requests} | ${r.rps} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.p99)} | ${fmt(r.max)} | ${r.errorPct} | ${r.thresholdsOk ? 'Đạt' : 'Không đạt'} |`)
    } else {
      const u = p.upload
      lines.push(`- ${u.files} tệp, ${u.payloadMb} MB/request, ${u.vus} VU, ${u.requests} request, mong đợi HTTP ${u.expectStatus}${u.knownBug ? ` (${u.knownBug})` : ''}`)
      lines.push(`- p50 ${fmt(u.p50)} ms, p95 ${fmt(u.p95)} ms, p99 ${fmt(u.p99)} ms, max ${fmt(u.max)} ms, lỗi ${u.errorPct}%, ngưỡng ${u.thresholdsOk ? 'Đạt' : 'Không đạt'}`)
    }
    lines.push(`- Bộ nhớ backend: RSS đầu pha ${p.memory.startRssMb} MB, đỉnh ${p.memory.peakRssMb} MB (tăng ${p.memory.deltaMb} MB), ArrayBuffer đỉnh ${p.memory.peakArrayBuffersMb} MB${p.rssPerRequestPayload !== undefined && p.rssPerRequestPayload !== null ? `; RSS tăng / payload đồng thời = ${p.rssPerRequestPayload}×` : ''}`)
    lines.push(`- AI giả nhận ${p.aiUploads} request, ${p.aiForwardedMb} MB`, '')
  }
  writeFileSync(path.join(OUT_DIR, 'summary.md'), lines.join('\n'))
  console.log(lines.join('\n'))

  const failed = result.phases.filter((p) => (p.rows ? !p.rows.filter((r) => r.scenario !== 'stress').every((r) => r.thresholdsOk) : !p.upload.thresholdsOk))
  if (failed.length) {
    console.log(`[perf] Không đạt ngưỡng ở pha: ${failed.map((p) => p.name).join(', ')}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
