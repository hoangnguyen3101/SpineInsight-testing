// services/studyService.js - phân vùng tương đương (EP): có dữ liệu / không có / lỗi DB; BVA cho phân trang.
jest.mock('@sut/src/config/supabase', () => ({
  supabase: { auth: {} },
  supabaseAdmin: { from: jest.fn() },
}))

const { supabaseAdmin } = require('@sut/src/config/supabase')
const { StudyService } = require('@sut/src/services/studyService')
const { queueFrom } = require('../../support/backend/supabaseMock')

const studyRow = (overrides = {}) => ({ id: 's1', patient_id: 'P001', file_count: 12, created_at: 't0', ...overrides })

beforeEach(() => {
  jest.resetAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('StudyService: ca chụp', () => {
  test('UT-SS-01: createStudy chỉ có patientId -> các trường còn lại mặc định null/0', async () => {
    const [q] = queueFrom(supabaseAdmin.from, { data: studyRow({ file_count: 0 }), error: null })
    await expect(StudyService.createStudy({ patientId: 'P001' })).resolves.toMatchObject({ id: 's1', patientId: 'P001', fileCount: 0 })
    expect(q.insert).toHaveBeenCalledWith({
      patient_id: 'P001', patient_name: null, dicom_path: null, file_count: 0, uploaded_by: null, description: null,
    })
  })
  test('UT-SS-02: createStudy lỗi DB -> ném Error kèm thông báo', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: { message: 'null value' } })
    await expect(StudyService.createStudy({ patientId: 'P001' })).rejects.toThrow('Không thể tạo study: null value')
  })
  test.each([
    ['tìm thấy', { data: studyRow(), error: null }, expect.objectContaining({ id: 's1' })],
    ['không có', { data: null, error: null }, null],
    ['lỗi DB', { data: null, error: { message: 'x' } }, null],
  ])('UT-SS-03: findByPatientId khi %s', async (_name, result, expected) => {
    queueFrom(supabaseAdmin.from, result)
    await expect(StudyService.findByPatientId('P001')).resolves.toEqual(expected)
  })
  test('UT-SS-04: getById lỗi DB -> null (không ném)', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: { message: 'x' } })
    await expect(StudyService.getById('s1')).resolves.toBeNull()
  })
  test('UT-SS-05: getFullStudy không có study -> null, không truy vấn kết quả AI', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: null })
    await expect(StudyService.getFullStudy('sx')).resolves.toBeNull()
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })
  test('UT-SS-06: getFullStudy gộp study, RSNA và P2VG mới nhất', async () => {
    queueFrom(
      supabaseAdmin.from,
      { data: studyRow(), error: null },
      { data: { id: 'r1', study_id: 's1' }, error: null },
      { data: null, error: null },
    )
    await expect(StudyService.getFullStudy('s1')).resolves.toEqual({
      study: expect.objectContaining({ id: 's1' }),
      rsna: expect.objectContaining({ id: 'r1', studyId: 's1' }),
      p2vg: null,
    })
  })
  test.each([
    [1, 20, 0, 19],
    [3, 10, 20, 29],
    [undefined, undefined, 0, 19],
  ])('UT-SS-07: listStudies(page=%p, perPage=%p) -> range(%i, %i)', async (page, perPage, from, to) => {
    const [q] = queueFrom(supabaseAdmin.from, { data: [studyRow()], error: null, count: null })
    const result = await StudyService.listStudies(page, perPage)
    expect(q.range).toHaveBeenCalledWith(from, to)
    expect(result).toMatchObject({ total: 0, data: [expect.objectContaining({ patientId: 'P001' })] })
  })
  test('UT-SS-08: listStudies lỗi DB -> ném Error', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: { message: 'relation "studies" does not exist' } })
    await expect(StudyService.listStudies()).rejects.toThrow('relation "studies" does not exist')
  })
  test('UT-SS-09: findOrCreateStudy đã có study -> dùng lại, không tạo mới', async () => {
    queueFrom(supabaseAdmin.from, { data: studyRow(), error: null })
    await expect(StudyService.findOrCreateStudy({ patientId: 'P001', fileCount: 3 })).resolves.toMatchObject({ id: 's1' })
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })
  test('UT-SS-10: findOrCreateStudy chưa có -> tạo study mới với fileCount', async () => {
    const [, insert] = queueFrom(supabaseAdmin.from, { data: null, error: null }, { data: studyRow({ id: 's2', file_count: 3 }), error: null })
    await expect(StudyService.findOrCreateStudy({ patientId: 'P002', fileCount: 3 })).resolves.toMatchObject({ id: 's2' })
    expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({ patient_id: 'P002', file_count: 3 }))
  })
})

