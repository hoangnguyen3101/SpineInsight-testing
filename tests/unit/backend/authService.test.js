// services/authService.js - bảng quyết định cho login, assertProfileActive, createUser, getManageableUser.
jest.mock('@sut/src/config/supabase', () => ({
  supabase: { auth: { signInWithPassword: jest.fn(), refreshSession: jest.fn() } },
  supabaseAdmin: {
    from: jest.fn(),
    auth: { admin: { createUser: jest.fn(), deleteUser: jest.fn(), updateUserById: jest.fn() } },
  },
}))

const { supabase, supabaseAdmin } = require('@sut/src/config/supabase')
const { AuthService } = require('@sut/src/services/authService')
const { queueFrom } = require('../../support/backend/supabaseMock')

const hospital = { id: 'h1', code: 'VIETDUC', name: 'BV Việt Đức', is_active: true }
const makeProfile = (overrides = {}) => ({
  id: 'u1', email: 'u1@test.local', full_name: 'Người dùng', role: 'doctor',
  hospital_id: 'h1', hospital, status: 'active', is_active: true, ...overrides,
})
const admin = makeProfile({ id: 'a1', role: 'admin', hospital_id: null, hospital: null })
const manager = makeProfile({ id: 'm1', role: 'hospital' })
const session = { access_token: 'access', refresh_token: 'refresh' }

