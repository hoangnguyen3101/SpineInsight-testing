// Mục đích: Máy chủ giả Supabase cho kiểm thử phi chức năng, chỉ cài phần supabase-js của backend SUT gọi tới:
// GoTrue (/auth/v1: đăng nhập, làm mới token, lấy user, quản trị user) và PostgREST (/rest/v1/<bảng>).
// Dữ liệu nằm trong bộ nhớ (fixtures.mjs), chạy hoàn toàn trên localhost.
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { ACCOUNTS, seedTables } from './fixtures.mjs'

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

function fakeJwt(account) {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: account.id, email: account.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600, session_id: randomUUID() }
  return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.${Buffer.from(randomUUID()).toString('base64url')}`
}

function toUser(account) {
  return {
    id: account.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: account.email,
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    app_metadata: { provider: 'email', providers: ['email'], role: account.role, hospital_id: account.hospital_id },
    user_metadata: { full_name: account.full_name },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

const RESERVED = new Set(['select', 'order', 'offset', 'limit', 'or', 'on_conflict', 'columns'])

/** Lọc theo các tham số PostgREST dạng cột=eq.giá_trị (đủ cho các truy vấn của backend). */
function applyFilters(rows, params) {
  let result = rows
  for (const [column, raw] of params) {
    if (RESERVED.has(column)) continue
    const [op, ...rest] = raw.split('.')
    const value = rest.join('.')
    if (op === 'eq') result = result.filter((row) => String(row[column]) === value)
    else if (op === 'neq') result = result.filter((row) => String(row[column]) !== value)
    else if (op === 'is' && value === 'null') result = result.filter((row) => row[column] == null)
    else if (op === 'in') {
      const set = new Set(value.replace(/^\(|\)$/g, '').split(','))
      result = result.filter((row) => set.has(String(row[column])))
    }
  }
  return result
}

export function createMockSupabase() {
  const tables = seedTables()
  const sessions = new Map()
  const refreshTokens = new Map()
  const authAccounts = new Map(Object.values(ACCOUNTS).map((a) => [a.email, a]))
  const stats = { requests: 0 }

  function issueSession(account) {
    const accessToken = fakeJwt(account)
    const refreshToken = randomUUID()
    sessions.set(accessToken, account)
    refreshTokens.set(refreshToken, account)
    return { access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: refreshToken, user: toUser(account) }
  }

  function embed(table, row, select) {
    if (table === 'profiles') {
      const hospital = tables.hospitals.find((h) => h.id === row.hospital_id)
      const department = tables.departments.find((d) => d.id === row.department_id)
      return {
        ...row,
        hospital: hospital ? { id: hospital.id, code: hospital.code, name: hospital.name, is_active: hospital.is_active } : null,
        department: department ? { id: department.id, name: department.name } : null,
      }
    }
    if (table === 'hospitals' && select.includes('accounts')) {
      return { ...row, accounts: [{ count: tables.profiles.filter((p) => p.hospital_id === row.id).length }] }
    }
    if (table === 'departments' && select.includes('doctors')) {
      return { ...row, doctors: [{ count: tables.profiles.filter((p) => p.department_id === row.id).length }] }
    }
    return row
  }

  function rest(req, res, url, body, send) {
    const table = url.pathname.slice('/rest/v1/'.length)
    const rows = tables[table]
    if (!rows) return send(404, { code: 'PGRST205', message: `Could not find the table 'public.${table}'` })
    const params = [...url.searchParams.entries()]
    const select = url.searchParams.get('select') || '*'
    const prefer = req.headers.prefer || ''
    const wantObject = (req.headers.accept || '').includes('vnd.pgrst.object+json')
    const representation = prefer.includes('return=representation')

    const reply = (status, list, total) => {
      if (prefer.includes('count=exact')) {
        res.setHeader('Content-Range', list.length ? `0-${list.length - 1}/${total ?? list.length}` : `*/${total ?? 0}`)
      }
      if (wantObject) {
        if (list.length !== 1) {
          return send(406, { code: 'PGRST116', details: `The result contains ${list.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' })
        }
        return send(status, list[0])
      }
      return send(status, list)
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      let matched = applyFilters(rows, params)
      const order = url.searchParams.get('order')
      if (order) {
        const [column, direction] = order.split('.')
        matched = [...matched].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (direction === 'desc' ? -1 : 1))
      }
      const total = matched.length
      const offset = Number(url.searchParams.get('offset') || 0)
      const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : undefined
      const page = matched.slice(offset, limit === undefined ? undefined : offset + limit)
      return reply(200, page.map((row) => embed(table, row, select)), total)
    }
    if (req.method === 'POST') {
      const items = (Array.isArray(body) ? body : [body]).map((item) => ({
        id: item.id || randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...item,
      }))
      if (table === 'hospitals' && items.some((item) => rows.some((r) => r.code === item.code))) {
        return send(409, { code: '23505', message: 'duplicate key value violates unique constraint "hospitals_code_key"' })
      }
      for (const item of items) {
        const index = rows.findIndex((r) => r.id === item.id)
        if (index >= 0) rows[index] = { ...rows[index], ...item }
        else rows.push(item)
      }
      return representation ? reply(201, items.map((row) => embed(table, row, select))) : send(201)
    }
    if (req.method === 'PATCH') {
      const matched = applyFilters(rows, params)
      for (const row of matched) Object.assign(row, body, { updated_at: new Date().toISOString() })
      return representation ? reply(200, matched.map((row) => embed(table, row, select))) : reply(204, [])
    }
    if (req.method === 'DELETE') {
      const matched = new Set(applyFilters(rows, params))
      tables[table] = rows.filter((row) => !matched.has(row))
      if (prefer.includes('count=exact')) res.setHeader('Content-Range', `*/${matched.size}`)
      return representation ? send(200, [...matched]) : send(204)
    }
    return send(405, { message: 'method not allowed' })
  }

  const server = http.createServer((req, res) => {
    stats.requests++
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost')
      let body = {}
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
      } catch {
        body = {}
      }
      const send = (status, payload) => {
        if (payload === undefined || status === 204) {
          res.writeHead(status)
          return res.end()
        }
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      const bearer = (req.headers.authorization || '').replace(/^Bearer /, '')

      if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
        const grant = url.searchParams.get('grant_type')
        if (grant === 'password') {
          const account = authAccounts.get(body.email)
          if (!account || account.password !== body.password) {
            return send(400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
          }
          return send(200, issueSession(account))
        }
        if (grant === 'refresh_token') {
          const account = refreshTokens.get(body.refresh_token)
          return account ? send(200, issueSession(account)) : send(400, { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' })
        }
        return send(400, { code: 'unsupported_grant_type', msg: 'Unsupported grant type' })
      }
      if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
        const account = sessions.get(bearer)
        return account ? send(200, toUser(account)) : send(401, { code: 'bad_jwt', msg: 'invalid JWT' })
      }
      if (url.pathname === '/auth/v1/logout') return send(204)
      if (url.pathname === '/auth/v1/admin/users' && req.method === 'GET') {
        return send(200, { users: Object.values(ACCOUNTS).map(toUser), aud: 'authenticated' })
      }
      if (url.pathname === '/auth/v1/admin/users' && req.method === 'POST') {
        if (authAccounts.has(body.email)) return send(422, { code: 'email_exists', msg: 'A user with this email address has already been registered' })
        const account = { id: randomUUID(), email: body.email, password: body.password, role: body.app_metadata?.role, hospital_id: body.app_metadata?.hospital_id, full_name: body.user_metadata?.full_name }
        authAccounts.set(account.email, account)
        return send(200, toUser(account))
      }
      const adminUser = url.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/)
      if (adminUser) {
        const account = [...authAccounts.values()].find((a) => a.id === adminUser[1])
        if (!account) return send(404, { code: 'user_not_found', msg: 'User not found' })
        if (req.method === 'DELETE') {
          // Như Supabase thật: profiles.id tham chiếu auth.users ON DELETE CASCADE.
          authAccounts.delete(account.email)
          tables.profiles = tables.profiles.filter((p) => p.id !== account.id)
          return send(200, {})
        }
        if (body.password) account.password = body.password
        return send(200, toUser(account))
      }
      if (url.pathname.startsWith('/rest/v1/')) return rest(req, res, url, body, send)
      return send(404, { message: 'not found' })
    })
  })

  return {
    stats,
    listen: (port, host = '127.0.0.1') => new Promise((resolve) => server.listen(port, host, resolve)),
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.()
      server.close(() => resolve())
    }),
  }
}
