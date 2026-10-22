// Kiểm thử tích hợp nhóm /api/v1/auth: phân vùng tương đương (EP) và giá trị biên (BVA) qua route thật,
// middleware thật, AuthService thật; chỉ Supabase được giả lập.
jest.mock('@sut/src/config/supabase', () => ({
  supabase: { auth: { signInWithPassword: jest.fn(), refreshSession: jest.fn() } },
  supabaseAdmin: {
    from: jest.fn(),
    auth: { getUser: jest.fn(), admin: { createUser: jest.fn(), deleteUser: jest.fn(), updateUserById: jest.fn() } },
  },
}))

const request = require('supertest')
const { app } = require('@sut/src/app')
const { supabase, supabaseAdmin } = require('@sut/src/config/supabase')
const { AuthService } = require('@sut/src/services/authService')
const { createHttpError } = require('@sut/src/utils/httpError')
const { query, queueFrom } = require('../../support/backend/supabaseMock')
const { installAuth, bearer } = require('../mocks/authContext')

const API = '/api/v1/auth'
const session = { access_token: 'access-1', refresh_token: 'refresh-1' }
let profiles

beforeEach(() => {
  jest.resetAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  profiles = installAuth({ supabaseAdmin, AuthService, createHttpError })
  supabaseAdmin.from.mockImplementation(() => query({ data: null, error: null }))
})
afterEach(() => jest.restoreAllMocks())

describe('POST /auth/login (FR-01)', () => {
  test.each([
    ['thiếu password', { email: 'doctor@test.local' }],
    ['thiếu email', { password: 'MatKhau123' }],
    ['body rỗng', {}],
  ])('IT-AUTH-01: %s -> 400', async (_name, body) => {
    const res = await request(app).post(`${API}/login`).send(body)
    expect(res.status).toBe(400)
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled()
  })

  test('IT-AUTH-02: sai mật khẩu -> 401 "Email hoặc mật khẩu không đúng"', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ data: {}, error: { status: 400, message: 'Invalid login credentials' } })
    const res = await request(app).post(`${API}/login`).send({ email: 'doctor@test.local', password: 'sai' })
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Email hoặc mật khẩu không đúng' })
  })

  test('IT-AUTH-03: máy chủ xác thực lỗi (status 500) -> 503', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ data: {}, error: { status: 500, message: 'unexpected_failure' } })
    const res = await request(app).post(`${API}/login`).send({ email: 'doctor@test.local', password: 'MatKhau123' })
    expect(res.status).toBe(503)
  })

  test('IT-AUTH-04: tài khoản bị khoá -> 403', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'locked-id' }, session }, error: null })
    const res = await request(app).post(`${API}/login`).send({ email: 'locked@test.local', password: 'MatKhau123' })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Tai khoan da bi vo hieu hoa')
  })

  test('IT-AUTH-05: đăng nhập hợp lệ -> 200, trả token và profile camelCase', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'doctor-id', email: 'doctor@test.local' }, session }, error: null,
    })
    const res = await request(app).post(`${API}/login`).send({ email: 'doctor@test.local', password: 'MatKhau123' })
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      profile: { id: 'doctor-id', role: 'doctor', hospitalId: 'h1', isActive: true },
    })
    expect(res.body.data.profile).not.toHaveProperty('hospital_id')
  })
})

describe('POST /auth/refresh', () => {
  test('IT-AUTH-06: thiếu refreshToken -> 400', async () => {
    const res = await request(app).post(`${API}/refresh`).send({})
    expect(res.status).toBe(400)
  })
  test('IT-AUTH-07: refreshToken không hợp lệ -> 401; hợp lệ -> 200 cặp token mới', async () => {
    supabase.auth.refreshSession
      .mockResolvedValueOnce({ data: { session: null }, error: { message: 'Invalid Refresh Token' } })
      .mockResolvedValueOnce({ data: { session }, error: null })
    const bad = await request(app).post(`${API}/refresh`).send({ refreshToken: 'het-han' })
    expect(bad.status).toBe(401)
    const ok = await request(app).post(`${API}/refresh`).send({ refreshToken: 'refresh-0' })
    expect(ok.status).toBe(200)
    expect(ok.body.data).toEqual({ accessToken: 'access-1', refreshToken: 'refresh-1' })
  })
})

describe('GET /auth/me, PUT /auth/profile (FR-03)', () => {
  test('IT-AUTH-08: /me không có token -> 401, token rác -> 401', async () => {
    expect((await request(app).get(`${API}/me`)).status).toBe(401)
    expect((await request(app).get(`${API}/me`).set('Authorization', 'Bearer rac')).status).toBe(401)
  })
  test('IT-AUTH-09: /me có token hợp lệ -> 200 profile của chính mình', async () => {
    const res = await request(app).get(`${API}/me`).set(bearer('doctor'))
    expect(res.status).toBe(200)
    expect(res.body.data.profile).toMatchObject({ id: 'doctor-id', email: 'doctor@test.local', role: 'doctor' })
  })
  test('IT-AUTH-10: /profile không có trường hợp lệ -> 400; có fullName -> 200 và chỉ ghi full_name', async () => {
    const empty = await request(app).put(`${API}/profile`).set(bearer('doctor')).send({ role: 'admin' })
    expect(empty.status).toBe(400)

    const [update] = queueFrom(supabaseAdmin.from, { error: null })
    const res = await request(app).put(`${API}/profile`).set(bearer('doctor')).send({ fullName: 'Tên mới', role: 'admin' })
    expect(res.status).toBe(200)
    expect(update.update).toHaveBeenCalledWith({ full_name: 'Tên mới' })
    expect(update.eq).toHaveBeenCalledWith('id', 'doctor-id')
  })
})

