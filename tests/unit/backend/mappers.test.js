// Các mapper chuyển snake_case (Supabase, AI server) sang camelCase cho frontend.
const { toSpineResultDto, toRsnaRecord } = require('@sut/src/mappers/spineMapper')
const p2vgMapper = require('@sut/src/mappers/p2vgMapper')
const { toProfileDto, toHospitalDto, toDepartmentDto } = require('@sut/src/mappers/authMapper')
const studyMapper = require('@sut/src/mappers/studyMapper')

const aiResponse = () => ({
  study_id: 1001,
  series_mapping: { sagittal_t1: 's1' },
  coordinates: [{ study_id: 1001, series_id: 's1', instance_number: 7, x: 10, y: 20, level: 'L4/L5' }],
  severity: [{ normal_mild: 0.7, moderate: 0.2, severe: 0.1, predicted_label: 'normal_mild', level: 'L4/L5' }],
  model_version: 'v2',
})

describe('spineMapper', () => {
  test('UT-MAP-01: toSpineResultDto đổi khoá cấp ngoài và giữ khoá khác', () => {
    const dto = toSpineResultDto(aiResponse())
    expect(dto).toMatchObject({ studyId: 1001, seriesMapping: { sagittal_t1: 's1' }, model_version: 'v2' })
    expect(dto).not.toHaveProperty('study_id')
    expect(dto).not.toHaveProperty('series_mapping')
  })
  test('UT-MAP-02: đổi khoá trong từng phần tử coordinates', () => {
    const [coordinate] = toSpineResultDto(aiResponse()).coordinates
    expect(coordinate).toEqual({ studyId: 1001, seriesId: 's1', instanceNumber: 7, x: 10, y: 20, level: 'L4/L5' })
  })
  test('UT-MAP-03: đổi khoá trong từng phần tử severity', () => {
    const [severity] = toSpineResultDto(aiResponse()).severity
    expect(severity).toEqual({ normalMild: 0.7, moderate: 0.2, severe: 0.1, predictedLabel: 'normal_mild', level: 'L4/L5' })
  })
  test('UT-MAP-04: coordinates/severity không phải mảng -> giữ nguyên giá trị', () => {
    const dto = toSpineResultDto({ study_id: 1, coordinates: null, severity: undefined })
    expect(dto.coordinates).toBeNull()
    expect(dto.severity).toBeUndefined()
  })
  test('UT-MAP-05: không làm thay đổi object đầu vào', () => {
    const input = aiResponse()
    const snapshot = JSON.parse(JSON.stringify(input))
    toSpineResultDto(input)
    expect(input).toEqual(snapshot)
  })
  test('UT-MAP-06: toRsnaRecord giữ dữ liệu gốc trong rawResponse', () => {
    const input = aiResponse()
    const record = toRsnaRecord(input)
    expect(record).toEqual({
      studyId: 1001,
      severity: input.severity,
      coordinates: input.coordinates,
      seriesMapping: input.series_mapping,
      rawResponse: input,
    })
  })
})

describe('p2vgMapper', () => {
  const data = { report: 'FINDINGS...', prompt_used: 'p', processing_time_ms: 1200, series_detected: ['t1'], extra: 1 }

  test('UT-MAP-07: toP2vgReportDto bỏ khoá snake_case, thêm khoá camelCase', () => {
    expect(p2vgMapper.toP2vgReportDto(data)).toEqual({
      report: 'FINDINGS...', extra: 1, promptUsed: 'p', processingTimeMs: 1200, seriesDetected: ['t1'],
    })
  })
  test('UT-MAP-08: toP2vgRecord chỉ lấy 4 trường cần lưu', () => {
    expect(p2vgMapper.toP2vgRecord(data)).toEqual({
      report: 'FINDINGS...', promptUsed: 'p', seriesDetected: ['t1'], processingTimeMs: 1200,
    })
  })
})

