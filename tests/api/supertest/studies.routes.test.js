// Nhóm /api/v1/studies (FR-09): phân vùng tương đương "có dữ liệu / không có / lỗi DB" qua StudyService thật,
// Supabase giả lập theo tên bảng. Các ca bảo mật ghi nhận BUG-01 (thiếu requireAuth) và BUG-07 (editedBy do client khai).
jest.mock('@sut/src/config/supabase', () => ({
  supabase: { auth: {} },
  supabaseAdmin: { from: jest.fn(), auth: { getUser: jest.fn() } },
}))

const request = require('supertest')
const { app } = require('@sut/src/app')
const { supabaseAdmin } = require('@sut/src/config/supabase')
const { AuthService } = require('@sut/src/services/authService')
const { createHttpError } = require('@sut/src/utils/httpError')
const { query } = require('../../support/backend/supabaseMock')
const { installAuth, bearer } = require('../mocks/authContext')

const API = '/api/v1/studies'
const studyRow = { id: 's1', patient_id: 'P1', file_count: 3, created_at: 't0' }
const rsnaRow = { id: 'r1', study_id: 's1', severity: [], coordinates: [], processing_time_ms: 900 }
const reportRow = { id: 'p1', study_id: 's1', rsna_result_id: 'r1', report: 'FINDINGS', edited_report: null }

let tables
function useTables(results) {
  tables = Object.fromEntries(Object.entries(results).map(([table, result]) => [table, query(result)]))
  supabaseAdmin.from.mockImplementation((table) => tables[table] || query({ data: null, error: null }))
}

beforeEach(() => {
  jest.resetAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'log').mockImplementation(() => {})
  installAuth({ supabaseAdmin, AuthService, createHttpError })
})
afterEach(() => jest.restoreAllMocks())

describe('Đọc study và kết quả', () => {
  test('IT-STUDY-01: danh sách study -> 200 camelCase, total và range theo trang 2', async () => {
    useTables({ studies: { data: [studyRow], error: null, count: 21 } })
    const res = await request(app).get(`${API}?page=2&perPage=20`).set(bearer('doctor'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: [expect.objectContaining({ id: 's1', patientId: 'P1', fileCount: 3 })], total: 21, page: 2, perPage: 20 })
    expect(tables.studies.range).toHaveBeenCalledWith(20, 39)
  })
  test('IT-STUDY-02: lỗi DB khi lấy danh sách -> 500 với thông báo chung', async () => {
    useTables({ studies: { data: null, error: { message: 'relation "studies" does not exist' } } })
    const res = await request(app).get(API).set(bearer('doctor'))
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Lỗi khi lấy danh sách studies' })
  })
  test('IT-STUDY-03: study không tồn tại -> 404', async () => {
    useTables({ studies: { data: null, error: null } })
    const res = await request(app).get(`${API}/khong-co`).set(bearer('doctor'))
    expect(res.status).toBe(404)
  })
  test('IT-STUDY-04: study có kết quả -> 200 gồm study, rsna, p2vg mới nhất', async () => {
    useTables({
      studies: { data: studyRow, error: null },
      rsna_results: { data: rsnaRow, error: null },
      p2vg_reports: { data: reportRow, error: null },
    })
    const res = await request(app).get(`${API}/s1`).set(bearer('doctor'))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      study: { id: 's1', patientId: 'P1' },
      rsna: { id: 'r1', studyId: 's1', processingTimeMs: 900 },
      p2vg: { id: 'p1', rsnaResultId: 'r1', report: 'FINDINGS' },
    })
  })
  test.each([
    ['rsna', 'rsna_results', rsnaRow, { id: 'r1', studyId: 's1' }],
    ['p2vg', 'p2vg_reports', reportRow, { id: 'p1', report: 'FINDINGS' }],
  ])('IT-STUDY-05: GET /:id/%s chưa có -> 404, có -> 200', async (path, table, row, expected) => {
    useTables({ [table]: { data: null, error: null } })
    expect((await request(app).get(`${API}/s1/${path}`).set(bearer('doctor'))).status).toBe(404)
    useTables({ [table]: { data: row, error: null } })
    const res = await request(app).get(`${API}/s1/${path}`).set(bearer('doctor'))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject(expected)
  })
})

