// Nhóm /api/v1/dicom (FR-05): xác thực bắt buộc, liệt kê thư mục/tệp từ AI server (fetch giả lập), sắp xếp tự nhiên,
// truyền luồng tệp DICOM và kiểm tra tham số đường dẫn (BUG-09).
jest.mock('@sut/src/config/supabase', () => ({
  supabase: { auth: {} },
  supabaseAdmin: { from: jest.fn(), auth: { getUser: jest.fn() } },
}))

process.env.SPINE_API_URL = 'http://spine.test'
process.env.SPINE_API_KEY = 'test-spine-key'

const request = require('supertest')
const { app } = require('@sut/src/app')
const { supabaseAdmin } = require('@sut/src/config/supabase')
const { AuthService } = require('@sut/src/services/authService')
const { createHttpError } = require('@sut/src/utils/httpError')
const { installAuth, bearer } = require('../mocks/authContext')

const API = '/api/v1/dicom'
const json = (body, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => body })

beforeEach(() => {
  jest.resetAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  installAuth({ supabaseAdmin, AuthService, createHttpError })
  global.fetch = jest.fn()
})
afterEach(() => {
  jest.restoreAllMocks()
  delete global.fetch
})

describe('Xác thực', () => {
  test.each([
    ['/folders'],
    ['/folders/P1/S1/files'],
    ['/folders/P1/S1/files/img1.dcm'],
  ])('IT-DICOM-01: GET %s không có token -> 401, không gọi AI server', async (path) => {
    const res = await request(app).get(`${API}${path}`)
    expect(res.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('Liệt kê thư mục và tệp', () => {
  test('IT-DICOM-02: /folders gộp bệnh nhân x series, sắp xếp tự nhiên, bỏ qua bệnh nhân lỗi', async () => {
    fetch.mockImplementation(async (url) => {
      if (url.endsWith('/patients')) return json({ patients: [{ id: 'P10' }, { id: 'P2' }, { id: 'P3' }] })
      if (url.includes('/P10/')) return json({ series: [{ id: 'S1', file_count: 20 }] })
      if (url.includes('/P2/')) return json({ series: [{ id: 'S2', file_count: 5 }, { id: 'S1', file_count: 4 }] })
      throw new TypeError('fetch failed')
    })
    const res = await request(app).get(`${API}/folders`).set(bearer('doctor'))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([
      { name: 'P2/S1', fileCount: 4 },
      { name: 'P2/S2', fileCount: 5 },
      { name: 'P10/S1', fileCount: 20 },
    ])
    expect(fetch.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer test-spine-key' })
  })
  test('IT-DICOM-03: AI server trả lỗi khi liệt kê bệnh nhân -> 200 với danh sách rỗng', async () => {
    fetch.mockResolvedValue(json({}, false))
    const res = await request(app).get(`${API}/folders`).set(bearer('doctor'))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
  })
  test('IT-DICOM-04: danh sách tệp được sắp xếp tự nhiên (img2 trước img10)', async () => {
    fetch.mockResolvedValue(json({ files: ['img10.dcm', 'img2.dcm', 'IMG1.dcm'] }))
    const res = await request(app).get(`${API}/folders/P1/S1/files`).set(bearer('doctor'))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual(['IMG1.dcm', 'img2.dcm', 'img10.dcm'])
    expect(fetch.mock.calls[0][0]).toBe('http://spine.test/patients/P1/series/S1/files')
  })
  test('IT-DICOM-05: route cũ /folders/:folderName/files với tên không có "/" -> 200 rỗng, không gọi AI', async () => {
    const res = await request(app).get(`${API}/folders/P1/files`).set(bearer('doctor'))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('Tải tệp DICOM', () => {
  test('IT-DICOM-06: tệp tồn tại -> 200, Content-Type application/dicom, đúng nội dung', async () => {
    const bytes = Buffer.from('DICM-du-lieu-gia')
    fetch.mockResolvedValue(new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } }))
    const res = await request(app).get(`${API}/folders/P1/S1/files/img1.dcm`).set(bearer('doctor'))
      .buffer(true).parse((r, cb) => { const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))) })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/dicom')
    expect(res.headers['content-length']).toBe(String(bytes.length))
    expect(res.headers['cache-control']).toBe('public, max-age=3600')
    expect(res.body.equals(bytes)).toBe(true)
  })
  test('IT-DICOM-10: AI server không gửi content-length -> 200, không đặt Content-Length (truyền theo chunk)', async () => {
    fetch.mockResolvedValue(new Response(Buffer.from('DICM'), { status: 200 }))
    const res = await request(app).get(`${API}/folders/P1/S1/files/img1.dcm`).set(bearer('doctor')).buffer(true)
    expect(res.status).toBe(200)
    expect(res.headers['content-length']).toBeUndefined()
    expect(res.headers['transfer-encoding']).toBe('chunked')
  })
  test('IT-DICOM-07: AI server trả 404 -> 404 "DICOM file not found"', async () => {
    fetch.mockResolvedValue(new Response(null, { status: 404 }))
    const res = await request(app).get(`${API}/folders/P1/S1/files/khong-co.dcm`).set(bearer('doctor'))
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'DICOM file not found' })
  })
  // BUG-09: tham số đường dẫn ghép thẳng vào URL gọi AI server; "../" thoát khỏi thư mục series, request mang API key của backend.
  test.failing.each([
    ['..%2F..%2F..%2F..%2Fadmin%2Fkeys'],
    ['..%2F..%2F..%2F..%2F..%2Fadmin%2Fusers'],
  ])('IT-DICOM-08 (BUG-09): tên tệp %s không được làm backend gọi AI server ngoài /patients/P1/series/S1/files/', async (fileName) => {
    fetch.mockResolvedValue(new Response(null, { status: 404 }))
    await request(app).get(`${API}/folders/P1/S1/files/${fileName}`).set(bearer('doctor'))
    for (const [url] of fetch.mock.calls) {
      expect(new URL(url).pathname.startsWith('/patients/P1/series/S1/files/')).toBe(true)
    }
  })
  test('IT-DICOM-09: quan sát thực tế của BUG-09 -> URL gọi AI server chuẩn hoá thành /admin/users', async () => {
    fetch.mockResolvedValue(new Response(null, { status: 404 }))
    await request(app).get(`${API}/folders/P1/S1/files/..%2F..%2F..%2F..%2F..%2Fadmin%2Fusers`).set(bearer('doctor'))
    const [url, init] = fetch.mock.calls[0]
    expect(new URL(url).pathname).toBe('/admin/users')
    expect(init.headers).toEqual({ Authorization: 'Bearer test-spine-key' })
  })
})
