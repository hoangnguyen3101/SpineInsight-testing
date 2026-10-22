// Bảng quyết định requireAuth (R1-R6) và requireRole - xem Test Plan chương 4.
jest.mock('@sut/src/config/supabase', () => ({
  supabaseAdmin: { auth: { getUser: jest.fn() } },
}))
jest.mock('@sut/src/services/authService', () => ({
  AuthService: { getProfileById: jest.fn(), assertProfileActive: jest.fn() },
}))

const { supabaseAdmin } = require('@sut/src/config/supabase')
const { AuthService } = require('@sut/src/services/authService')
const { requireAuth, requireRole } = require('@sut/src/middlewares/authMiddleware')

function mockRes() {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}
const reqWith = (authorization) => ({ headers: authorization === undefined ? {} : { authorization } })

describe('requireAuth', () => {
  beforeEach(() => jest.resetAllMocks())

  test('R1: thiếu header Authorization -> 401, không gọi Supabase', async () => {
    const res = mockRes(); const next = jest.fn()
    await requireAuth(reqWith(), res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Token xac thuc la bat buoc' })
    expect(supabaseAdmin.auth.getUser).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  test.each([['Basic abc'], ['Bearer'], ['bearer abc'], ['']])('R1b: header "%s" không đúng dạng "Bearer <token>" -> 401', async (header) => {
    const res = mockRes(); const next = jest.fn()
    await requireAuth(reqWith(header), res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Token xac thuc la bat buoc' })
    expect(supabaseAdmin.auth.getUser).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  test('R2: token Supabase báo lỗi -> 401', async () => {
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } })
    const res = mockRes(); const next = jest.fn()
    await requireAuth(reqWith('Bearer bad'), res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Token khong hop le hoac da het han' })
    expect(next).not.toHaveBeenCalled()
  })

  test('R2b: Supabase không báo lỗi nhưng không trả user -> 401', async () => {
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
    const res = mockRes(); const next = jest.fn()
    await requireAuth(reqWith('Bearer bad'), res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Token khong hop le hoac da het han' })
    expect(AuthService.getProfileById).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  test('R3: không có profile -> 403', async () => {
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    AuthService.getProfileById.mockRejectedValue(new Error('not found'))
    const res = mockRes(); const next = jest.fn()
    await requireAuth(reqWith('Bearer ok'), res, next)
    expect(AuthService.getProfileById).toHaveBeenCalledWith('u1')
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Tai khoan chua duoc cap quyen truy cap' })
    expect(AuthService.assertProfileActive).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  test('R4: tài khoản bị vô hiệu hóa -> 403 với thông báo của service', async () => {
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    AuthService.getProfileById.mockResolvedValue({ id: 'u1', role: 'doctor' })
    const err = new Error('Tai khoan da bi vo hieu hoa'); err.statusCode = 403
    AuthService.assertProfileActive.mockImplementation(() => { throw err })
    const res = mockRes(); const next = jest.fn()
    await requireAuth(reqWith('Bearer ok'), res, next)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Tai khoan da bi vo hieu hoa' })
    expect(next).not.toHaveBeenCalled()
  })

  test('R4b: lỗi không có statusCode -> mặc định 403', async () => {
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    AuthService.getProfileById.mockResolvedValue({ id: 'u1' })
    AuthService.assertProfileActive.mockImplementation(() => { throw new Error('x') })
    const res = mockRes()
    await requireAuth(reqWith('Bearer ok'), res, jest.fn())
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'x' })
  })

  test('R5: ngoại lệ bất ngờ trong getUser -> 401 "Xac thuc that bai"', async () => {
    supabaseAdmin.auth.getUser.mockRejectedValue(new Error('network'))
    const res = mockRes(); const next = jest.fn()
    await requireAuth(reqWith('Bearer ok'), res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Xac thuc that bai' })
  })

  test('R6: hợp lệ -> gắn req.user, req.profile và gọi next()', async () => {
    const user = { id: 'u1' }; const profile = { id: 'u1', role: 'doctor' }
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user }, error: null })
    AuthService.getProfileById.mockResolvedValue(profile)
    const req = reqWith('Bearer good'); const res = mockRes(); const next = jest.fn()
    await requireAuth(req, res, next)
    expect(supabaseAdmin.auth.getUser).toHaveBeenCalledWith('good')
    expect(req.user).toBe(user); expect(req.profile).toBe(profile)
    expect(AuthService.assertProfileActive).toHaveBeenCalledWith(profile)
    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })
})

describe('requireRole', () => {
  test('RR1: chưa xác thực (không có req.profile) -> 401', () => {
    const res = mockRes(); const next = jest.fn()
    requireRole('admin')({}, res, next)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Chua xac thuc' })
    expect(next).not.toHaveBeenCalled()
  })
  test('RR2: sai vai trò -> 403', () => {
    const res = mockRes(); const next = jest.fn()
    requireRole('admin')({ profile: { role: 'doctor' } }, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Ban khong co quyen thuc hien hanh dong nay' })
    expect(next).not.toHaveBeenCalled()
  })
  test.each([['admin'], ['hospital']])('RR3: vai trò %s nằm trong danh sách -> next()', (role) => {
    const res = mockRes(); const next = jest.fn()
    requireRole('admin', 'hospital')({ profile: { role } }, res, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })
})