describe('PUT /auth/password (FR-02, BVA độ dài mật khẩu mới)', () => {
  beforeEach(() => {
    supabase.auth.signInWithPassword.mockResolvedValue({ error: null })
    supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({ error: null })
  })

  test('IT-AUTH-11: thiếu mật khẩu hiện tại -> 400', async () => {
    const res = await request(app).put(`${API}/password`).set(bearer('doctor')).send({ newPassword: '12345678' })
    expect(res.status).toBe(400)
  })
  test.each([
    ['7 ký tự (dưới biên)', '1234567', 400],
    ['8 ký tự (tại biên)', '12345678', 200],
    ['9 ký tự (trên biên)', '123456789', 200],
  ])('IT-AUTH-12: mật khẩu mới %s (%s) -> %i', async (_name, newPassword, status) => {
    const res = await request(app).put(`${API}/password`).set(bearer('doctor')).send({ currentPassword: 'cu', newPassword })
    expect(res.status).toBe(status)
  })
  test('IT-AUTH-13: mật khẩu hiện tại sai -> 401, không đổi mật khẩu', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    const res = await request(app).put(`${API}/password`).set(bearer('doctor')).send({ currentPassword: 'sai', newPassword: '12345678' })
    expect(res.status).toBe(401)
    expect(supabaseAdmin.auth.admin.updateUserById).not.toHaveBeenCalled()
  })
})

describe('Quản lý tài khoản /auth/users (FR-13)', () => {
  test.each([
    ['thiếu fullName', { email: 'bs@test.local', password: 'MatKhau123' }],
    ['thiếu email', { password: 'MatKhau123', fullName: 'BS' }],
    ['mật khẩu 7 ký tự', { email: 'bs@test.local', password: '1234567', fullName: 'BS' }],
  ])('IT-AUTH-14: tạo tài khoản %s -> 400', async (_name, body) => {
    const res = await request(app).post(`${API}/users`).set(bearer('hospital')).send(body)
    expect(res.status).toBe(400)
    expect(supabaseAdmin.auth.admin.createUser).not.toHaveBeenCalled()
  })

  test('IT-AUTH-15: hospital tạo bác sĩ hợp lệ -> 201, tài khoản thuộc bệnh viện h1', async () => {
    queueFrom(supabaseAdmin.from, { data: { id: 'h1', is_active: true }, error: null }, { error: null })
    supabaseAdmin.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'new-id' } }, error: null })
    profiles.set('new-id', { ...profiles.get('doctor-id'), id: 'new-id', email: 'bs@test.local' })
    const res = await request(app).post(`${API}/users`).set(bearer('hospital'))
      .send({ email: 'bs@test.local', password: '12345678', fullName: 'Bác sĩ mới', hospitalId: 'h2' })
    expect(res.status).toBe(201)
    expect(res.body.data.profile).toMatchObject({ id: 'new-id', hospitalId: 'h1' })
    expect(supabaseAdmin.auth.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({
      app_metadata: { role: 'doctor', hospital_id: 'h1' },
    }))
  })

  test.each([['false'], [0], [null]])('IT-AUTH-16: khoá tài khoản với isActive=%p (không phải boolean) -> 400', async (isActive) => {
    const res = await request(app).patch(`${API}/users/doctor-id/status`).set(bearer('hospital')).send({ isActive })
    expect(res.status).toBe(400)
  })

  test('IT-AUTH-17: hospital khoá bác sĩ bệnh viện mình -> 200; bác sĩ bệnh viện khác -> 403', async () => {
    const [update] = queueFrom(supabaseAdmin.from, { error: null })
    const res = await request(app).patch(`${API}/users/doctor-id/status`).set(bearer('hospital')).send({ isActive: false })
    expect(res.status).toBe(200)
    expect(update.update).toHaveBeenCalledWith({ is_active: false, status: 'inactive' })
    const other = await request(app).patch(`${API}/users/doctor-h2-id/status`).set(bearer('hospital')).send({ isActive: false })
    expect(other.status).toBe(403)
  })

  test('IT-AUTH-18: admin xoá bác sĩ -> 204; tự xoá chính mình -> 400', async () => {
    supabaseAdmin.auth.admin.deleteUser.mockResolvedValue({ error: null })
    const res = await request(app).delete(`${API}/users/doctor-id`).set(bearer('admin'))
    expect(res.status).toBe(204)
    expect(supabaseAdmin.auth.admin.deleteUser).toHaveBeenCalledWith('doctor-id')
    const self = await request(app).delete(`${API}/users/admin-id`).set(bearer('admin'))
    expect(self.status).toBe(400)
  })

  test('IT-AUTH-19: đặt lại mật khẩu bác sĩ -> 200, mật khẩu mặc định "<Mã bệnh viện>@123"', async () => {
    supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({ error: null })
    const res = await request(app).post(`${API}/users/doctor-id/reset-password`).set(bearer('hospital'))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual({ email: 'doctor@test.local', password: 'Bvtest01@123' })
  })
})
