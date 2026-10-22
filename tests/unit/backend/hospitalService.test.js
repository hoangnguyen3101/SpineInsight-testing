// services/hospitalService.js - giá trị biên (BVA) cho mã bệnh viện, bảng quyết định cho xoá/đặt lại mật khẩu.
jest.mock('@sut/src/config/supabase', () => ({
  supabase: { auth: {} },
  supabaseAdmin: {
    from: jest.fn(),
    auth: { admin: { deleteUser: jest.fn(), updateUserById: jest.fn() } },
  },
}))

const { supabaseAdmin } = require('@sut/src/config/supabase')
const { HospitalService } = require('@sut/src/services/hospitalService')
const { AuthService } = require('@sut/src/services/authService')
const { queueFrom } = require('../../support/backend/supabaseMock')

const admin = { id: 'a1', role: 'admin' }
const hospitalRow = (overrides = {}) => ({
  id: 'h1', code: 'VIETDUC', name: 'BV Việt Đức', address: null, phone: '024', email: null, is_active: true, ...overrides,
})

beforeEach(() => {
  jest.resetAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('HospitalService.listHospitals / getHospital', () => {
  test('UT-HS-01: trang 2, 10 bản ghi/trang -> range(10, 19), đếm số tài khoản', async () => {
    const [q] = queueFrom(supabaseAdmin.from, { data: [hospitalRow({ accounts: [{ count: 4 }] })], error: null, count: 11 })
    const result = await HospitalService.listHospitals({ page: 2, perPage: 10 })
    expect(q.range).toHaveBeenCalledWith(10, 19)
    expect(result).toEqual({ data: [expect.objectContaining({ code: 'VIETDUC', accountCount: 4 })], total: 11, page: 2, perPage: 10 })
  })
  test('UT-HS-02: không truyền tham số -> trang 1, 20 bản ghi; count null -> total 0', async () => {
    const [q] = queueFrom(supabaseAdmin.from, { data: [], error: null, count: null })
    await expect(HospitalService.listHospitals()).resolves.toMatchObject({ total: 0, page: 1, perPage: 20 })
    expect(q.range).toHaveBeenCalledWith(0, 19)
  })
  test('UT-HS-03: lỗi DB khi liệt kê -> 400', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: { message: 'down' } })
    await expect(HospitalService.listHospitals()).rejects.toMatchObject({ statusCode: 400, message: 'down' })
  })
  test('UT-HS-04: getHospital không có bản ghi -> 404, lỗi DB -> 400', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: null }, { data: null, error: { message: 'x' } })
    await expect(HospitalService.getHospital('hx')).rejects.toMatchObject({ statusCode: 404 })
    await expect(HospitalService.getHospital('hx')).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('HospitalService.createHospital', () => {
  const body = (code) => ({ code, name: 'BV Test', phone: '024' })

  test.each([
    ['5 ký tự (dưới biên)', 'ABCDE'],
    ['31 ký tự (trên biên)', 'A'.repeat(31)],
    ['chứa khoảng trắng', 'BV VD01'],
    ['chứa ký tự @', 'BV@123'],
    ['có dấu tiếng Việt', 'BVĐAKHOA'],
    ['null', null],
  ])('UT-HS-05: mã %s -> 400, không ghi DB', async (_name, code) => {
    await expect(HospitalService.createHospital(body(code), admin)).rejects.toMatchObject({ statusCode: 400 })
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
  // BUG-10: RegExp.test(undefined) ép thành chuỗi "undefined" (9 chữ cái) nên lọt qua kiểm tra mã ở tầng service.
  // Controller đã chặn !code nên lỗi chỉ lộ ra khi service được gọi trực tiếp (script, service khác).
  test.failing('UT-HS-05b (BUG-10): không truyền mã -> 400, không ghi DB', async () => {
    queueFrom(supabaseAdmin.from, { data: hospitalRow({ code: 'undefined' }), error: null })
    jest.spyOn(AuthService, 'createUser').mockResolvedValue({ profile: {} })
    await expect(HospitalService.createHospital(body(undefined), admin)).rejects.toMatchObject({ statusCode: 400 })
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
  test.each([
    ['6 ký tự (biên dưới)', 'ABCDEF'],
    ['30 ký tự (biên trên)', 'A'.repeat(30)],
    ['chữ thường, số, - và _', 'bv_vd-01'],
  ])('UT-HS-06: mã %s hợp lệ -> được ghi vào bảng hospitals', async (_name, code) => {
    const [insert] = queueFrom(supabaseAdmin.from, { data: hospitalRow({ code }), error: null })
    jest.spyOn(AuthService, 'createUser').mockResolvedValue({ profile: {} })
    await HospitalService.createHospital(body(code), admin)
    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({ code, created_by: 'a1', address: null, email: null }))
  })
  test('UT-HS-07: mã đã tồn tại (23505) -> 400 "Ma benh vien da ton tai"', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: { code: '23505', message: 'duplicate key' } })
    await expect(HospitalService.createHospital(body('VIETDUC'), admin))
      .rejects.toMatchObject({ statusCode: 400, message: 'Ma benh vien da ton tai' })
  })
  test('UT-HS-08: lỗi DB khác khi thêm -> 400 giữ thông báo gốc', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: { code: '42501', message: 'permission denied' } })
    await expect(HospitalService.createHospital(body('VIETDUC'), admin))
      .rejects.toMatchObject({ statusCode: 400, message: 'permission denied' })
  })
  test('UT-HS-09: tạo tài khoản quản lý thất bại -> xoá bệnh viện vừa tạo, giữ mã lỗi gốc', async () => {
    const [, rollback] = queueFrom(supabaseAdmin.from, { data: hospitalRow(), error: null }, { error: null })
    const err = Object.assign(new Error('User already registered'), { statusCode: 409 })
    jest.spyOn(AuthService, 'createUser').mockRejectedValue(err)
    await expect(HospitalService.createHospital(body('VIETDUC'), admin)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Khong tao duoc tai khoan quan ly vietduc@spineinsight.vn: User already registered',
    })
    expect(rollback.delete).toHaveBeenCalled()
    expect(rollback.eq).toHaveBeenCalledWith('id', 'h1')
  })
  test('UT-HS-10: lỗi không có statusCode khi tạo tài khoản -> mặc định 400', async () => {
    queueFrom(supabaseAdmin.from, { data: hospitalRow(), error: null }, { error: null })
    jest.spyOn(AuthService, 'createUser').mockRejectedValue(new Error('boom'))
    await expect(HospitalService.createHospital(body('VIETDUC'), admin)).rejects.toMatchObject({ statusCode: 400 })
  })
  test('UT-HS-11: thành công -> tạo tài khoản hospital (email = mã viết thường, mật khẩu = mã)', async () => {
    queueFrom(supabaseAdmin.from, { data: hospitalRow(), error: null })
    const createUser = jest.spyOn(AuthService, 'createUser').mockResolvedValue({ profile: {} })
    const result = await HospitalService.createHospital(body('VIETDUC'), admin)
    expect(createUser).toHaveBeenCalledWith({
      role: 'hospital', hospitalId: 'h1', email: 'vietduc@spineinsight.vn', password: 'VIETDUC', fullName: 'BV Việt Đức', phone: '024',
    }, admin)
    expect(result).toMatchObject({ id: 'h1', code: 'VIETDUC', managerAccount: { email: 'vietduc@spineinsight.vn', password: 'VIETDUC' } })
  })
})

