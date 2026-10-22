// Proxy sinh báo cáo /api/v1/p2vg: phân vùng tương đương kết quả upstream và kịch bản tích hợp RSNA -> P2VG.
// Máy chủ AI được giả lập bằng global.fetch; StudyService được theo dõi bằng spy.
jest.mock('@sut/src/config/supabase', () => ({
  supabase: { auth: {} },
  supabaseAdmin: { from: jest.fn(), auth: { getUser: jest.fn() } },
}))

process.env.P2VG_API_URL = 'http://p2vg.test'
process.env.P2VG_API_KEY = 'test-p2vg-key'
process.env.SPINE_API_URL = 'http://spine.test'
process.env.SPINE_API_KEY = 'test-spine-key'

const request = require('supertest')
const { app } = require('@sut/src/app')
const { StudyService } = require('@sut/src/services/studyService')

let unconfiguredApp
jest.isolateModules(() => {
  delete process.env.P2VG_API_URL
  unconfiguredApp = require('@sut/src/app').app
  process.env.P2VG_API_URL = 'http://p2vg.test'
})

const API = '/api/v1/p2vg'
const p2vgResult = { report: 'FINDINGS: L4/L5 hẹp nhẹ', prompt_used: 'mặc định', processing_time_ms: 4200, series_detected: ['sag_t2'] }
const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, statusText: 'Upstream', json: async () => body })
const namedError = (name) => Object.assign(new Error(name), { name })
const flush = () => new Promise((resolve) => setImmediate(resolve))
const withFile = (req) => req.attach('files', Buffer.from('DICM'), 'img0.dcm').field('relativePaths', 'P1/S1/img0.dcm')

beforeEach(() => {
  global.fetch = jest.fn()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(StudyService, 'findOrCreateStudy').mockImplementation(async ({ patientId }) => ({ id: `study-${patientId}` }))
  jest.spyOn(StudyService, 'saveRsnaResult').mockResolvedValue({ id: 'rsna-1' })
  jest.spyOn(StudyService, 'getLatestRsnaResult').mockImplementation(async (studyId) => (studyId === 'study-1001' ? { id: 'rsna-1' } : null))
  jest.spyOn(StudyService, 'saveP2vgReport').mockResolvedValue({ id: 'report-1' })
})
afterEach(() => {
  jest.restoreAllMocks()
  delete global.fetch
})

describe('GET /p2vg/health, /p2vg/config', () => {
  test('IT-P2VG-01: P2VG server trả HTML (không phải JSON) -> ok=false "P2VG server non-JSON response"', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, text: async () => '<html>ngrok</html>' })
    const res = await request(app).get(`${API}/health`)
    expect(res.body).toEqual({ status: 'error', ok: false, error: 'P2VG server non-JSON response' })
  })
  // BUG-02: /p2vg/config cũng trả API key cho người chưa đăng nhập.
  test.failing('IT-P2VG-02 (BUG-02): người chưa đăng nhập không được nhận API key qua /p2vg/config', async () => {
    const res = await request(app).get(`${API}/config`)
    expect(JSON.stringify(res.body)).not.toContain('test-p2vg-key')
    expect(res.status).toBe(401)
  })
})

