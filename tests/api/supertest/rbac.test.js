// Ma trận phân quyền (bảng quyết định vai trò x endpoint quản trị): kiểm tra requireAuth/requireRole được gắn đúng
// ở từng route. Ô "cho phép" dùng service giả (spy) để tách lớp phân quyền khỏi logic nghiệp vụ; phần cuối file
// chạy một số luồng qua service thật với Supabase giả lập.
jest.mock('@sut/src/config/supabase', () => ({
  supabase: { auth: {} },
  supabaseAdmin: {
    from: jest.fn(),
    auth: { getUser: jest.fn(), admin: { createUser: jest.fn(), deleteUser: jest.fn(), updateUserById: jest.fn() } },
  },
}))

const request = require('supertest')
const { app } = require('@sut/src/app')
const { supabaseAdmin } = require('@sut/src/config/supabase')
const { AuthService } = require('@sut/src/services/authService')
const { HospitalService } = require('@sut/src/services/hospitalService')
const { DepartmentService } = require('@sut/src/services/departmentService')
const { DicomService } = require('@sut/src/services/dicomService')
const { StudyService } = require('@sut/src/services/studyService')
const { createHttpError } = require('@sut/src/utils/httpError')
const { query, queueFrom } = require('../../support/backend/supabaseMock')
const { installAuth, bearer } = require('../mocks/authContext')

const API = '/api/v1'

beforeEach(() => {
  jest.resetAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  installAuth({ supabaseAdmin, AuthService, createHttpError })
  supabaseAdmin.from.mockImplementation(() => query({ data: null, error: null }))
})
afterEach(() => jest.restoreAllMocks())

function stubServices() {
  jest.spyOn(HospitalService, 'listHospitals').mockResolvedValue({ data: [], total: 0, page: 1, perPage: 20 })
  jest.spyOn(HospitalService, 'createHospital').mockResolvedValue({ id: 'h9' })
  jest.spyOn(HospitalService, 'getHospital').mockImplementation(async (id) => ({ id }))
  jest.spyOn(HospitalService, 'setHospitalActive').mockResolvedValue({ id: 'h1', isActive: false })
  jest.spyOn(HospitalService, 'resetManagerPassword').mockResolvedValue({ password: 'BVTEST01', emails: [] })
  jest.spyOn(HospitalService, 'deleteHospital').mockResolvedValue({ deletedAccounts: 0, deletedStudies: 0 })
  jest.spyOn(AuthService, 'listUsers').mockResolvedValue({ data: [], total: 0, page: 1, perPage: 20 })
  jest.spyOn(AuthService, 'createUser').mockResolvedValue({ profile: { id: 'new-id' } })
  jest.spyOn(DepartmentService, 'listDepartments').mockResolvedValue([])
  jest.spyOn(DepartmentService, 'createDepartment').mockResolvedValue({ id: 'd9' })
  jest.spyOn(DepartmentService, 'renameDepartment').mockResolvedValue({ id: 'd1' })
  jest.spyOn(DepartmentService, 'deleteDepartment').mockResolvedValue(undefined)
}

const newUser = { email: 'bs@test.local', password: '12345678', fullName: 'BS' }
// [mã, phương thức, đường dẫn, body, { anonymous, doctor, hospital, admin }]
const MATRIX = [
  ['IT-RBAC-01', 'get', '/hospitals', undefined, { anonymous: 401, doctor: 403, hospital: 403, admin: 200 }],
  ['IT-RBAC-02', 'post', '/hospitals', { code: 'BVMOI01', name: 'BV mới' }, { anonymous: 401, doctor: 403, hospital: 403, admin: 201 }],
  ['IT-RBAC-03', 'patch', '/hospitals/h1/status', { isActive: false }, { anonymous: 401, doctor: 403, hospital: 403, admin: 200 }],
  ['IT-RBAC-04', 'post', '/hospitals/h1/reset-password', undefined, { anonymous: 401, doctor: 403, hospital: 403, admin: 200 }],
  ['IT-RBAC-05', 'delete', '/hospitals/h1', undefined, { anonymous: 401, doctor: 403, hospital: 403, admin: 200 }],
  ['IT-RBAC-06', 'get', '/hospitals/h1', undefined, { anonymous: 401, doctor: 200, hospital: 200, admin: 200 }],
  ['IT-RBAC-07', 'get', '/hospitals/h2', undefined, { anonymous: 401, doctor: 403, hospital: 403, admin: 200 }],
  ['IT-RBAC-08', 'get', '/auth/users', undefined, { anonymous: 401, doctor: 403, hospital: 200, admin: 200 }],
  ['IT-RBAC-09', 'post', '/auth/users', newUser, { anonymous: 401, doctor: 403, hospital: 201, admin: 201 }],
  ['IT-RBAC-10', 'get', '/departments?hospitalId=h1', undefined, { anonymous: 401, doctor: 200, hospital: 200, admin: 200 }],
  ['IT-RBAC-11', 'post', '/departments', { name: 'Khoa mới', hospitalId: 'h1' }, { anonymous: 401, doctor: 403, hospital: 201, admin: 201 }],
  ['IT-RBAC-12', 'patch', '/departments/d1', { name: 'Đổi tên' }, { anonymous: 401, doctor: 403, hospital: 200, admin: 200 }],
  ['IT-RBAC-13', 'delete', '/departments/d1', undefined, { anonymous: 401, doctor: 403, hospital: 204, admin: 204 }],
]
const CASES = MATRIX.flatMap(([id, method, path, body, expected]) =>
  Object.entries(expected).map(([role, status]) => [id, method.toUpperCase(), path, role, status, body]))