describe('HospitalService.deleteHospital (bảng quyết định D1-D6)', () => {
  test('UT-HS-12 D1: bệnh viện không tồn tại -> 404, không xoá gì', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: null })
    await expect(HospitalService.deleteHospital('hx')).rejects.toMatchObject({ statusCode: 404 })
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })
  test('UT-HS-13 D2: chưa có bảng studies (PGRST205) -> bỏ qua, vẫn xoá tài khoản và bệnh viện', async () => {
    const [, , , hospitalDelete] = queueFrom(
      supabaseAdmin.from,
      { data: hospitalRow(), error: null },
      { count: null, error: { code: 'PGRST205', message: 'relation not found' } },
      { data: [{ id: 'm1', email: 'vietduc@spineinsight.vn' }], error: null },
      { error: null },
    )
    supabaseAdmin.auth.admin.deleteUser.mockResolvedValue({ error: null })
    await expect(HospitalService.deleteHospital('h1')).resolves.toEqual({ deletedAccounts: 1, deletedStudies: 0 })
    expect(supabaseAdmin.auth.admin.deleteUser).toHaveBeenCalledWith('m1')
    expect(hospitalDelete.delete).toHaveBeenCalled()
  })
  test('UT-HS-14 D3: lỗi khác khi xoá ca chụp -> 400, không xoá tài khoản', async () => {
    queueFrom(supabaseAdmin.from, { data: hospitalRow(), error: null }, { error: { code: '23503', message: 'fk' } })
    await expect(HospitalService.deleteHospital('h1')).rejects.toMatchObject({ statusCode: 400 })
    expect(supabaseAdmin.auth.admin.deleteUser).not.toHaveBeenCalled()
  })
  test('UT-HS-15 D4: lỗi khi đọc danh sách tài khoản -> 400', async () => {
    queueFrom(supabaseAdmin.from, { data: hospitalRow(), error: null }, { count: 0, error: null }, { data: null, error: { message: 'x' } })
    await expect(HospitalService.deleteHospital('h1')).rejects.toMatchObject({ statusCode: 400 })
  })
  test('UT-HS-16 D5: xoá một tài khoản thất bại -> 400 nêu email, không xoá bệnh viện', async () => {
    queueFrom(
      supabaseAdmin.from,
      { data: hospitalRow(), error: null },
      { count: 0, error: null },
      { data: [{ id: 'd1', email: 'bs@test.local' }], error: null },
    )
    supabaseAdmin.auth.admin.deleteUser.mockResolvedValue({ error: { message: 'not allowed' } })
    await expect(HospitalService.deleteHospital('h1')).rejects.toMatchObject({
      statusCode: 400, message: 'Khong xoa duoc tai khoan bs@test.local: not allowed',
    })
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(3)
  })
  test('UT-HS-17 D6: xoá bản ghi bệnh viện lỗi -> 400', async () => {
    queueFrom(
      supabaseAdmin.from,
      { data: hospitalRow(), error: null },
      { count: 0, error: null },
      { data: [], error: null },
      { error: { message: 'locked' } },
    )
    await expect(HospitalService.deleteHospital('h1')).rejects.toMatchObject({ statusCode: 400, message: 'Khong xoa duoc benh vien: locked' })
  })
  test('UT-HS-18: thành công -> trả số tài khoản và số ca chụp đã xoá', async () => {
    const [, studies] = queueFrom(
      supabaseAdmin.from,
      { data: hospitalRow(), error: null },
      { count: 3, error: null },
      { data: [{ id: 'm1', email: 'a' }, { id: 'd1', email: 'b' }], error: null },
      { error: null },
    )
    supabaseAdmin.auth.admin.deleteUser.mockResolvedValue({ error: null })
    await expect(HospitalService.deleteHospital('h1')).resolves.toEqual({ deletedAccounts: 2, deletedStudies: 3 })
    expect(studies.delete).toHaveBeenCalledWith({ count: 'exact' })
    expect(studies.eq).toHaveBeenCalledWith('hospital_id', 'h1')
  })
})