describe('PUT /studies/:id/report (FR-09)', () => {
  test.each([
    ['thiếu reportId', { editedReport: 'Nội dung' }],
    ['thiếu editedReport', { reportId: 'p1' }],
    ['editedReport rỗng', { reportId: 'p1', editedReport: '' }],
  ])('IT-STUDY-06: %s -> 400', async (_name, body) => {
    useTables({})
    const res = await request(app).put(`${API}/s1/report`).set(bearer('doctor')).send(body)
    expect(res.status).toBe(400)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
  test('IT-STUDY-07: lưu báo cáo đã sửa -> 200; không gửi editedBy thì ghi "anonymous"', async () => {
    useTables({ p2vg_reports: { data: { ...reportRow, edited_report: 'Đã sửa', edited_by: 'anonymous' }, error: null } })
    const res = await request(app).put(`${API}/s1/report`).set(bearer('doctor')).send({ reportId: 'p1', editedReport: 'Đã sửa' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: 'p1', editedReport: 'Đã sửa' })
    expect(tables.p2vg_reports.update).toHaveBeenCalledWith({ edited_report: 'Đã sửa', edited_by: 'anonymous', edited_at: expect.any(String) })
    expect(tables.p2vg_reports.eq).toHaveBeenCalledWith('id', 'p1')
  })
  test('IT-STUDY-08: lỗi DB khi lưu -> 500', async () => {
    useTables({ p2vg_reports: { data: null, error: { message: 'no rows' } } })
    const res = await request(app).put(`${API}/s1/report`).set(bearer('doctor')).send({ reportId: 'p1', editedReport: 'x' })
    expect(res.status).toBe(500)
  })
  // BUG-07: người sửa báo cáo lấy từ body nên giả mạo được; phải lấy từ tài khoản đang đăng nhập.
  test.failing('IT-STUDY-09 (BUG-07): edited_by phải là id bác sĩ đang đăng nhập, không phải giá trị client gửi', async () => {
    useTables({ p2vg_reports: { data: reportRow, error: null } })
    await request(app).put(`${API}/s1/report`).set(bearer('doctor')).send({ reportId: 'p1', editedReport: 'x', editedBy: 'bs-khac' })
    expect(tables.p2vg_reports.update).toHaveBeenCalledWith(expect.objectContaining({ edited_by: 'doctor-id' }))
  })
})

describe('Bảo mật: truy cập khi chưa đăng nhập (BUG-01)', () => {
  test('IT-STUDY-10: quan sát thực tế -> ẩn danh đọc được study và sửa được báo cáo (200)', async () => {
    useTables({
      studies: { data: studyRow, error: null },
      p2vg_reports: { data: reportRow, error: null },
    })
    expect((await request(app).get(`${API}/s1`)).status).toBe(200)
    expect((await request(app).put(`${API}/s1/report`).send({ reportId: 'p1', editedReport: 'sửa trộm' })).status).toBe(200)
  })
  test.failing.each([
    ['GET', '/s1'],
    ['GET', '/s1/rsna'],
    ['PUT', '/s1/report'],
  ])('IT-STUDY-11 (BUG-01): %s %s không có token -> 401', async (method, path) => {
    useTables({
      studies: { data: studyRow, error: null },
      rsna_results: { data: rsnaRow, error: null },
      p2vg_reports: { data: reportRow, error: null },
    })
    const req = request(app)[method.toLowerCase()](`${API}${path}`)
    const res = await (method === 'PUT' ? req.send({ reportId: 'p1', editedReport: 'x' }) : req)
    expect(res.status).toBe(401)
  })
})