describe('authMapper', () => {
  const profile = {
    id: 'u1', employee_code: 'BS01', full_name: 'Bác sĩ A', email: 'a@test.local', phone: null, gender: 'male',
    date_of_birth: '1990-01-01', avatar_url: null, role: 'doctor', hospital_id: 'h1', department_id: 'd1',
    department: { id: 'd1', name: 'Chẩn đoán hình ảnh', extra: 'x' }, specialty: 'MRI',
    hospital: { id: 'h1', code: 'VIETDUC', name: 'BV Việt Đức', is_active: true },
    status: 'active', is_active: true, created_by: 'admin', last_login_at: null, notes: null,
    created_at: 't0', updated_at: 't1',
  }

  test.each([[null], [undefined]])('UT-MAP-09: toProfileDto(%p) -> null', (value) => {
    expect(toProfileDto(value)).toBeNull()
    expect(toHospitalDto(value)).toBeNull()
    expect(toDepartmentDto(value)).toBeNull()
  })
  test('UT-MAP-10: toProfileDto ánh xạ đầy đủ, chỉ giữ id/code/name của bệnh viện', () => {
    const dto = toProfileDto(profile)
    expect(dto).toMatchObject({ id: 'u1', employeeCode: 'BS01', fullName: 'Bác sĩ A', role: 'doctor', isActive: true })
    expect(dto.hospital).toEqual({ id: 'h1', code: 'VIETDUC', name: 'BV Việt Đức' })
    expect(dto.department).toEqual({ id: 'd1', name: 'Chẩn đoán hình ảnh' })
  })
  test('UT-MAP-11: thiếu khoa/bệnh viện/chuyên môn -> null', () => {
    const dto = toProfileDto({ ...profile, department_id: undefined, department: null, hospital: null, specialty: undefined })
    expect(dto).toMatchObject({ departmentId: null, department: null, hospital: null, specialty: null })
  })
  test('UT-MAP-12: toHospitalDto lấy accountCount từ phép đếm, không có thì undefined', () => {
    const hospital = { id: 'h1', code: 'VIETDUC', name: 'BV', is_active: false }
    expect(toHospitalDto({ ...hospital, accounts: [{ count: 3 }] })).toMatchObject({ isActive: false, accountCount: 3 })
    expect(toHospitalDto(hospital).accountCount).toBeUndefined()
    expect(toHospitalDto({ ...hospital, accounts: [] }).accountCount).toBeUndefined()
  })
  test('UT-MAP-13: toDepartmentDto đếm bác sĩ, không có thì 0', () => {
    const department = { id: 'd1', hospital_id: 'h1', name: 'Nội' }
    expect(toDepartmentDto({ ...department, doctors: [{ count: 2 }] })).toMatchObject({ hospitalId: 'h1', doctorCount: 2 })
    expect(toDepartmentDto(department).doctorCount).toBe(0)
    expect(toDepartmentDto({ ...department, doctors: [] }).doctorCount).toBe(0)
  })
})

describe('studyMapper', () => {
  test('UT-MAP-14: null -> null cho cả 3 hàm', () => {
    expect(studyMapper.toStudyDto(null)).toBeNull()
    expect(studyMapper.toRsnaResultDto(null)).toBeNull()
    expect(studyMapper.toP2vgReportDto(null)).toBeNull()
  })
  test('UT-MAP-15: ánh xạ study, kết quả RSNA và báo cáo P2VG', () => {
    expect(studyMapper.toStudyDto({ id: 's1', patient_id: 'P1', file_count: 3, body_part: 'LSPINE' }))
      .toMatchObject({ id: 's1', patientId: 'P1', fileCount: 3, bodyPart: 'LSPINE' })
    expect(studyMapper.toRsnaResultDto({ id: 'r1', study_id: 's1', processing_time_ms: 5, raw_response: { a: 1 } }))
      .toMatchObject({ id: 'r1', studyId: 's1', processingTimeMs: 5, rawResponse: { a: 1 } })
    expect(studyMapper.toP2vgReportDto({ id: 'p1', rsna_result_id: 'r1', edited_report: 'sửa', edited_by: 'u1' }))
      .toMatchObject({ id: 'p1', rsnaResultId: 'r1', editedReport: 'sửa', editedBy: 'u1' })
  })
})