beforeEach(() => {
  jest.resetAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('AuthService.login (bảng quyết định L1-L7)', () => {
  const signInFails = (error) => supabase.auth.signInWithPassword.mockResolvedValue({ data: {}, error })
  const credentials = { email: 'u1@test.local', password: 'secret123' }

  test('UT-AS-01 (L1): Supabase trả status 500 -> 503', async () => {
    signInFails({ status: 500, message: 'boom' })
    await expect(AuthService.login(credentials)).rejects.toMatchObject({ statusCode: 503 })
  })
  test('UT-AS-02 (L2): thông báo "Database error ..." -> 503', async () => {
    signInFails({ status: 400, message: 'Database error querying schema' })
    await expect(AuthService.login(credentials)).rejects.toMatchObject({ statusCode: 503 })
  })
  test('UT-AS-03 (L3): sai email/mật khẩu -> 401 với thông báo chuẩn', async () => {
    signInFails({ status: 400, message: 'Invalid login credentials' })
    await expect(AuthService.login(credentials))
      .rejects.toMatchObject({ statusCode: 401, message: 'Email hoặc mật khẩu không đúng' })
  })
  test('UT-AS-04 (L4): lỗi khác của Supabase -> 401 giữ thông báo gốc', async () => {
    signInFails({ status: 400, message: 'Email not confirmed' })
    await expect(AuthService.login(credentials)).rejects.toMatchObject({ statusCode: 401, message: 'Email not confirmed' })
  })
  test('UT-AS-05 (L5): đăng nhập được nhưng không có profile -> 403', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' }, session }, error: null })
    queueFrom(supabaseAdmin.from, { data: null, error: { message: 'no rows' } })
    await expect(AuthService.login(credentials)).rejects.toMatchObject({ statusCode: 403 })
  })
  test('UT-AS-06 (L6): profile bị khoá -> 403', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' }, session }, error: null })
    queueFrom(supabaseAdmin.from, { data: makeProfile({ is_active: false }), error: null })
    await expect(AuthService.login(credentials)).rejects.toMatchObject({ statusCode: 403 })
  })
  test('UT-AS-07 (L7): hợp lệ -> trả token, profile DTO và cập nhật last_login_at', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'u1', email: 'u1@test.local' }, session }, error: null,
    })
    const [, lastLogin] = queueFrom(supabaseAdmin.from, { data: makeProfile(), error: null }, { error: null })
    const result = await AuthService.login(credentials)
    expect(result).toMatchObject({
      user: { id: 'u1', email: 'u1@test.local' },
      profile: { id: 'u1', role: 'doctor', hospital: { code: 'VIETDUC' } },
      accessToken: 'access',
      refreshToken: 'refresh',
    })
    expect(lastLogin.update).toHaveBeenCalledWith({ last_login_at: expect.any(String) })
  })
  test('UT-AS-08: cập nhật last_login_at lỗi -> chỉ ghi cảnh báo, không chặn đăng nhập', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u1' }, session }, error: null })
    queueFrom(supabaseAdmin.from, { data: makeProfile(), error: null }, { error: { message: 'timeout' } })
    await expect(AuthService.login(credentials)).resolves.toHaveProperty('accessToken', 'access')
    await new Promise(setImmediate)
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('AuthService.assertProfileActive (bảng quyết định A1-A6)', () => {
  test.each([
    ['A1: is_active = false', makeProfile({ is_active: false })],
    ['A2: status khác active', makeProfile({ status: 'suspended' })],
    ['A3: bác sĩ thuộc bệnh viện bị khoá', makeProfile({ hospital: { ...hospital, is_active: false } })],
  ])('UT-AS-09 %s -> ném 403', (_name, profile) => {
    expect(() => AuthService.assertProfileActive(profile)).toThrow(expect.objectContaining({ statusCode: 403 }))
  })
  test.each([
    ['A4: admin, bệnh viện bị khoá vẫn qua', makeProfile({ role: 'admin', hospital: { ...hospital, is_active: false } })],
    ['A5: không gắn bệnh viện', makeProfile({ hospital: null })],
    ['A6: mọi điều kiện hợp lệ', makeProfile()],
  ])('UT-AS-10 %s -> không ném lỗi', (_name, profile) => {
    expect(() => AuthService.assertProfileActive(profile)).not.toThrow()
  })
})

describe('AuthService: token, profile, mật khẩu', () => {
  test('UT-AS-11: refreshToken lỗi hoặc không có session -> 401', async () => {
    supabase.auth.refreshSession.mockResolvedValueOnce({ data: {}, error: { message: 'x' } })
    await expect(AuthService.refreshToken('r')).rejects.toMatchObject({ statusCode: 401 })
    supabase.auth.refreshSession.mockResolvedValueOnce({ data: { session: null }, error: null })
    await expect(AuthService.refreshToken('r')).rejects.toMatchObject({ statusCode: 401 })
  })
  test('UT-AS-12: refreshToken hợp lệ -> cặp token mới', async () => {
    supabase.auth.refreshSession.mockResolvedValue({ data: { session }, error: null })
    await expect(AuthService.refreshToken('r')).resolves.toEqual({ accessToken: 'access', refreshToken: 'refresh' })
    expect(supabase.auth.refreshSession).toHaveBeenCalledWith({ refresh_token: 'r' })
  })
  test('UT-AS-13: getProfileById không tìm thấy -> 404', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: null })
    await expect(AuthService.getProfileById('x')).rejects.toMatchObject({ statusCode: 404 })
  })
  test('UT-AS-14: getFullProfile bọc DTO trong { profile }', async () => {
    queueFrom(supabaseAdmin.from, { data: makeProfile(), error: null })
    await expect(AuthService.getFullProfile('u1')).resolves.toEqual({ profile: expect.objectContaining({ id: 'u1' }) })
  })
  test('UT-AS-15: updateProfile không có trường nào -> 400, không gọi DB', async () => {
    await expect(AuthService.updateProfile('u1', { email: 'khong-duoc-sua@test.local' }))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
  test('UT-AS-16: updateProfile chỉ ghi các trường được phép, đổi sang snake_case', async () => {
    const [update] = queueFrom(supabaseAdmin.from, { error: null }, { data: makeProfile(), error: null })
    await AuthService.updateProfile('u1', { fullName: 'Tên mới', phone: '0900', role: 'admin', avatarUrl: undefined })
    expect(update.update).toHaveBeenCalledWith({ full_name: 'Tên mới', phone: '0900' })
    expect(update.eq).toHaveBeenCalledWith('id', 'u1')
  })
  test('UT-AS-17: updateProfile lỗi DB -> 400', async () => {
    queueFrom(supabaseAdmin.from, { error: { message: 'bad date' } })
    await expect(AuthService.updateProfile('u1', { dateOfBirth: 'x' })).rejects.toMatchObject({ statusCode: 400 })
  })
  test('UT-AS-18: changePassword sai mật khẩu hiện tại -> 401', async () => {
    queueFrom(supabaseAdmin.from, { data: makeProfile(), error: null })
    supabase.auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    await expect(AuthService.changePassword('u1', { currentPassword: 'sai', newPassword: 'MatKhauMoi1' }))
      .rejects.toMatchObject({ statusCode: 401 })
    expect(supabaseAdmin.auth.admin.updateUserById).not.toHaveBeenCalled()
  })
  test('UT-AS-19: changePassword Supabase từ chối mật khẩu mới -> 400', async () => {
    queueFrom(supabaseAdmin.from, { data: makeProfile(), error: null })
    supabase.auth.signInWithPassword.mockResolvedValue({ error: null })
    supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({ error: { message: 'weak password' } })
    await expect(AuthService.changePassword('u1', { currentPassword: 'dung', newPassword: 'yeu' }))
      .rejects.toMatchObject({ statusCode: 400, message: 'weak password' })
  })
  test('UT-AS-20: changePassword hợp lệ -> đổi mật khẩu và ghi password_changed_at', async () => {
    const [, stamp] = queueFrom(supabaseAdmin.from, { data: makeProfile(), error: null }, { error: null })
    supabase.auth.signInWithPassword.mockResolvedValue({ error: null })
    supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({ error: null })
    await AuthService.changePassword('u1', { currentPassword: 'dung', newPassword: 'MatKhauMoi1' })
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'u1@test.local', password: 'dung' })
    expect(supabaseAdmin.auth.admin.updateUserById).toHaveBeenCalledWith('u1', { password: 'MatKhauMoi1' })
    expect(stamp.update).toHaveBeenCalledWith({ password_changed_at: expect.any(String) })
  })
})

