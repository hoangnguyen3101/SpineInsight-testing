// Proxy AI /api/v1/spine: phân vùng tương đương các kết quả của AI server (chưa cấu hình, lỗi upstream, timeout,
// không tới được, thành công) và giá trị biên số tệp tải lên. Máy chủ AI được giả lập bằng global.fetch.
jest.mock('@sut/src/config/supabase', () => ({
  supabase: { auth: {} },
  supabaseAdmin: { from: jest.fn(), auth: { getUser: jest.fn() } },
}))

process.env.SPINE_API_URL = 'http://spine.test'
process.env.SPINE_API_KEY = 'test-spine-key'

const request = require('supertest')
const { app } = require('@sut/src/app')
const { StudyService } = require('@sut/src/services/studyService')

let unconfiguredApp
jest.isolateModules(() => {
  delete process.env.SPINE_API_URL
  delete process.env.SPINE_API_KEY
  unconfiguredApp = require('@sut/src/app').app
  process.env.SPINE_API_URL = 'http://spine.test'
  process.env.SPINE_API_KEY = 'test-spine-key'
})

const API = '/api/v1/spine'
const aiResult = {
  study_id: 1001,
  series_mapping: { sagittal_t1: 's1' },
  coordinates: [{ study_id: 1001, series_id: 's1', instance_number: 7, x: 10, y: 20 }],
  severity: [{ normal_mild: 0.8, predicted_label: 'normal_mild', level: 'L4/L5' }],
}
const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: 'Upstream',
  json: async () => body,
  text: async () => JSON.stringify(body),
})
const namedError = (name) => Object.assign(new Error(name), { name })
const flush = () => new Promise((resolve) => setImmediate(resolve))

function attachFiles(req, count) {
  for (let i = 0; i < count; i++) {
    req = req.attach('files', Buffer.from(`DICM-${i}`), `img${i}.dcm`).field('relativePaths', `P1/S1/img${i}.dcm`)
  }
  return req
}

beforeEach(() => {
  global.fetch = jest.fn()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(StudyService, 'findOrCreateStudy').mockResolvedValue({ id: 'study-1001' })
  jest.spyOn(StudyService, 'saveRsnaResult').mockResolvedValue({ id: 'rsna-1' })
})
afterEach(() => {
  jest.restoreAllMocks()
  delete global.fetch
})

