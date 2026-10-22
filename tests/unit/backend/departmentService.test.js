// services/departmentService.js - giá trị biên (BVA) cho tên khoa, phân vùng tương đương (EP) theo vai trò.
jest.mock('@sut/src/config/supabase', () => ({
  supabase: { auth: {} },
  supabaseAdmin: { from: jest.fn() },
}))

const { supabaseAdmin } = require('@sut/src/config/supabase')
const { DepartmentService } = require('@sut/src/services/departmentService')
const { queueFrom } = require('../../support/backend/supabaseMock')

const admin = { id: 'a1', role: 'admin', hospital_id: null }
const manager = { id: 'm1', role: 'hospital', hospital_id: 'h1' }
const doctor = { id: 'd1', role: 'doctor', hospital_id: 'h1' }
const departmentRow = (overrides = {}) => ({ id: 'k1', hospital_id: 'h1', name: 'Chẩn đoán hình ảnh', doctors: [{ count: 2 }], ...overrides })

beforeEach(() => jest.resetAllMocks())

describe('DepartmentService.resolveHospitalId (EP theo vai trò)', () => {
  test('UT-DS-01: admin không chọn bệnh viện -> 400', () => {
    expect(() => DepartmentService.resolveHospitalId(admin, undefined)).toThrow(expect.objectContaining({ statusCode: 400 }))
  })
  test('UT-DS-02: admin chọn bệnh viện -> dùng bệnh viện được chọn', () => {
    expect(DepartmentService.resolveHospitalId(admin, 'h9')).toBe('h9')
  })
  test.each([[manager], [doctor]])('UT-DS-03: vai trò %o luôn dùng bệnh viện của mình, bỏ qua tham số', (actor) => {
    expect(DepartmentService.resolveHospitalId(actor, 'h9')).toBe('h1')
  })
})

