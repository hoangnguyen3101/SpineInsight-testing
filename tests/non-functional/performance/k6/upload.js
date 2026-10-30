// Mục đích: Kiểm thử tải lên DICOM qua POST /api/v1/spine/analyze (Multer lưu toàn bộ tệp trong RAM rồi chuyển tiếp sang AI giả).
// Biến môi trường (run.mjs đặt): UPLOAD_MODE=files (FILE_LIST là JSON [{path,name}]) hoặc synthetic (SYNTH_COUNT tệp giả 1 KB),
// VUS, ITERATIONS, EXPECT_STATUS, P95_MS, SUMMARY_PATH. Thân multipart được dựng sẵn một lần cho mỗi VU.
import http from 'k6/http'
import { check } from 'k6'

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3101'
const MODE = __ENV.UPLOAD_MODE || 'synthetic'
const EXPECT = Number(__ENV.EXPECT_STATUS || 200)
const BOUNDARY = `----k6NonFunctional${Date.now()}`

function ascii(text) {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

function syntheticDicom(index) {
  const bytes = new Uint8Array(1024)
  bytes.set(ascii('DICM'), 128)
  bytes[200] = index & 0xff
  return bytes
}

function buildBody() {
  const parts = []
  if (MODE === 'files') {
    for (const file of JSON.parse(__ENV.FILE_LIST)) {
      parts.push({ name: file.name, data: new Uint8Array(open(file.path, 'b')) })
    }
  } else {
    const count = Number(__ENV.SYNTH_COUNT || 1)
    for (let i = 0; i < count; i++) parts.push({ name: `SYNTH/S1/IM${String(i + 1).padStart(4, '0')}.dcm`, data: syntheticDicom(i) })
  }
  const chunks = []
  for (const part of parts) {
    chunks.push(ascii(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="files"; filename="${part.name}"\r\nContent-Type: application/dicom\r\n\r\n`))
    chunks.push(part.data)
    chunks.push(ascii('\r\n'))
  }
  for (const part of parts) {
    chunks.push(ascii(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="relativePaths"\r\n\r\n${part.name}\r\n`))
  }
  chunks.push(ascii(`--${BOUNDARY}--\r\n`))
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.length
  }
  return { body: body.buffer, fileCount: parts.length, bytes: total }
}

const payload = buildBody()

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  scenarios: {
    upload: {
      executor: 'per-vu-iterations',
      vus: Number(__ENV.VUS || 1),
      iterations: Number(__ENV.ITERATIONS || 1),
      maxDuration: '20m',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:spine_analyze}': [`p(95)<${__ENV.P95_MS || 10000}`],
    'http_req_failed{endpoint:spine_analyze}': ['rate<0.01'],
    'http_reqs{endpoint:spine_analyze}': ['count>0'],
    checks: ['rate>0.99'],
  },
}

export default function () {
  const res = http.post(`${BASE}/api/v1/spine/analyze`, payload.body, {
    headers: { 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}` },
    timeout: '900s',
    tags: { endpoint: 'spine_analyze' },
    responseCallback: http.expectedStatuses(EXPECT),
  })
  check(res, { [`status ${EXPECT}`]: (r) => r.status === EXPECT })
}

export function handleSummary(data) {
  data.payload = { fileCount: payload.fileCount, bytes: payload.bytes, mode: MODE, expectStatus: EXPECT }
  return { [__ENV.SUMMARY_PATH || 'k6-upload.json']: JSON.stringify(data, null, 2), stdout: `[k6] upload ${MODE} xong (${payload.fileCount} tệp, ${payload.bytes} byte/request)\n` }
}