describe('HospitalService.resetManagerPassword / setHospitalActive', () => {
  test('UT-HS-19: bệnh viện chưa có tài khoản quản lý -> 404', async () => {
    queueFrom(supabaseAdmin.from, { data: hospitalRow(), error: null }, { data: [], error: null })
    await expect(HospitalService.resetManagerPassword('h1')).rejects.toMatchObject({ statusCode: 404 })
  })
  test('UT-HS-20: đặt lại mật khẩu mọi tài khoản hospital về mã bệnh viện', async () => {
    const [, managers] = queueFrom(
      supabaseAdmin.from,
      { data: hospitalRow(), error: null },
      { data: [{ id: 'm1', email: 'a@x' }, { id: 'm2', email: 'b@x' }], error: null },
    )
    supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({ error: null })
    await expect(HospitalService.resetManagerPassword('h1')).resolves.toEqual({ password: 'VIETDUC', emails: ['a@x', 'b@x'] })
    expect(managers.eq).toHaveBeenCalledWith('role', 'hospital')
    expect(supabaseAdmin.auth.admin.updateUserById.mock.calls).toEqual([['m1', { password: 'VIETDUC' }], ['m2', { password: 'VIETDUC' }]])
  })
  test('UT-HS-21: lỗi đọc tài khoản hoặc lỗi cập nhật mật khẩu -> 400', async () => {
    queueFrom(supabaseAdmin.from, { data: hospitalRow(), error: null }, { data: null, error: { message: 'x' } })
    await expect(HospitalService.resetManagerPassword('h1')).rejects.toMatchObject({ statusCode: 400 })
    queueFrom(supabaseAdmin.from, { data: hospitalRow(), error: null }, { data: [{ id: 'm1', email: 'a@x' }], error: null })
    supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({ error: { message: 'weak' } })
    await expect(HospitalService.resetManagerPassword('h1'))
      .rejects.toMatchObject({ statusCode: 400, message: 'Khong dat lai duoc mat khau cho a@x: weak' })
  })
  test('UT-HS-22: setHospitalActive -> cập nhật is_active và trả DTO', async () => {
    const [q] = queueFrom(supabaseAdmin.from, { data: hospitalRow({ is_active: false }), error: null })
    await expect(HospitalService.setHospitalActive('h1', false)).resolves.toMatchObject({ id: 'h1', isActive: false })
    expect(q.update).toHaveBeenCalledWith({ is_active: false })
  })
  test('UT-HS-23: setHospitalActive không tìm thấy -> 404, lỗi DB -> 400', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: null }, { data: null, error: { message: 'x' } })
    await expect(HospitalService.setHospitalActive('hx', true)).rejects.toMatchObject({ statusCode: 404 })
    await expect(HospitalService.setHospitalActive('hx', true)).rejects.toMatchObject({ statusCode: 400 })
  })
})
