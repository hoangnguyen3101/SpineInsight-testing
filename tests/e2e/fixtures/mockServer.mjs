// Mục đích: Máy chủ giả cho kiểm thử E2E, đóng vai Supabase Auth (/auth/v1) và backend (/api/v1).
// Chỉ dùng tài khoản giả, không kết nối Supabase hay máy chủ AI thật.
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { ACCOUNTS, HOSPITAL } from './accounts.mjs'

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

const EMPTY_PAGE = { data: [], total: 0, page: 1, perPage: 100 }

export function createMockServer() {
  const sessions = new Map()
  const refreshTokens = new Map()
  const requests = []

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
    if (req.method === 'GET' && (url.pathname === '/api/v1/hospitals' || url.pathname === '/api/v1/auth/users')) {
      return send(200, { data: EMPTY_PAGE })
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/departments') {
      return send(200, { data: [] })
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

    return send(404, { error: `Mock khong ho tro ${req.method} ${url.pathname}` })
  })

  return {
    requests,
    listen: (port) => new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
