jest.mock('@sut/src/config/supabase', () => ({
  supabase: { auth: {} },
  supabaseAdmin: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  },
}))
const request = require('supertest')
const { app } = require('@sut/src/app')
const { supabaseAdmin } = require('@sut/src/config/supabase')

describe('API tích hợp (Supertest)', () => {
  test('IT-APP-01: GET /health -> 200 {status: ok}', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  test('IT-APP-02: GET /health/supabase khi DB lỗi -> 503 degraded', async () => {
    supabaseAdmin.from.mockReturnValue({ select: () => ({ limit: async () => ({ error: { message: 'down' } }) }) })
    supabaseAdmin.auth.admin = { listUsers: async () => ({ error: null }) }
    const res = await request(app).get('/health/supabase')
    expect(res.status).toBe(503)
    expect(res.body.status).toBe('degraded')
    expect(res.body.services.database).toMatch(/error/)
  })

  test('IT-APP-03: GET /health/supabase khi mọi thứ ổn -> 200', async () => {
    supabaseAdmin.from.mockReturnValue({ select: () => ({ limit: async () => ({ error: null }) }) })
    supabaseAdmin.auth.admin = { listUsers: async () => ({ error: null }) }
    const res = await request(app).get('/health/supabase')
    expect(res.status).toBe(200)
    expect(res.body.services).toEqual({ database: 'ok', auth: 'ok' })
  })

  test('IT-APP-04: route không tồn tại -> 404', async () => {
    const res = await request(app).get('/khong-co')
    expect(res.status).toBe(404)
  })

  test.each(['/api/v1/hospitals', '/api/v1/departments'])(
    'IT-APP-05: GET %s không có token -> 401', async (url) => {
      const res = await request(app).get(url)
      expect(res.status).toBe(401)
    })

  // BUG-01: studyRoutes không gắn requireAuth nên truy cập ẩn danh trả 500 (lẽ ra 401).
  // test.failing: bộ test vẫn xanh nhưng sẽ báo đỏ khi lỗi được sửa -> nhắc bỏ test.failing.
  test.failing('IT-APP-06 (BUG-01): GET /api/v1/studies không có token phải trả 401', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const res = await request(app).get('/api/v1/studies')
    expect(res.status).toBe(401)
  })

  test('IT-APP-07: /health/supabase khi Supabase ném ngoại lệ -> 503, ghi rõ lỗi từng dịch vụ', async () => {
    supabaseAdmin.from.mockImplementation(() => { throw new Error('ECONNREFUSED') })
    supabaseAdmin.auth.admin = { listUsers: async () => { throw new Error('timeout') } }
    const res = await request(app).get('/health/supabase')
    expect(res.status).toBe(503)
    expect(res.body.services).toEqual({ database: 'error: ECONNREFUSED', auth: 'error: timeout' })
  })

  test('IT-APP-08: /health/supabase khi Auth trả lỗi -> 503, database vẫn ok', async () => {
    supabaseAdmin.from.mockReturnValue({ select: () => ({ limit: async () => ({ error: null }) }) })
    supabaseAdmin.auth.admin = { listUsers: async () => ({ error: { message: 'invalid service key' } }) }
    const res = await request(app).get('/health/supabase')
    expect(res.status).toBe(503)
    expect(res.body.services).toEqual({ database: 'ok', auth: 'error: invalid service key' })
  })
})

// CORS với ALLOWED_ORIGINS (bảng quyết định: có/không có header Origin x origin thuộc/không thuộc danh sách).
describe('CORS khi cấu hình ALLOWED_ORIGINS', () => {
  let corsApp
  beforeAll(() => {
    jest.isolateModules(() => {
      process.env.ALLOWED_ORIGINS = 'https://spineinsight.test, http://localhost:5173'
      corsApp = require('@sut/src/app').app
      delete process.env.ALLOWED_ORIGINS
    })
  })
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => jest.restoreAllMocks())

  test.each([
    ['origin thuộc danh sách', 'http://localhost:5173'],
    ['origin thuộc danh sách (đã cắt khoảng trắng)', 'https://spineinsight.test'],
  ])('IT-APP-09: %s -> 200 và trả Access-Control-Allow-Origin', async (_name, origin) => {
    const res = await request(corsApp).get('/health').set('Origin', origin)
    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe(origin)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })
  test('IT-APP-10: không có header Origin (curl, server-to-server) -> 200', async () => {
    const res = await request(corsApp).get('/health')
    expect(res.status).toBe(200)
  })
  test('IT-APP-11: origin lạ -> không có Access-Control-Allow-Origin; thực tế trả 500 qua errorHandler', async () => {
    const res = await request(corsApp).get('/health').set('Origin', 'https://evil.test')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'CORS: origin khong duoc phep' })
  })
  // BUG-08: request từ origin không được phép bị coi là lỗi máy chủ (500) thay vì bị từ chối (403).
  test.failing('IT-APP-12 (BUG-08): origin không được phép -> 403, không phải 500', async () => {
    const res = await request(corsApp).get('/health').set('Origin', 'https://evil.test')
    expect(res.status).toBe(403)
  })
})