describe('StudyService: kết quả RSNA và báo cáo P2VG', () => {
  test('UT-SS-11: saveRsnaResult thiếu trường -> mặc định [] / null', async () => {
    const [q] = queueFrom(supabaseAdmin.from, { data: { id: 'r1', study_id: 's1' }, error: null })
    await expect(StudyService.saveRsnaResult({ studyId: 's1' })).resolves.toMatchObject({ id: 'r1' })
    expect(q.insert).toHaveBeenCalledWith({
      study_id: 's1', severity: [], coordinates: [], series_mapping: null, processing_time_ms: null, raw_response: null,
    })
  })
  test('UT-SS-12: saveRsnaResult lỗi DB -> ném Error', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: { message: 'fk' } })
    await expect(StudyService.saveRsnaResult({ studyId: 'sx' })).rejects.toThrow('Không thể lưu RSNA result: fk')
  })
  test('UT-SS-13: getLatestRsnaResult lấy bản mới nhất; lỗi DB -> null', async () => {
    const [q] = queueFrom(supabaseAdmin.from, { data: { id: 'r2' }, error: null }, { data: null, error: { message: 'x' } })
    await expect(StudyService.getLatestRsnaResult('s1')).resolves.toMatchObject({ id: 'r2' })
    expect(q.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(q.limit).toHaveBeenCalledWith(1)
    await expect(StudyService.getLatestRsnaResult('s1')).resolves.toBeNull()
  })
  test('UT-SS-14: saveP2vgReport thiếu trường -> mặc định; lỗi DB -> ném Error', async () => {
    const [q] = queueFrom(supabaseAdmin.from, { data: { id: 'p1', report: 'R' }, error: null }, { data: null, error: { message: 'x' } })
    await expect(StudyService.saveP2vgReport({ studyId: 's1', report: 'R' })).resolves.toMatchObject({ id: 'p1', report: 'R' })
    expect(q.insert).toHaveBeenCalledWith({
      study_id: 's1', rsna_result_id: null, report: 'R', prompt_used: null, rsna_findings: [], series_detected: null, processing_time_ms: null,
    })
    await expect(StudyService.saveP2vgReport({ studyId: 's1', report: 'R' })).rejects.toThrow('Không thể lưu P2VG report: x')
  })
  test('UT-SS-15: getLatestP2vgReport lỗi DB -> null', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: { message: 'x' } })
    await expect(StudyService.getLatestP2vgReport('s1')).resolves.toBeNull()
  })
  test('UT-SS-16: updateReport ghi nội dung sửa, người sửa và thời điểm sửa', async () => {
    const [q] = queueFrom(supabaseAdmin.from, { data: { id: 'p1', edited_report: 'Mới', edited_by: 'u1' }, error: null })
    await expect(StudyService.updateReport('p1', 'Mới', 'u1')).resolves.toMatchObject({ editedReport: 'Mới', editedBy: 'u1' })
    expect(q.update).toHaveBeenCalledWith({ edited_report: 'Mới', edited_by: 'u1', edited_at: expect.any(String) })
    expect(q.eq).toHaveBeenCalledWith('id', 'p1')
  })
  test('UT-SS-17: updateReport lỗi DB (vd. id không tồn tại) -> ném Error', async () => {
    queueFrom(supabaseAdmin.from, { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } })
    await expect(StudyService.updateReport('px', 'Mới', 'u1')).rejects.toThrow('multiple (or no) rows')
  })
})