describe('AuthService.createUser (bảng quyết định C1-C11)', () => {
  const body = { email: 'bs@test.local', password: 'MatKhau123', fullName: 'Bác sĩ B' }

  test.each([
    ['C1: admin tạo role admin', admin, { ...body, role: 'admin', hospitalId: 'h1' }, 400],
    ['C2: admin không chọn bệnh viện', admin, { ...body, role: 'doctor' }, 400],
    ['C3: hospital tạo tài khoản hospital', manager, { ...body, role: 'hospital' }, 403],
    ['C4: bác sĩ tạo tài khoản', makeProfile(), { ...body, role: 'doctor' }, 403],
  ])('UT-AS-21 %s -> %i, không gọi DB', async (_name, actor, input, status) => {
    await expect(AuthService.createUser(input, actor)).rejects.toMatchObject({ statusCode: status })
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
  test('UT-AS-22 C5: bệnh viện không tồn tại -> 404', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: null })
    await expect(AuthService.createUser({ ...body, hospitalId: 'hx' }, admin)).rejects.toMatchObject({ statusCode: 404 })
  })
  test('UT-AS-23 C6: bệnh viện đã bị khoá -> 400', async () => {
    queueFrom(supabaseAdmin.from, { data: { id: 'h1', is_active: false }, error: null })
    await expect(AuthService.createUser({ ...body, hospitalId: 'h1' }, admin)).rejects.toMatchObject({ statusCode: 400 })
  })
  test('UT-AS-24 C7: khoa không thuộc bệnh viện -> 400', async () => {
    const [, department] = queueFrom(supabaseAdmin.from, { data: { id: 'h1', is_active: true } }, { data: null })
    await expect(AuthService.createUser({ ...body, departmentId: 'd9' }, manager))
      .rejects.toMatchObject({ statusCode: 400, message: 'Khoa khong thuoc benh vien nay' })
    expect(department.eq).toHaveBeenCalledWith('hospital_id', 'h1')
  })
  test('UT-AS-25 C8: Supabase Auth từ chối (email trùng) -> 400', async () => {
    queueFrom(supabaseAdmin.from, { data: { id: 'h1', is_active: true } })
    supabaseAdmin.auth.admin.createUser.mockResolvedValue({ data: null, error: { message: 'User already registered' } })
    await expect(AuthService.createUser(body, manager)).rejects.toMatchObject({ statusCode: 400 })
  })
  test('UT-AS-26 C9: ghi profile lỗi -> xoá tài khoản auth vừa tạo (rollback)', async () => {
    queueFrom(supabaseAdmin.from, { data: { id: 'h1', is_active: true } }, { error: { message: 'fk violation' } })
    supabaseAdmin.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'new' } }, error: null })
    await expect(AuthService.createUser(body, manager)).rejects.toMatchObject({ statusCode: 400 })
    expect(supabaseAdmin.auth.admin.deleteUser).toHaveBeenCalledWith('new')
  })
  test('UT-AS-27 C10: hospital tạo bác sĩ -> luôn thuộc bệnh viện của mình, chuyên môn được cắt 150 ký tự', async () => {
    const [, , upsert] = queueFrom(
      supabaseAdmin.from,
      { data: { id: 'h1', is_active: true } },
      { data: { id: 'd1' } },
      { error: null },
      { data: makeProfile({ id: 'new' }), error: null },
    )
    supabaseAdmin.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'new' } }, error: null })
    const result = await AuthService.createUser(
      { ...body, hospitalId: 'h-khac', departmentId: 'd1', specialty: `  ${'x'.repeat(200)}  ` },
      manager,
    )
    expect(supabaseAdmin.auth.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({
      app_metadata: { role: 'doctor', hospital_id: 'h1' },
    }))
    const row = upsert.upsert.mock.calls[0][0]
    expect(row).toMatchObject({ hospital_id: 'h1', department_id: 'd1', role: 'doctor', created_by: 'm1' })
    expect(row.specialty).toHaveLength(150)
    expect(result.profile.id).toBe('new')
  })
  test('UT-AS-28 C11: admin tạo tài khoản hospital -> bỏ qua khoa và chuyên môn', async () => {
    const [, upsert] = queueFrom(
      supabaseAdmin.from,
      { data: { id: 'h1', is_active: true } },
      { error: null },
      { data: makeProfile({ id: 'new', role: 'hospital' }), error: null },
    )
    supabaseAdmin.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'new' } }, error: null })
    await AuthService.createUser({ ...body, role: 'hospital', hospitalId: 'h1', departmentId: 'd1', specialty: 'MRI' }, admin)
    expect(upsert.upsert.mock.calls[0][0]).toMatchObject({ role: 'hospital', department_id: null, specialty: null })
  })
})