describe('DepartmentService.listDepartments', () => {
  test('UT-DS-04: lọc theo bệnh viện, sắp theo tên, đếm bác sĩ', async () => {
    const [q] = queueFrom(supabaseAdmin.from, { data: [departmentRow()], error: null })
    await expect(DepartmentService.listDepartments(doctor, 'h9')).resolves.toEqual([
      expect.objectContaining({ id: 'k1', hospitalId: 'h1', doctorCount: 2 }),
    ])
    expect(q.eq).toHaveBeenCalledWith('hospital_id', 'h1')
    expect(q.order).toHaveBeenCalledWith('name')
  })
  test('UT-DS-05: lỗi DB -> 400', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: { message: 'x' } })
    await expect(DepartmentService.listDepartments(admin, 'h1')).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('DepartmentService.createDepartment (BVA tên khoa, tối đa 150 ký tự)', () => {
  test.each([
    ['chuỗi rỗng', ''],
    ['chỉ khoảng trắng', '   \t '],
    ['không truyền', undefined],
  ])('UT-DS-06: tên %s -> 400 "Ten khoa la bat buoc", không ghi DB', async (_name, name) => {
    const [q] = queueFrom(supabaseAdmin.from, {})
    await expect(DepartmentService.createDepartment(manager, { name }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Ten khoa la bat buoc' })
    expect(q.insert).not.toHaveBeenCalled()
  })
  test.each([
    ['1 ký tự', 'A', 'A'],
    ['150 ký tự (biên trên)', 'K'.repeat(150), 'K'.repeat(150)],
    ['151 ký tự nhưng gộp khoảng trắng còn 150', `${'K'.repeat(75)}  ${'K'.repeat(74)}`, `${'K'.repeat(75)} ${'K'.repeat(74)}`],
    ['khoảng trắng thừa ở giữa và hai đầu', '  Chẩn   đoán\thình  ảnh ', 'Chẩn đoán hình ảnh'],
  ])('UT-DS-07: tên %s -> hợp lệ, được chuẩn hoá', async (_name, name, expected) => {
    const [q] = queueFrom(supabaseAdmin.from, { data: departmentRow({ name: expected }), error: null })
    await DepartmentService.createDepartment(manager, { name })
    expect(q.insert).toHaveBeenCalledWith({ hospital_id: 'h1', name: expected, created_by: 'm1' })
  })
  test('UT-DS-08: 151 ký tự (trên biên) -> 400', async () => {
    const [q] = queueFrom(supabaseAdmin.from, {})
    await expect(DepartmentService.createDepartment(manager, { name: 'K'.repeat(151) }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Ten khoa toi da 150 ky tu' })
    expect(q.insert).not.toHaveBeenCalled()
  })
  test('UT-DS-09: admin tạo khoa cho bệnh viện chỉ định', async () => {
    const [q] = queueFrom(supabaseAdmin.from, { data: departmentRow({ hospital_id: 'h9' }), error: null })
    await expect(DepartmentService.createDepartment(admin, { hospitalId: 'h9', name: 'Nội' }))
      .resolves.toMatchObject({ hospitalId: 'h9' })
    expect(q.insert).toHaveBeenCalledWith(expect.objectContaining({ hospital_id: 'h9', created_by: 'a1' }))
  })
  test('UT-DS-10: tên trùng trong bệnh viện (23505) -> 400 thông báo riêng; lỗi khác -> 400 thông báo gốc', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: { code: '23505', message: 'dup' } }, { data: null, error: { code: '42501', message: 'denied' } })
    await expect(DepartmentService.createDepartment(manager, { name: 'Nội' }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Ten khoa da ton tai trong benh vien' })
    await expect(DepartmentService.createDepartment(manager, { name: 'Nội' }))
      .rejects.toMatchObject({ statusCode: 400, message: 'denied' })
  })
})

describe('DepartmentService.getOwnedDepartment / rename / delete', () => {
  test('UT-DS-11: khoa không tồn tại -> 404', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: null })
    await expect(DepartmentService.getOwnedDepartment(admin, 'kx')).rejects.toMatchObject({ statusCode: 404 })
  })
  test('UT-DS-12: hospital/doctor thao tác khoa của bệnh viện khác -> 404 (không lộ sự tồn tại)', async () => {
    queueFrom(supabaseAdmin.from, { data: { id: 'k2', hospital_id: 'h2' }, error: null })
    await expect(DepartmentService.getOwnedDepartment(manager, 'k2')).rejects.toMatchObject({ statusCode: 404 })
  })
  test('UT-DS-13: admin thao tác khoa của bất kỳ bệnh viện nào', async () => {
    queueFrom(supabaseAdmin.from, { data: { id: 'k2', hospital_id: 'h2' }, error: null })
    await expect(DepartmentService.getOwnedDepartment(admin, 'k2')).resolves.toEqual({ id: 'k2', hospital_id: 'h2' })
  })
  test('UT-DS-14: lỗi DB khi đọc khoa -> 400', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: { message: 'x' } })
    await expect(DepartmentService.getOwnedDepartment(admin, 'k1')).rejects.toMatchObject({ statusCode: 400 })
  })
  test('UT-DS-15: đổi tên khoa -> ghi tên đã chuẩn hoá', async () => {
    const [, update] = queueFrom(
      supabaseAdmin.from,
      { data: { id: 'k1', hospital_id: 'h1' }, error: null },
      { data: departmentRow({ name: 'Ngoại' }), error: null },
    )
    await expect(DepartmentService.renameDepartment(manager, 'k1', '  Ngoại ')).resolves.toMatchObject({ name: 'Ngoại' })
    expect(update.update).toHaveBeenCalledWith({ name: 'Ngoại' })
    expect(update.eq).toHaveBeenCalledWith('id', 'k1')
  })
  test('UT-DS-16: đổi sang tên đã có (23505) -> 400', async () => {
    queueFrom(supabaseAdmin.from, { data: { id: 'k1', hospital_id: 'h1' }, error: null }, { data: null, error: { code: '23505' } })
    await expect(DepartmentService.renameDepartment(manager, 'k1', 'Nội'))
      .rejects.toMatchObject({ message: 'Ten khoa da ton tai trong benh vien' })
  })
  test('UT-DS-17: xoá khoa của mình thành công; lỗi DB -> 400', async () => {
    const [, del] = queueFrom(
      supabaseAdmin.from,
      { data: { id: 'k1', hospital_id: 'h1' }, error: null },
      { error: null },
      { data: { id: 'k1', hospital_id: 'h1' }, error: null },
      { error: { message: 'x' } },
    )
    await expect(DepartmentService.deleteDepartment(manager, 'k1')).resolves.toBeUndefined()
    expect(del.delete).toHaveBeenCalled()
    await expect(DepartmentService.deleteDepartment(manager, 'k1')).rejects.toMatchObject({ statusCode: 400 })
  })
  test('UT-DS-18: xoá khoa bệnh viện khác -> 404, không gọi delete', async () => {
    queueFrom(supabaseAdmin.from, { data: { id: 'k2', hospital_id: 'h2' }, error: null })
    await expect(DepartmentService.deleteDepartment(doctor, 'k2')).rejects.toMatchObject({ statusCode: 404 })
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })
})
