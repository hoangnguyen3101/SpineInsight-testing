// Mục đích: Kiểm tra tái hiện các phát hiện bảo mật (từ OWASP ZAP và rà cấu hình) mà không cần chạy ZAP.
// Mỗi phát hiện viết theo hành vi ĐÚNG mong đợi và đánh dấu knownBug: test xanh khi lỗi còn (thất bại đúng thông báo),
// chuyển đỏ khi lỗi được sửa để nhắc bỏ đánh dấu. Backend SUT chạy thật qua harness (cổng riêng, chỉ localhost).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { ACCOUNTS, IDS } from '../support/fixtures.mjs'
import { login, startHarness, waitForHttp } from '../support/harness.mjs'
import { createRequire } from 'node:module'

const { sutDir, backendDir } = createRequire(import.meta.url)('../../../sut.config.cjs')
const PORTS = { backend: 3103, supabase: 54421, ai: 54422 }
let harness
let doctorToken

/** Như knownBug của E2E: chỉ đạt khi kịch bản thất bại đúng với thông báo mong đợi (lỗi vẫn còn). */
function knownBug(id, name, expected, fn) {
  test(`${id} [lỗi đã biết]: ${name}`, async () => {
    await assert.rejects(fn, (err) => {
      assert.match(String(err.message), expected)
      return true
    })
  })
}

const get = (p, headers = {}) => fetch(`${harness.backendUrl}${p}`, { headers })

before(async () => {
  harness = await startHarness({ ports: PORTS })
  await waitForHttp(`${harness.backendUrl}/health`)
  doctorToken = await login(harness.backendUrl, ACCOUNTS.doctor.email, ACCOUNTS.doctor.password)
})

after(async () => {
  await harness?.stop()
})

describe('Kiểm tra bảo mật tái hiện được (backend SUT, NODE_ENV=production, cấu hình mặc định)', () => {
  knownBug('SEC-01 (BUG-31)', 'phản hồi API không được để lộ công nghệ qua X-Powered-By', /X-Powered-By: Express/, async () => {
    const res = await get('/api/v1/auth/me', { Authorization: `Bearer ${doctorToken}` })
    const header = res.headers.get('x-powered-by')
    assert.equal(header, null, `X-Powered-By: ${header}`)
  })

  knownBug('SEC-02 (BUG-32)', 'phản hồi JSON phải có X-Content-Type-Options: nosniff', /thiếu X-Content-Type-Options/, async () => {
    for (const p of ['/health', '/api/v1/studies', '/api/v1/spine/config']) {
      const res = await get(p)
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', `${p} thiếu X-Content-Type-Options`)
    }
  })

  knownBug('SEC-03 (BUG-33)', 'cấu hình mặc định không được phản chiếu Origin lạ kèm Allow-Credentials', /phản chiếu Origin lạ/, async () => {
    const evil = 'https://evil.example'
    const res = await get('/api/v1/auth/me', { Origin: evil, Authorization: `Bearer ${doctorToken}` })
    const allowOrigin = res.headers.get('access-control-allow-origin')
    const allowCredentials = res.headers.get('access-control-allow-credentials')
    assert.ok(!(allowOrigin === evil && allowCredentials === 'true'), `phản chiếu Origin lạ: ACAO=${allowOrigin}, ACAC=${allowCredentials}`)
  })

  knownBug('SEC-04 (BUG-34)', 'phản hồi chứa dữ liệu cá nhân phải có Cache-Control: no-store', /không có Cache-Control no-store/, async () => {
    for (const p of ['/api/v1/auth/me', `/api/v1/studies/${IDS.study(1)}`]) {
      const res = await get(p, { Authorization: `Bearer ${doctorToken}` })
      const cache = res.headers.get('cache-control') || ''
      assert.match(cache, /no-store/, `${p} không có Cache-Control no-store (nhận "${cache}")`)
    }
  })

  knownBug('SEC-05 (BUG-35)', 'cấu hình triển khai frontend phải khai báo CSP và chống clickjacking', /netlify\.toml không khai báo/, async () => {
    const toml = readFileSync(path.join(sutDir, 'netlify.toml'), 'utf8')
    for (const header of ['Content-Security-Policy', 'X-Frame-Options', 'X-Content-Type-Options']) {
      assert.ok(toml.includes(header), `netlify.toml không khai báo ${header} trong [[headers]]`)
    }
  })

  // Kiểm thử hiệu năng đo được: một ca 146 MB làm RSS backend tăng khoảng 380 MB (ArrayBuffer đỉnh 473 MB),
  // 3 ca đồng thời tăng 897 MB. Route tải lên không cần đăng nhập (BUG-06), nên giới hạn tài nguyên là tuyến phòng thủ duy nhất.
  knownBug('SEC-08 (BUG-36)', 'tải lên DICOM phải có giới hạn tổng dung lượng giữ trong RAM (tối đa 1 GiB mỗi request)', /có thể giữ tới/, async () => {
    const { dicomUpload } = createRequire(import.meta.url)(path.join(backendDir, 'src', 'middlewares', 'fileUpload.js'))
    const inMemory = dicomUpload.storage?.constructor?.name === 'MemoryStorage'
    const maxBytes = (dicomUpload.limits?.fileSize ?? Infinity) * (dicomUpload.limits?.files ?? Infinity)
    const GiB = 1024 ** 3
    assert.ok(!inMemory || maxBytes <= GiB, `MemoryStorage có thể giữ tới ${Math.round(maxBytes / GiB)} GiB mỗi request`)
  })

  // Quan sát O-1 (từ cảnh báo ZAP 90024 "Generic Padding Oracle", đã phân loại là false positive về mật mã).
  knownBug('SEC-09 (quan sát O-1)', 'sửa báo cáo với reportId không tồn tại phải trả 404, không phải 500', /trả 500/, async () => {
    const res = await fetch(`${harness.backendUrl}/api/v1/studies/${IDS.study(1)}/report`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId: '00000000-0000-4000-8006-999999999999', editedReport: 'x' }),
    })
    assert.equal(res.status, 404, `trả ${res.status}`)
  })

  test('SEC-06: lỗi 500 trong production không lộ stack trace hay thông báo nội bộ', async () => {
    const body = new FormData()
    for (let i = 0; i < 2001; i++) body.append('files', new Blob([new Uint8Array(8)]), `f${i}.dcm`)
    const res = await fetch(`${harness.backendUrl}/api/v1/spine/analyze`, { method: 'POST', body })
    const text = await res.text()
    assert.equal(res.status, 500)
    assert.equal(JSON.parse(text).error, 'Internal server error')
    assert.doesNotMatch(text, /at \w+ \(|node_modules|Error:/)
  })

  test('SEC-07: route quản trị từ chối truy cập ẩn danh (401) và trái vai trò (403)', async () => {
    assert.equal((await get('/api/v1/hospitals')).status, 401)
    assert.equal((await get('/api/v1/hospitals', { Authorization: `Bearer ${doctorToken}` })).status, 403)
  })
})