describe('AuthService.listUsers', () => {
  test('UT-AS-29: hospital chỉ thấy tài khoản bệnh viện mình dù truyền hospitalId khác', async () => {
    const [q] = queueFrom(supabaseAdmin.from, { data: [], error: null, count: 0 })
    await AuthService.listUsers(manager, { hospitalId: 'h-khac' })
    expect(q.eq).toHaveBeenCalledWith('hospital_id', 'h1')
    expect(q.eq).not.toHaveBeenCalledWith('hospital_id', 'h-khac')
  })
  test('UT-AS-30: admin lọc theo bệnh viện, role, khoa và tính range theo trang', async () => {
    const [q] = queueFrom(supabaseAdmin.from, { data: [makeProfile()], error: null, count: 41 })
    const result = await AuthService.listUsers(admin, { page: 3, perPage: 20, hospitalId: 'h1', role: 'doctor', departmentId: 'd1' })
    expect(q.range).toHaveBeenCalledWith(40, 59)
    expect(q.eq.mock.calls).toEqual([['hospital_id', 'h1'], ['role', 'doctor'], ['department_id', 'd1']])
    expect(result).toMatchObject({ total: 41, page: 3, perPage: 20 })
    expect(result.data[0].id).toBe('u1')
  })
  test('UT-AS-31: từ khoá chứa ký tự đặc biệt của PostgREST/ILIKE bị loại bỏ', async () => {
    const [q] = queueFrom(supabaseAdmin.from, { data: [], error: null, count: null })
    const result = await AuthService.listUsers(admin, { q: ' a%b,(c)_ ' })
    const pattern = '%a b  c%'
    expect(q.or).toHaveBeenCalledWith(
      ['full_name', 'email', 'employee_code', 'phone'].map((column) => `${column}.ilike.${pattern}`).join(','),
    )
    expect(result.total).toBe(0)
  })
  test('UT-AS-32: từ khoá chỉ gồm ký tự đặc biệt -> không lọc; lỗi DB -> 400', async () => {
    const [q] = queueFrom(supabaseAdmin.from, { data: null, error: { message: 'bad range' } })
    await expect(AuthService.listUsers(admin, { q: '%%__' })).rejects.toMatchObject({ statusCode: 400 })
    expect(q.or).not.toHaveBeenCalled()
  })
})