describe('Ma trận phân quyền (FR-11, FR-12, FR-13)', () => {
  test.each(CASES)('%s: %s %s với vai trò %s -> %i', async (_id, method, path, role, status, body) => {
    stubServices()
    let req = request(app)[method.toLowerCase()](`${API}${path}`)
    if (role !== 'anonymous') req = req.set(bearer(role))
    const res = await (body ? req.send(body) : req)
    expect(res.status).toBe(status)
  })

  test('IT-RBAC-14: tài khoản bị khoá có token hợp lệ vẫn bị chặn ở mọi route quản trị -> 403', async () => {
    stubServices()
    const res = await request(app).get(`${API}/departments?hospitalId=h1`).set(bearer('locked'))
    expect(res.status).toBe(403)
    expect(DepartmentService.listDepartments).not.toHaveBeenCalled()
  })
})

describe('Luồng qua service thật (Supabase giả lập)', () => {
  test.each([
    ['5 ký tự (dưới biên)', 'ABCDE', 400],
    ['6 ký tự (biên dưới)', 'ABCDEF', 201],
    ['30 ký tự (biên trên)', 'A'.repeat(30), 201],
    ['31 ký tự (trên biên)', 'A'.repeat(31), 400],
    ['có ký tự đặc biệt', 'BV TEST!', 400],
  ])('IT-RBAC-15: admin tạo bệnh viện mã %s -> %i', async (_name, code, status) => {
    queueFrom(supabaseAdmin.from, { data: { id: 'h9', code, name: 'BV' }, error: null })
    jest.spyOn(AuthService, 'createUser').mockResolvedValue({ profile: { id: 'manager' } })
    const res = await request(app).post(`${API}/hospitals`).set(bearer('admin')).send({ code, name: 'BV' })
    expect(res.status).toBe(status)
    if (status === 201) {
      expect(res.body.data.managerAccount).toEqual({ email: `${code.toLowerCase()}@spineinsight.vn`, password: code })
    }
  })

  test('IT-RBAC-16: hospital xoá khoa của bệnh viện khác -> 404, không xoá', async () => {
    const [lookup] = queueFrom(supabaseAdmin.from, { data: { id: 'd9', hospital_id: 'h2' }, error: null })
    const res = await request(app).delete(`${API}/departments/d9`).set(bearer('hospital'))
    expect(res.status).toBe(404)
    expect(lookup.eq).toHaveBeenCalledWith('id', 'd9')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  test('IT-RBAC-17: admin xem danh sách khoa mà không chọn bệnh viện -> 400', async () => {
    const res = await request(app).get(`${API}/departments`).set(bearer('admin'))
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Phai chon benh vien')
  })

  test('IT-RBAC-18: hospital xem tài khoản với ?hospitalId=h2 vẫn chỉ lọc theo h1', async () => {
    const [list] = queueFrom(supabaseAdmin.from, { data: [], error: null, count: 0 })
    const res = await request(app).get(`${API}/auth/users?hospitalId=h2`).set(bearer('hospital'))
    expect(res.status).toBe(200)
    expect(list.eq).toHaveBeenCalledWith('hospital_id', 'h1')
    expect(list.eq).not.toHaveBeenCalledWith('hospital_id', 'h2')
  })

  test.each([
    ['GET', '/hospitals', 'admin', 400, [HospitalService, 'listHospitals'], createHttpError('bad range', 400)],
    ['GET', '/hospitals/h9', 'admin', 404, [HospitalService, 'getHospital'], createHttpError('Khong tim thay benh vien', 404)],
    ['POST', '/hospitals', 'admin', 400, [HospitalService, 'createHospital'], createHttpError('Ma benh vien da ton tai', 400)],
    ['PATCH', '/hospitals/h9/status', 'admin', 404, [HospitalService, 'setHospitalActive'], createHttpError('Khong tim thay benh vien', 404)],
    ['POST', '/hospitals/h9/reset-password', 'admin', 404, [HospitalService, 'resetManagerPassword'], createHttpError('Benh vien chua co tai khoan quan ly', 404)],
    ['DELETE', '/hospitals/h9', 'admin', 400, [HospitalService, 'deleteHospital'], createHttpError('Khong xoa duoc', 400)],
    ['POST', '/departments', 'hospital', 400, [DepartmentService, 'createDepartment'], createHttpError('Ten khoa da ton tai trong benh vien', 400)],
    ['PATCH', '/departments/d9', 'hospital', 404, [DepartmentService, 'renameDepartment'], createHttpError('Khong tim thay khoa', 404)],
    ['GET', '/auth/users', 'admin', 400, [AuthService, 'listUsers'], createHttpError('bad range', 400)],
    ['POST', '/auth/users', 'admin', 400, [AuthService, 'createUser'], createHttpError('User already registered', 400)],
    ['GET', '/auth/me', 'doctor', 404, [AuthService, 'getFullProfile'], createHttpError('Khong tim thay profile', 404)],
    ['POST', '/auth/users/x/reset-password', 'hospital', 403, [AuthService, 'resetUserPassword'], createHttpError('Ban chi quan ly duoc bac si thuoc benh vien cua minh', 403)],
    ['GET', '/dicom/folders', 'doctor', 404, [DicomService, 'listFolders'], Object.assign(new Error('x'), { code: 'ENOENT' })],
    ['GET', '/dicom/folders/P1/S1/files', 'doctor', 500, [DicomService, 'listFiles'], new Error('boom')],
    ['GET', '/dicom/folders/P1/S1/files/a.dcm', 'doctor', 403, [DicomService, 'getFileStream'], Object.assign(new Error('x'), { code: 'FORBIDDEN' })],
    ['GET', '/studies/s1', 'doctor', 500, [StudyService, 'getFullStudy'], new Error('db down')],
    ['GET', '/studies/s1/rsna', 'doctor', 500, [StudyService, 'getLatestRsnaResult'], new Error('db down')],
    ['GET', '/studies/s1/p2vg', 'doctor', 500, [StudyService, 'getLatestP2vgReport'], new Error('db down')],
  ])('IT-RBAC-20: %s %s (%s), service ném lỗi -> %i', async (method, path, role, status, [service, name], error) => {
    jest.spyOn(service, name).mockRejectedValue(error)
    const req = request(app)[method.toLowerCase()](`${API}${path}`).set(bearer(role))
    const res = await (method === 'POST' || method === 'PATCH' ? req.send({ code: 'BVMOI01', name: 'X', isActive: true, ...newUser }) : req)
    expect(res.status).toBe(status)
    expect(res.body).toHaveProperty('error')
  })

  test.each([
    ['POST', '/hospitals', { code: 'BVMOI01' }, 'thiếu tên bệnh viện'],
    ['POST', '/hospitals', { name: 'BV mới' }, 'thiếu mã bệnh viện'],
    ['PATCH', '/hospitals/h1/status', { isActive: 'true' }, 'isActive là chuỗi'],
  ])('IT-RBAC-21: admin %s %s với %j (%s) -> 400, không gọi service', async (method, path, body) => {
    stubServices()
    const res = await request(app)[method.toLowerCase()](`${API}${path}`).set(bearer('admin')).send(body)
    expect(res.status).toBe(400)
    expect(HospitalService.createHospital).not.toHaveBeenCalled()
    expect(HospitalService.setHospitalActive).not.toHaveBeenCalled()
  })

  test('IT-RBAC-19: hospital tạo khoa -> luôn gắn bệnh viện của mình dù gửi hospitalId khác', async () => {
    const [insert] = queueFrom(supabaseAdmin.from, { data: { id: 'd9', hospital_id: 'h1', name: 'Khoa Nội' }, error: null })
    const res = await request(app).post(`${API}/departments`).set(bearer('hospital')).send({ name: '  Khoa   Nội ', hospitalId: 'h2' })
    expect(res.status).toBe(201)
    expect(insert.insert).toHaveBeenCalledWith({ hospital_id: 'h1', name: 'Khoa Nội', created_by: 'hospital-id' })
  })
})
