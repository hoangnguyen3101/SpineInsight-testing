// utils/dicomFormData.js và middlewares/fileUpload.js - phân vùng tương đương (EP) cho tên tệp, cấu hình giới hạn tải lên.
const { appendDicomFiles } = require('@sut/src/utils/dicomFormData')
const { dicomUpload } = require('@sut/src/middlewares/fileUpload')

const file = (originalname, content = 'DICM') => ({ originalname, buffer: Buffer.from(content) })

describe('appendDicomFiles', () => {
  test('UT-FD-01: có relativePaths -> tên tệp gửi đi là đường dẫn tương đối, kiểu application/dicom', async () => {
    const form = new FormData()
    appendDicomFiles(form, [file('a.dcm', 'abc')], ['P1/S1/a.dcm'])
    const [sent] = form.getAll('files')
    expect(sent.name).toBe('P1/S1/a.dcm')
    expect(sent.type).toBe('application/dicom')
    expect(await sent.text()).toBe('abc')
    expect(form.getAll('relativePaths')).toEqual([])
  })
  test('UT-FD-02: thiếu relativePaths hoặc danh sách ngắn hơn -> dùng originalname', () => {
    const form = new FormData()
    appendDicomFiles(form, [file('a.dcm'), file('b.dcm')], ['P1/a.dcm'])
    expect(form.getAll('files').map((f) => f.name)).toEqual(['P1/a.dcm', 'b.dcm'])
    const noPaths = new FormData()
    appendDicomFiles(noPaths, [file('c.dcm')])
    expect(noPaths.getAll('files')[0].name).toBe('c.dcm')
  })
  test('UT-FD-03: includeRelativePaths -> thêm trường relativePaths đúng thứ tự tệp', () => {
    const form = new FormData()
    appendDicomFiles(form, [file('a.dcm'), file('b.dcm')], ['x/a.dcm'], { includeRelativePaths: true })
    expect(form.getAll('relativePaths')).toEqual(['x/a.dcm', 'b.dcm'])
  })
  test('UT-FD-04: danh sách tệp rỗng -> không thêm trường nào', () => {
    const form = new FormData()
    appendDicomFiles(form, [], [], { includeRelativePaths: true })
    expect([...form.keys()]).toEqual([])
  })
})

describe('dicomUpload (multer)', () => {
  test('UT-UP-01: giới hạn 100 MB/tệp và tối đa 2000 tệp, lưu trong bộ nhớ', () => {
    expect(dicomUpload.limits).toEqual({ fileSize: 100 * 1024 * 1024, files: 2000 })
    expect(dicomUpload.storage.constructor.name).toBe('MemoryStorage')
  })
  test.each([
    ['tệp .dcm', { originalname: 'IM0001.dcm', mimetype: 'application/dicom' }],
    ['tệp DICOM không có đuôi', { originalname: 'IM0001', mimetype: 'application/octet-stream' }],
    ['tệp văn bản', { originalname: 'note.txt', mimetype: 'text/plain' }],
  ])('UT-UP-02: fileFilter nhận %s (không lọc theo loại tệp)', (_name, upload) => {
    const cb = jest.fn()
    dicomUpload.fileFilter({}, upload, cb)
    expect(cb).toHaveBeenCalledWith(null, true)
  })
})