describe('AuthService: quản lý tài khoản (bảng quyết định G1-G6)', () => {
  const doctorH1 = makeProfile({ id: 'd1' })

  test.each([
    ['G1: hospital thao tác bác sĩ bệnh viện khác', manager, makeProfile({ id: 'd2', hospital_id: 'h2' }), {}],
    ['G2: hospital thao tác tài khoản hospital', manager, makeProfile({ id: 'm2', role: 'hospital' }), {}],
    ['G4: bác sĩ thao tác tài khoản khác', doctorH1, makeProfile({ id: 'd2' }), {}],
    ['G5: admin thao tác admin khi không cho phép', admin, makeProfile({ id: 'a2', role: 'admin' }), { allowAdminTarget: false }],
  ])('UT-AS-33 %s -> 403', async (_name, actor, target, options) => {
    queueFrom(supabaseAdmin.from, { data: target, error: null })
    await expect(AuthService.getManageableUser(actor, target.id, options)).rejects.toMatchObject({ statusCode: 403 })
  })
  test.each([
    ['G3: hospital thao tác bác sĩ bệnh viện mình', manager, doctorH1],
    ['G6: admin thao tác admin khác (mặc định cho phép)', admin, makeProfile({ id: 'a2', role: 'admin' })],
  ])('UT-AS-34 %s -> trả về tài khoản', async (_name, actor, target) => {
    queueFrom(supabaseAdmin.from, { data: target, error: null })
    await expect(AuthService.getManageableUser(actor, target.id)).resolves.toBe(target)
  })

  test.each([
    ['hospital', 'VIETDUC'],
    ['doctor', 'Vietduc@123'],
  ])('UT-AS-35: mật khẩu mặc định của role %s là %s', (role, expected) => {
    expect(AuthService.defaultPasswordFor(makeProfile({ role }))).toBe(expected)
  })
  test('UT-AS-36: tài khoản không thuộc bệnh viện -> không đặt lại được (400)', () => {
    expect(() => AuthService.defaultPasswordFor(makeProfile({ hospital: null }))).toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  test.each([
    ['resetUserPassword', (actor) => AuthService.resetUserPassword(actor, actor.id)],
    ['deleteUser', (actor) => AuthService.deleteUser(actor, actor.id)],
    ['toggleUserStatus', (actor) => AuthService.toggleUserStatus(actor, actor.id, false)],
  ])('UT-AS-37: %s trên chính mình -> 400', async (_name, action) => {
    await expect(action(admin)).rejects.toMatchObject({ statusCode: 400 })
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
  test('UT-AS-38: resetUserPassword bác sĩ -> đặt mật khẩu mặc định và trả về cho người quản lý', async () => {
    queueFrom(supabaseAdmin.from, { data: doctorH1, error: null })
    supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({ error: null })
    await expect(AuthService.resetUserPassword(manager, 'd1')).resolves.toEqual({ email: 'u1@test.local', password: 'Vietduc@123' })
    expect(supabaseAdmin.auth.admin.updateUserById).toHaveBeenCalledWith('d1', { password: 'Vietduc@123' })
  })
  test('UT-AS-39: resetUserPassword lỗi Supabase -> 400', async () => {
    queueFrom(supabaseAdmin.from, { data: doctorH1, error: null })
    supabaseAdmin.auth.admin.updateUserById.mockResolvedValue({ error: { message: 'x' } })
    await expect(AuthService.resetUserPassword(admin, 'd1')).rejects.toMatchObject({ statusCode: 400 })
  })
  test('UT-AS-40: deleteUser tài khoản admin khác -> 403, không xoá', async () => {
    queueFrom(supabaseAdmin.from, { data: makeProfile({ id: 'a2', role: 'admin' }), error: null })
    await expect(AuthService.deleteUser(admin, 'a2')).rejects.toMatchObject({ statusCode: 403 })
    expect(supabaseAdmin.auth.admin.deleteUser).not.toHaveBeenCalled()
  })
  test('UT-AS-41: deleteUser hợp lệ gọi xoá auth user; lỗi Supabase -> 400', async () => {
    queueFrom(supabaseAdmin.from, { data: doctorH1, error: null }, { data: doctorH1, error: null })
    supabaseAdmin.auth.admin.deleteUser.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'x' } })
    await AuthService.deleteUser(manager, 'd1')
    expect(supabaseAdmin.auth.admin.deleteUser).toHaveBeenCalledWith('d1')
    await expect(AuthService.deleteUser(manager, 'd1')).rejects.toMatchObject({ statusCode: 400 })
  })
  test('UT-AS-42: toggleUserStatus khoá bác sĩ -> is_active=false, status=inactive', async () => {
    const [, update] = queueFrom(
      supabaseAdmin.from,
      { data: doctorH1, error: null },
      { error: null },
      { data: makeProfile({ id: 'd1', is_active: false, status: 'inactive' }), error: null },
    )
    const result = await AuthService.toggleUserStatus(manager, 'd1', false)
    expect(update.update).toHaveBeenCalledWith({ is_active: false, status: 'inactive' })
    expect(result).toMatchObject({ isActive: false, status: 'inactive' })
  })
  test('UT-AS-43: toggleUserStatus lỗi DB -> 400', async () => {
    queueFrom(supabaseAdmin.from, { data: doctorH1, error: null }, { error: { message: 'x' } })
    await expect(AuthService.toggleUserStatus(admin, 'd1', true)).rejects.toMatchObject({ statusCode: 400 })
  })
})
