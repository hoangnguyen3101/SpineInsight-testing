// services/aiClient.js - health() có 5 kết quả khác nhau (kỹ thuật chuyển trạng thái), fetch được giả lập.
const { createAiClient, upstreamError } = require('@sut/src/services/aiClient')

const healthOptions = {
  upstreamName: 'AI server',
  notConfiguredMessage: 'not configured',
  nonJsonMessage: 'non-JSON',
  unreachableMessage: 'unreachable',
}
const textResponse = (status, text) => ({ ok: status >= 200 && status < 300, status, text: async () => text })

describe('createAiClient', () => {
  beforeEach(() => { global.fetch = jest.fn() })
  afterEach(() => { delete global.fetch })

  test('UT-AI-01: chưa cấu hình baseUrl -> isConfigured false, config trả null', () => {
    const client = createAiClient({ baseUrl: '', apiKey: '' })
    expect(client.isConfigured()).toBe(false)
    expect(client.config()).toEqual({ aiServerUrl: null, apiKey: null })
  })

  test('UT-AI-02: health khi chưa cấu hình -> lỗi notConfigured, không gọi fetch', async () => {
    const result = await createAiClient({ baseUrl: '' }).health(healthOptions)
    expect(result).toEqual({ status: 'error', ok: false, error: 'not configured' })
    expect(fetch).not.toHaveBeenCalled()
  })

  test('UT-AI-03: health khi upstream trả 500 -> báo mã lỗi upstream', async () => {
    fetch.mockResolvedValue(textResponse(500, ''))
    const result = await createAiClient({ baseUrl: 'http://ai.test' }).health(healthOptions)
    expect(result).toEqual({ status: 'error', ok: false, error: 'AI server returned 500' })
  })

  test('UT-AI-04: health khi upstream trả HTML (không phải JSON) -> nonJson', async () => {
    fetch.mockResolvedValue(textResponse(200, '<html>ngrok</html>'))
    const result = await createAiClient({ baseUrl: 'http://ai.test' }).health(healthOptions)
    expect(result.error).toBe('non-JSON')
    expect(result.ok).toBe(false)
  })

  test('UT-AI-05: health khi fetch ném lỗi mạng/timeout -> unreachable', async () => {
    fetch.mockRejectedValue(new TypeError('fetch failed'))
    const result = await createAiClient({ baseUrl: 'http://ai.test' }).health(healthOptions)
    expect(result).toEqual({ status: 'error', ok: false, error: 'unreachable' })
  })

  test.each([
    [{ status: 'ok' }, true],
    [{ ok: true }, true],
    [{ status: 'loading' }, false],
  ])('UT-AI-06: health JSON %j -> ok=%p', async (body, ok) => {
    fetch.mockResolvedValue(textResponse(200, JSON.stringify(body)))
    const result = await createAiClient({ baseUrl: 'http://ai.test' }).health(healthOptions)
    expect(result).toEqual({ ...body, ok })
  })

  test('UT-AI-07: có apiKey -> gửi header Bearer tới /health', async () => {
    fetch.mockResolvedValue(textResponse(200, '{"status":"ok"}'))
    await createAiClient({ baseUrl: 'http://ai.test', apiKey: 'k' }).health(healthOptions)
    expect(fetch).toHaveBeenCalledWith('http://ai.test/health', expect.objectContaining({
      headers: { Authorization: 'Bearer k' },
    }))
  })

  test('UT-AI-08: postJson gửi JSON kèm Content-Type và Authorization', async () => {
    fetch.mockResolvedValue({ ok: true })
    await createAiClient({ baseUrl: 'http://ai.test', apiKey: 'k' }).postJson('/predict', { a: 1 }, { timeoutMs: 1000 })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('http://ai.test/predict')
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer k' },
      body: '{"a":1}',
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  test('UT-AI-09: postForm không có apiKey -> không gửi Authorization, body là FormData', async () => {
    fetch.mockResolvedValue({ ok: true })
    const form = new FormData()
    await createAiClient({ baseUrl: 'http://ai.test' }).postForm('/analyze', form, { timeoutMs: 1000 })
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: {}, body: form })
  })
})

describe('upstreamError', () => {
  test('UT-AI-10: body có detail -> trả detail', async () => {
    expect(await upstreamError({ status: 422, json: async () => ({ detail: 'Thiếu series' }) })).toBe('Thiếu series')
  })
  test('UT-AI-11: body JSON không có detail -> "AI error: <mã>"', async () => {
    expect(await upstreamError({ status: 500, json: async () => ({}) })).toBe('AI error: 500')
  })
  test('UT-AI-12: body không phải JSON -> dùng statusText', async () => {
    const response = { status: 502, statusText: 'Bad Gateway', json: async () => { throw new SyntaxError('x') } }
    expect(await upstreamError(response)).toBe('Bad Gateway')
  })
})