describe('POST /p2vg/analyze (FR-08)', () => {
  test('IT-P2VG-03: chưa cấu hình P2VG_API_URL -> 503', async () => {
    const res = await withFile(request(unconfiguredApp).post(`${API}/analyze`))
    expect(res.status).toBe(503)
  })
  test('IT-P2VG-04: không có tệp -> 400, không gọi AI', async () => {
    const res = await request(app).post(`${API}/analyze`).field('prompt', 'x')
    expect(res.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })
  test('IT-P2VG-05: chuyển tiếp prompt, rsna_findings và tên tệp theo relativePaths', async () => {
    fetch.mockResolvedValue(jsonResponse(200, p2vgResult))
    const findings = JSON.stringify([{ level: 'L4/L5', label: 'moderate' }])
    const res = await withFile(request(app).post(`${API}/analyze`)).field('prompt', 'Mô tả ngắn').field('rsnaFindings', findings)
    expect(res.status).toBe(200)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('http://p2vg.test/predict/analyze')
    expect(init.headers).toEqual({ Authorization: 'Bearer test-p2vg-key' })
    expect(init.body.get('prompt')).toBe('Mô tả ngắn')
    expect(init.body.get('rsna_findings')).toBe(findings)
    expect(init.body.getAll('files')[0].name).toBe('P1/S1/img0.dcm')
    expect(init.body.has('relativePaths')).toBe(false)
  })
  test('IT-P2VG-06: không có prompt/rsnaFindings -> không gửi hai trường này', async () => {
    fetch.mockResolvedValue(jsonResponse(200, p2vgResult))
    await withFile(request(app).post(`${API}/analyze`))
    const body = fetch.mock.calls[0][1].body
    expect(body.has('prompt')).toBe(false)
    expect(body.has('rsna_findings')).toBe(false)
  })
  test('IT-P2VG-07: upstream 400 kèm detail -> chuyển tiếp mã và thông báo', async () => {
    fetch.mockResolvedValue(jsonResponse(400, { detail: 'Thiếu chuỗi sagittal T2' }))
    const res = await withFile(request(app).post(`${API}/analyze`))
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Thiếu chuỗi sagittal T2' })
  })
  test.each([
    ['TimeoutError', 504, 'AI inference timeout (>15 min)'],
    ['TypeError', 502, 'Cannot reach P2VG server'],
  ])('IT-P2VG-08: fetch ném %s -> %i', async (name, status, message) => {
    fetch.mockRejectedValue(namedError(name))
    const res = await withFile(request(app).post(`${API}/analyze`))
    expect(res.status).toBe(status)
    expect(res.body.error).toBe(message)
  })
  test('IT-P2VG-09: thành công -> 200, khoá camelCase, lưu báo cáo kèm rsnaFindings đã parse', async () => {
    fetch.mockResolvedValue(jsonResponse(200, p2vgResult))
    const res = await withFile(request(app).post(`${API}/analyze`)).field('rsnaFindings', '[{"level":"L4/L5"}]')
    await flush()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ report: p2vgResult.report, promptUsed: 'mặc định', processingTimeMs: 4200, seriesDetected: ['sag_t2'] })
    expect(StudyService.saveP2vgReport).toHaveBeenCalledWith(expect.objectContaining({
      report: p2vgResult.report, promptUsed: 'mặc định', rsnaFindings: [{ level: 'L4/L5' }], processingTimeMs: 4200,
    }))
  })
  test('IT-P2VG-10: lưu báo cáo thất bại không chặn phản hồi -> vẫn 200', async () => {
    fetch.mockResolvedValue(jsonResponse(200, p2vgResult))
    StudyService.saveP2vgReport.mockRejectedValue(new Error('supabase down'))
    const res = await withFile(request(app).post(`${API}/analyze`))
    await flush()
    expect(res.status).toBe(200)
  })

  // BUG-04: mỗi lần sinh báo cáo tạo study mới "p2vg_<timestamp>", báo cáo không gắn với study và kết quả RSNA của ca.
  test.failing('IT-P2VG-11 (BUG-04): báo cáo P2VG phải gắn vào study và kết quả RSNA của cùng ca chụp', async () => {
    fetch.mockImplementation(async (url) => (url.startsWith('http://spine.test')
      ? jsonResponse(200, { study_id: 1001, severity: [], coordinates: [] })
      : jsonResponse(200, p2vgResult)))
    await withFile(request(app).post('/api/v1/spine/analyze'))
    await withFile(request(app).post(`${API}/analyze`))
    await flush()
    expect(StudyService.saveP2vgReport).toHaveBeenCalledWith(expect.objectContaining({
      studyId: 'study-1001', rsnaResultId: 'rsna-1',
    }))
  })
  test('IT-P2VG-12: quan sát thực tế của BUG-04 -> study "p2vg_<timestamp>", rsnaResultId undefined', async () => {
    fetch.mockResolvedValue(jsonResponse(200, p2vgResult))
    await withFile(request(app).post(`${API}/analyze`))
    await flush()
    expect(StudyService.findOrCreateStudy).toHaveBeenCalledWith({ patientId: expect.stringMatching(/^p2vg_\d+$/), fileCount: 1 })
    expect(StudyService.saveP2vgReport.mock.calls[0][0].rsnaResultId).toBeUndefined()
  })

  // BUG-06: /p2vg/analyze không gắn requireAuth.
  test.failing('IT-P2VG-13 (BUG-06): sinh báo cáo khi chưa đăng nhập -> 401', async () => {
    fetch.mockResolvedValue(jsonResponse(200, p2vgResult))
    const res = await withFile(request(app).post(`${API}/analyze`))
    expect(res.status).toBe(401)
  })
})