describe('GET /spine/health, /spine/config', () => {
  test('IT-SPINE-01: AI server khoẻ -> 200 {status: ok, ok: true}, gửi kèm API key', async () => {
    fetch.mockResolvedValue(jsonResponse(200, { status: 'ok', model: 'rsna' }))
    const res = await request(app).get(`${API}/health`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok', model: 'rsna', ok: true })
    expect(fetch.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer test-spine-key' })
  })
  test('IT-SPINE-02: chưa cấu hình SPINE_API_URL -> ok=false, không gọi fetch', async () => {
    const res = await request(unconfiguredApp).get(`${API}/health`)
    expect(res.body).toEqual({ status: 'error', ok: false, error: 'SPINE_API_URL not configured' })
    expect(fetch).not.toHaveBeenCalled()
  })
  // BUG-02: /spine/config trả nguyên API key của AI server cho người chưa đăng nhập.
  test.failing('IT-SPINE-03 (BUG-02): người chưa đăng nhập không được nhận API key qua /spine/config', async () => {
    const res = await request(app).get(`${API}/config`)
    expect(JSON.stringify(res.body)).not.toContain('test-spine-key')
    expect(res.status).toBe(401)
  })
})

describe('POST /spine/predict (FR-07)', () => {
  test('IT-SPINE-04: chưa cấu hình AI -> 503', async () => {
    const res = await request(unconfiguredApp).post(`${API}/predict`).send({ dicomDir: 'P1/S1' })
    expect(res.status).toBe(503)
  })
  test('IT-SPINE-05: thiếu dicomDir -> 400, không gọi AI', async () => {
    const res = await request(app).post(`${API}/predict`).send({})
    expect(res.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })
  test('IT-SPINE-06: AI trả 422 kèm detail -> chuyển tiếp nguyên mã và thông báo', async () => {
    fetch.mockResolvedValue(jsonResponse(422, { detail: 'Không tìm thấy series sagittal' }))
    const res = await request(app).post(`${API}/predict`).send({ dicomDir: 'P1/S1' })
    expect(res.status).toBe(422)
    expect(res.body).toEqual({ error: 'Không tìm thấy series sagittal' })
  })
  test.each([
    ['TimeoutError', 504],
    ['TypeError', 502],
  ])('IT-SPINE-07: fetch ném %s -> %i', async (name, status) => {
    fetch.mockRejectedValue(namedError(name))
    const res = await request(app).post(`${API}/predict`).send({ dicomDir: 'P1/S1' })
    expect(res.status).toBe(status)
  })
  test('IT-SPINE-08: thành công -> 200, body camelCase, gửi dicom_dir tới /predict/clinical', async () => {
    fetch.mockResolvedValue(jsonResponse(200, aiResult))
    const res = await request(app).post(`${API}/predict`).send({ dicomDir: 'P1/S1' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ studyId: 1001, coordinates: [{ seriesId: 's1', instanceNumber: 7 }] })
    expect(res.body.severity[0]).toMatchObject({ normalMild: 0.8, predictedLabel: 'normal_mild' })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('http://spine.test/predict/clinical')
    expect(JSON.parse(init.body)).toEqual({ dicom_dir: 'P1/S1' })
  })
})

describe('POST /spine/analyze (FR-07, EP và BVA số tệp)', () => {
  test('IT-SPINE-09: chưa cấu hình AI -> 503', async () => {
    const res = await attachFiles(request(unconfiguredApp).post(`${API}/analyze`), 1)
    expect(res.status).toBe(503)
  })
  test('IT-SPINE-10: 0 tệp -> 400 "Không có file DICOM nào được gửi lên"', async () => {
    const res = await request(app).post(`${API}/analyze`).field('relativePaths', 'P1/S1/a.dcm')
    expect(res.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })
  test.each([[1], [3]])('IT-SPINE-11: %i tệp -> chuyển tiếp đủ tệp và relativePaths tới /predict/analyze', async (count) => {
    fetch.mockResolvedValue(jsonResponse(200, aiResult))
    const res = await attachFiles(request(app).post(`${API}/analyze`), count)
    expect(res.status).toBe(200)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('http://spine.test/predict/analyze')
    expect(init.headers).toEqual({ Authorization: 'Bearer test-spine-key' })
    const files = init.body.getAll('files')
    expect(files).toHaveLength(count)
    expect(files[0].name).toBe('P1/S1/img0.dcm')
    expect(init.body.getAll('relativePaths')).toEqual(Array.from({ length: count }, (_, i) => `P1/S1/img${i}.dcm`))
  })
  test('IT-SPINE-12: AI trả 500 không có body JSON -> 500 với statusText', async () => {
    fetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error', json: async () => { throw new SyntaxError('x') } })
    const res = await attachFiles(request(app).post(`${API}/analyze`), 1)
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Internal Server Error' })
  })
  test.each([
    ['TimeoutError', 504, 'AI inference timeout (>12 min)'],
    ['TypeError', 502, 'Cannot reach AI server'],
  ])('IT-SPINE-13: fetch ném %s -> %i', async (name, status, message) => {
    fetch.mockRejectedValue(namedError(name))
    const res = await attachFiles(request(app).post(`${API}/analyze`), 1)
    expect(res.status).toBe(status)
    expect(res.body.error).toBe(message)
  })
  test('IT-SPINE-14: thành công -> 200 camelCase và lưu kết quả RSNA vào study theo study_id', async () => {
    fetch.mockResolvedValue(jsonResponse(200, aiResult))
    const res = await attachFiles(request(app).post(`${API}/analyze`), 2)
    await flush()
    expect(res.status).toBe(200)
    expect(res.body.studyId).toBe(1001)
    expect(StudyService.findOrCreateStudy).toHaveBeenCalledWith({ patientId: '1001', fileCount: 2 })
    expect(StudyService.saveRsnaResult).toHaveBeenCalledWith(expect.objectContaining({
      studyId: 'study-1001', severity: aiResult.severity, coordinates: aiResult.coordinates, rawResponse: aiResult,
    }))
  })
  test('IT-SPINE-15: lưu Supabase thất bại không chặn phản hồi -> vẫn 200', async () => {
    fetch.mockResolvedValue(jsonResponse(200, aiResult))
    StudyService.findOrCreateStudy.mockRejectedValue(new Error('supabase down'))
    const res = await attachFiles(request(app).post(`${API}/analyze`), 1)
    await flush()
    expect(res.status).toBe(200)
    expect(StudyService.saveRsnaResult).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalledWith('[SpineAI] Failed to save RSNA result to Supabase:', expect.any(Error))
  })
  test('IT-SPINE-16: 2000 tệp (đúng giới hạn) -> được chấp nhận và chuyển tiếp đủ 2000 tệp', async () => {
    fetch.mockResolvedValue(jsonResponse(200, aiResult))
    const res = await attachFiles(request(app).post(`${API}/analyze`), 2000)
    expect(res.status).toBe(200)
    expect(fetch.mock.calls[0][1].body.getAll('files')).toHaveLength(2000)
  }, 60000)
  // BUG-05: vượt giới hạn multer (2001 tệp) bị errorHandler trả 500 thay vì mã 4xx.
  test.failing('IT-SPINE-17 (BUG-05): 2001 tệp (vượt giới hạn) -> 413 hoặc 400, không phải 500', async () => {
    const res = await attachFiles(request(app).post(`${API}/analyze`), 2001)
    expect(fetch).not.toHaveBeenCalled()
    expect([400, 413]).toContain(res.status)
  }, 60000)
  test('IT-SPINE-18: 2001 tệp -> quan sát thực tế 500 "Too many files", không gọi AI', async () => {
    const res = await attachFiles(request(app).post(`${API}/analyze`), 2001)
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: 'Too many files' })
    expect(fetch).not.toHaveBeenCalled()
  }, 60000)
  // BUG-06: /spine/analyze (và /spine/predict, /p2vg/analyze) không gắn requireAuth.
  test.failing('IT-SPINE-19 (BUG-06): gửi ảnh phân tích khi chưa đăng nhập -> 401, không gọi AI', async () => {
    fetch.mockResolvedValue(jsonResponse(200, aiResult))
    const res = await attachFiles(request(app).post(`${API}/analyze`), 1)
    expect(res.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })
})
