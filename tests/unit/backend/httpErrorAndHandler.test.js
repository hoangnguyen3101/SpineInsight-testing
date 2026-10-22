// utils/httpError.js và middlewares/errorHandler.js - bảng quyết định: statusCode, ENOENT, FORBIDDEN, môi trường.
const { createHttpError } = require('@sut/src/utils/httpError')
const { errorHandler } = require('@sut/src/middlewares/errorHandler')

function mockRes() {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  return res
}

describe('createHttpError', () => {
  test('UT-ERR-01: tạo Error với message và statusCode', () => {
    const e = createHttpError('Sai', 400)
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toBe('Sai')
    expect(e.statusCode).toBe(400)
  })
})

describe('errorHandler', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => jest.restoreAllMocks())

  test('UT-ERR-02: lỗi có statusCode -> dùng đúng mã và message', () => {
    const res = mockRes()
    errorHandler(createHttpError('Không có quyền', 403), {}, res, jest.fn())
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Không có quyền' })
  })
  test('UT-ERR-03: ENOENT -> 404 "Resource not found"', () => {
    const res = mockRes()
    errorHandler(Object.assign(new Error('x'), { code: 'ENOENT' }), {}, res, jest.fn())
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Resource not found' })
  })
  test('UT-ERR-04: FORBIDDEN -> 403 "Access denied"', () => {
    const res = mockRes()
    errorHandler(Object.assign(new Error('x'), { code: 'FORBIDDEN' }), {}, res, jest.fn())
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Access denied' })
  })
  test('UT-ERR-05: lỗi không xác định (môi trường test) -> 500 kèm message gốc, log kèm stack', () => {
    const res = mockRes()
    const err = new Error('boom')
    errorHandler(err, {}, res, jest.fn())
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'boom' })
    expect(console.error).toHaveBeenCalledWith('[error] boom', err.stack)
  })
  test('UT-ERR-06: lỗi không có message (môi trường test) -> 500 "Internal server error"', () => {
    const res = mockRes()
    errorHandler(new Error(''), {}, res, jest.fn())
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' })
  })
})

describe('errorHandler khi NODE_ENV=production', () => {
  let productionHandler
  const previousEnv = process.env.NODE_ENV

  beforeAll(() => {
    process.env.NODE_ENV = 'production'
    jest.isolateModules(() => {
      productionHandler = require('@sut/src/middlewares/errorHandler').errorHandler
    })
  })
  afterAll(() => { process.env.NODE_ENV = previousEnv })
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => jest.restoreAllMocks())

  test('UT-ERR-07: lỗi không xác định -> 500 "Internal server error", không lộ message và stack', () => {
    const res = mockRes()
    productionHandler(new Error('password=abc at db.js:12'), {}, res, jest.fn())
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' })
    expect(console.error).toHaveBeenCalledWith('[error] password=abc at db.js:12', '')
  })
  test('UT-ERR-08: lỗi nghiệp vụ có statusCode -> vẫn trả message cho người dùng', () => {
    const res = mockRes()
    productionHandler(createHttpError('Khong tim thay benh vien', 404), {}, res, jest.fn())
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Khong tim thay benh vien' })
  })
})
