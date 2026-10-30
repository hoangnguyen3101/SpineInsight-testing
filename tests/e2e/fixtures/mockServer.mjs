// Mục đích: Máy chủ giả cho kiểm thử E2E, đóng vai Supabase Auth (/auth/v1) và backend (/api/v1).
// Chỉ dùng tài khoản giả, không kết nối Supabase hay máy chủ AI thật.
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { ACCOUNTS, HOSPITAL } from './accounts.mjs'
import { impressionResponse, p2vgReport, rsnaResult } from './aiPayloads.mjs'
import { createBackendState, handleBackend } from './mockBackend.mjs'

function toProfile(account) {
  const inHospital = account.role !== 'admin'
  return {
    id: account.id,
    hospitalId: inHospital ? HOSPITAL.id : null,
    hospital: inHospital ? HOSPITAL : null,
    departmentId: null,
    department: null,
    specialty: null,
    employeeCode: null,
    fullName: account.fullName,
    email: account.email,
    phone: null,
    role: account.role,
    status: account.locked ? 'inactive' : 'active',
    isActive: !account.locked,
    avatarUrl: null,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

/** Token có dạng JWT (header.payload.signature) vì supabase-js có thể giải mã payload. */
function fakeJwt(account) {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: account.id,
    email: account.email,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + 3600,
    session_id: randomUUID(),
  }
  return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.${Buffer.from('e2e-signature').toString('base64url')}`
}

function toUser(account) {
  return {
    id: account.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: account.email,
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    app_metadata: { provider: 'email', providers: ['email'], role: account.role },
    user_metadata: { full_name: account.fullName },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

// Các endpoint nhận ảnh để phân tích/sinh báo cáo mà frontend có thể gọi, và loại dịch vụ AI tương ứng.
const UPLOAD_PATHS = new Map([
  ['/api/v1/report/upload-dicom-zip', 'p2vg'],
  ['/api/v1/p2vg/analyze', 'p2vg'],
  ['/api/v1/spine/analyze', 'spine'],
  ['/api/v1/spine/predict', 'spine'],
  ['/predict/analyze', 'spine'],
])
const AI_PAYLOADS = { spine: rsnaResult, p2vg: p2vgReport, impression: impressionResponse }
const ZIP_LOCAL_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const DICOM_MAGIC = Buffer.from('DICM', 'latin1')
const PART_HEADER = Buffer.from('Content-Disposition: form-data; name="', 'latin1')

/** Đếm số lần `needle` xuất hiện trong `buffer`, chỉ tính các lần kết thúc sau vị trí `skip` (tránh đếm trùng giữa hai chunk). */
function countOf(buffer, needle, skip) {
  let count = 0
  let index = buffer.indexOf(needle)
  while (index !== -1) {
    if (index + needle.length > skip) count++
    index = buffer.indexOf(needle, index + 1)
  }
  return count
}

export function createMockServer() {
  const sessions = new Map()
  const refreshTokens = new Map()
  const requests = []
  const uploads = []
  const backend = createBackendState()
  // Hàng đợi cách phản hồi của từng dịch vụ AI: 'ok' | '503' | 'network'; hết hàng đợi thì trả 503 (AI tắt).
  const ai = { spine: [], p2vg: [], impression: [], delayMs: 0 }
  const nextMode = (kind) => (ai[kind].length > 0 ? ai[kind].shift() : '503')

  /** Trả phản hồi AI theo chế độ: dữ liệu giả hợp lệ, lỗi 503 hoặc ngắt kết nối (lỗi mạng). */
  function respondAi(res, send, kind, mode) {
    setTimeout(() => {
      if (mode === 'network') {
        // Phản hồi bị cắt giữa chừng rồi đóng kết nối (trình duyệt báo lỗi mạng). Không đóng socket ngay từ đầu
        // vì Chrome sẽ tự gửi lại POST trên kết nối keep-alive và che mất lỗi.
        res.socket?.end('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 4096\r\n\r\n{"truncated":')
        return
      }
      if (mode === 'ok') return send(200, AI_PAYLOADS[kind]())
      return send(503, { error: `AI ${kind} service unavailable (mock)`, detail: `AI ${kind} service unavailable (mock)` })
    }, ai.delayMs)
  }

  function issueSession(account) {
    const accessToken = fakeJwt(account)
    const refreshToken = randomUUID()
    sessions.set(accessToken, account)
    refreshTokens.set(refreshToken, account)
    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: refreshToken,
      user: toUser(account),
    }
  }

  function accountFromBearer(req) {
    const header = req.headers.authorization || ''
    return header.startsWith('Bearer ') ? sessions.get(header.slice(7)) : undefined
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    requests.push(`${req.method} ${url.pathname}`)

    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*')
    res.setHeader('Access-Control-Expose-Headers', 'x-supabase-api-version')

    const send = (status, body) => {
      if (body === undefined) {
        res.writeHead(status).end()
        return
      }
      res.writeHead(status, { 'Content-Type': 'application/json', 'x-supabase-api-version': '2024-01-01' })
      res.end(JSON.stringify(body))
    }

    if (req.method === 'OPTIONS') return send(204)

    // Viewer gửi ảnh DICOM sang dịch vụ AI (RSNA qua backend, P2VG trực tiếp). Máy chủ giả chỉ ghi nhận siêu dữ
    // liệu của request (kích thước, kiểu nội dung, tên các trường multipart, số chữ ký ZIP "PK\x03\x04" và DICOM
    // "DICM" đi qua), không lưu hay chuyển tiếp nội dung, rồi phản hồi theo chế độ đã đặt trong `ai`.
    if (req.method === 'POST' && UPLOAD_PATHS.has(url.pathname)) {
      const kind = UPLOAD_PATHS.get(url.pathname)
      const record = {
        path: url.pathname,
        kind,
        mode: nextMode(kind),
        authorization: Boolean(req.headers.authorization),
        contentType: req.headers['content-type'] || '',
        contentLength: Number(req.headers['content-length'] || 0),
        bytes: 0,
        field: null,
        fileName: null,
        fields: {},
        zipEntries: 0,
        dicomMagic: 0,
        completed: false,
        startedAt: Date.now(),
        endedAt: null,
      }
      uploads.push(record)
      let carry = Buffer.alloc(0)
      req.on('data', (chunk) => {
        record.bytes += chunk.length
        const window = Buffer.concat([carry, chunk])
        record.zipEntries += countOf(window, ZIP_LOCAL_HEADER, carry.length)
        record.dicomMagic += countOf(window, DICOM_MAGIC, carry.length)
        let index = window.indexOf(PART_HEADER)
        while (index !== -1) {
          if (index + PART_HEADER.length > carry.length) {
            const header = window.subarray(index, index + 300).toString('latin1')
            const match = header.match(/name="([^"]+)"(?:; filename="([^"]*)")?/)
            if (match) {
              record.fields[match[1]] = (record.fields[match[1]] || 0) + 1
              if (!record.field) {
                record.field = match[1]
                record.fileName = match[2] ?? null
              }
            }
          }
          index = window.indexOf(PART_HEADER, index + 1)
        }
        carry = window.subarray(Math.max(0, window.length - PART_HEADER.length))
      })
      req.on('end', () => {
        record.completed = true
        record.endedAt = Date.now()
        respondAi(res, send, kind, record.mode)
      })
      return undefined
    }

    let body = {}
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      try {
        body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
      } catch {
        body = {}
      }
    }

    // ----- Supabase Auth -----
    if (req.method === 'POST' && url.pathname === '/auth/v1/token') {
      const grantType = url.searchParams.get('grant_type')
      if (grantType === 'password') {
        const account = Object.values(ACCOUNTS).find((a) => a.email === body.email)
        if (!account || account.password !== body.password) {
          return send(400, {
            code: 'invalid_credentials',
            error_code: 'invalid_credentials',
            msg: 'Invalid login credentials',
          })
        }
        return send(200, issueSession(account))
      }
      if (grantType === 'refresh_token') {
        const account = refreshTokens.get(body.refresh_token)
        if (!account) return send(400, { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' })
        return send(200, issueSession(account))
      }
      return send(400, { code: 'unsupported_grant_type', msg: 'Unsupported grant type' })
    }
    if (req.method === 'POST' && url.pathname === '/auth/v1/logout') {
      const header = req.headers.authorization || ''
      sessions.delete(header.slice(7))
      return send(204)
    }
    if (req.method === 'GET' && url.pathname === '/auth/v1/user') {
      const account = accountFromBearer(req)
      return account ? send(200, toUser(account)) : send(401, { code: 'bad_jwt', msg: 'invalid JWT' })
    }

    // ----- Backend /api/v1 -----
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/me') {
      const account = accountFromBearer(req)
      if (!account) return send(401, { error: 'Token khong hop le hoac da het han' })
      if (account.locked) return send(403, { error: 'Tai khoan da bi vo hieu hoa' })
      return send(200, { data: { profile: toProfile(account) } })
    }
    const managed = handleBackend(backend, {
      method: req.method, path: url.pathname, query: url.searchParams, body, actorAccount: accountFromBearer(req),
    })
    if (managed) return send(managed.status, managed.body)
    // Dịch vụ sinh "impression" (MedGemma) — frontend gọi trực tiếp VITE_IMPRESSION_API_URL + /impression.
    if (req.method === 'POST' && url.pathname === '/impression') {
      uploads.push({ path: url.pathname, kind: 'impression', mode: ai.impression[0] ?? '503', body, completed: true })
      return respondAi(res, send, 'impression', nextMode('impression'))
    }
    if (req.method === 'GET' && /^\/api\/v1\/(spine|p2vg)\/config$/.test(url.pathname)) {
      return send(200, { aiServerUrl: null, apiKey: null })
    }
    if (req.method === 'GET' && /^\/api\/v1\/(spine|p2vg)\/health$/.test(url.pathname)) {
      return send(200, { status: 'error', ok: false, error: 'AI server not configured (mock)' })
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/dicom/folders') {
      return send(200, { data: [] })
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/health') {
      return send(200, { status: 'error', ok: false, error: 'AI service disabled in E2E (mock)' })
    }

    return send(404, { error: `Mock khong ho tro ${req.method} ${url.pathname}` })
  })

  return {
    requests,
    uploads,
    backend,
    ai,
    listen: (port) => new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
