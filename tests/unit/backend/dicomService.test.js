// services/dicomService.js - phân vùng tương đương (EP): chưa cấu hình / upstream lỗi / thành công; fetch được giả lập.
// SPINE_API_URL và SPINE_API_KEY được đọc khi nạp module nên mỗi test nạp lại module bằng jest.isolateModules.
function loadDicomService({ url = 'http://ai.test', key = 'k' } = {}) {
  process.env.SPINE_API_URL = url
  process.env.SPINE_API_KEY = key
  let service
  jest.isolateModules(() => {
    service = require('@sut/src/services/dicomService').DicomService
  })
  return service
}

const jsonResponse = (body, ok = true) => ({ ok, json: async () => body })

beforeEach(() => { global.fetch = jest.fn() })
afterEach(() => {
  delete global.fetch
  delete process.env.SPINE_API_URL
  delete process.env.SPINE_API_KEY
})

describe('DicomService khi chưa cấu hình AI server', () => {
  test('UT-DCM-01: không có SPINE_API_URL -> [], [], null và không gọi fetch', async () => {
    const service = loadDicomService({ url: '' })
    await expect(service.listFolders()).resolves.toEqual([])
    await expect(service.listFiles('P1/S1')).resolves.toEqual([])
    await expect(service.getFileStream('P1/S1', 'a.dcm')).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('DicomService.listFolders', () => {
  test('UT-DCM-02: gộp patient/series và sắp xếp tự nhiên (P2 trước P10), gửi Bearer key', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ patients: [{ id: 'P10' }, { id: 'P2' }] }))
      .mockResolvedValueOnce(jsonResponse({ series: [{ id: 'S1', file_count: 15 }] }))
      .mockResolvedValueOnce(jsonResponse({ series: [{ id: 'S10', file_count: 3 }, { id: 'S2', file_count: 7 }] }))
    const folders = await loadDicomService().listFolders()
    expect(folders).toEqual([
      { name: 'P2/S2', fileCount: 7 },
      { name: 'P2/S10', fileCount: 3 },
      { name: 'P10/S1', fileCount: 15 },
    ])
    expect(fetch).toHaveBeenNthCalledWith(1, 'http://ai.test/patients', expect.objectContaining({ headers: { Authorization: 'Bearer k' } }))
    expect(fetch).toHaveBeenNthCalledWith(2, 'http://ai.test/patients/P10/series', expect.anything())
  })
  test('UT-DCM-03: không có API key -> không gửi header Authorization', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({}))
    await expect(loadDicomService({ key: '' }).listFolders()).resolves.toEqual([])
    expect(fetch.mock.calls[0][1].headers).toEqual({})
  })
  test.each([
    ['upstream trả lỗi', () => fetch.mockResolvedValueOnce(jsonResponse({}, false))],
    ['fetch ném lỗi mạng', () => fetch.mockRejectedValueOnce(new TypeError('fetch failed'))],
  ])('UT-DCM-04: /patients %s -> []', async (_name, arrange) => {
    arrange()
    await expect(loadDicomService().listFolders()).resolves.toEqual([])
  })
  test('UT-DCM-05: series của một bệnh nhân lỗi -> bỏ qua bệnh nhân đó, giữ bệnh nhân khác', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ patients: [{ id: 'P1' }, { id: 'P2' }, { id: 'P3' }] }))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({ series: [{ id: 'S1', file_count: 1 }] }))
    await expect(loadDicomService().listFolders()).resolves.toEqual([{ name: 'P3/S1', fileCount: 1 }])
  })
})

describe('DicomService.listFiles', () => {
  test.each([['P1'], ['P1/'], ['/S1']])('UT-DCM-06: tên thư mục "%s" thiếu patient/series -> [], không gọi fetch', async (folder) => {
    await expect(loadDicomService().listFiles(folder)).resolves.toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })
  test('UT-DCM-07: trả danh sách tệp sắp xếp tự nhiên (img2 trước img10)', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ files: ['img10.dcm', 'img2.dcm', 'IMG1.dcm'] }))
    await expect(loadDicomService().listFiles('P1/S1')).resolves.toEqual(['IMG1.dcm', 'img2.dcm', 'img10.dcm'])
    expect(fetch.mock.calls[0][0]).toBe('http://ai.test/patients/P1/series/S1/files')
  })
  test.each([
    ['upstream lỗi', () => fetch.mockResolvedValueOnce(jsonResponse({}, false)), []],
    ['không có trường files', () => fetch.mockResolvedValueOnce(jsonResponse({})), []],
    ['fetch ném lỗi', () => fetch.mockRejectedValueOnce(new Error('x')), []],
  ])('UT-DCM-08: %s -> []', async (_name, arrange, expected) => {
    arrange()
    await expect(loadDicomService().listFiles('P1/S1')).resolves.toEqual(expected)
  })
})

describe('DicomService.getFileStream', () => {
  const stream = { fake: 'ReadableStream' }
  const fileResponse = (headers = {}, overrides = {}) => ({
    ok: true, body: stream, headers: { get: (name) => headers[name] ?? null }, ...overrides,
  })

  test('UT-DCM-09: tên thư mục không hợp lệ -> null', async () => {
    await expect(loadDicomService().getFileStream('P1', 'a.dcm')).resolves.toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  test('UT-DCM-10: có content-length -> trả stream kèm kích thước', async () => {
    fetch.mockResolvedValueOnce(fileResponse({ 'content-length': '2048' }))
    await expect(loadDicomService().getFileStream('P1/S1', 'a.dcm')).resolves.toEqual({ stream, size: 2048 })
    expect(fetch.mock.calls[0][0]).toBe('http://ai.test/patients/P1/series/S1/files/a.dcm')
  })
  test('UT-DCM-11: không có content-length -> size 0', async () => {
    fetch.mockResolvedValueOnce(fileResponse())
    await expect(loadDicomService().getFileStream('P1/S1', 'a.dcm')).resolves.toEqual({ stream, size: 0 })
  })
  test.each([
    ['upstream 404', () => fetch.mockResolvedValueOnce(fileResponse({}, { ok: false }))],
    ['body rỗng', () => fetch.mockResolvedValueOnce(fileResponse({}, { body: null }))],
    ['fetch ném lỗi', () => fetch.mockRejectedValueOnce(new Error('x'))],
  ])('UT-DCM-12: %s -> null', async (_name, arrange) => {
    arrange()
    await expect(loadDicomService().getFileStream('P1/S1', 'a.dcm')).resolves.toBeNull()
  })

  // BUG-09: fileName (lấy từ route param đã giải mã) được ghép thẳng vào URL. "../" đưa yêu cầu kèm API key
  // của backend ra khỏi thư mục /patients/<p>/series/<s>/files/ trên AI server (path traversal).
  test.failing('UT-DCM-13 (BUG-09): fileName chứa "../" không được thoát khỏi thư mục files của series', async () => {
    fetch.mockResolvedValue(fileResponse())
    await loadDicomService().getFileStream('P1/S1', '../../../../admin/keys')
    const requested = fetch.mock.calls.map(([url]) => new URL(url).pathname)
    expect(requested.every((pathname) => pathname.startsWith('/patients/P1/series/S1/files/'))).toBe(true)
  })
})
