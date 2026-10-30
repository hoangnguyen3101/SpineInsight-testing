// Mục đích: Kiểm thử tải các API nhẹ của backend SUT (DB và AI là máy chủ giả, nên số liệu đo lớp Express).
// Ba kịch bản chạy nối tiếp: smoke (1 VU), load (tăng 1 -> 20 -> 50 VU, có thời gian nghĩ 0,5 s),
// stress (tăng tới 150 VU, không nghĩ) để tìm điểm suy giảm. Ngưỡng đặt trước khi chạy, xem `thresholds`.
import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3101'
const ADMIN = { email: __ENV.ADMIN_EMAIL, password: __ENV.ADMIN_PASSWORD }
const DOCTOR = { email: __ENV.DOCTOR_EMAIL, password: __ENV.DOCTOR_PASSWORD }
const ENDPOINTS = ['health', 'login', 'me', 'hospitals', 'studies']

function endpointThresholds(scenario, p95, failRate) {
  const result = {}
  for (const endpoint of ENDPOINTS) {
    const limit = endpoint === 'login' ? p95.login : p95.normal
    result[`http_req_duration{scenario:${scenario},endpoint:${endpoint}}`] = [`p(95)<${limit}`]
    result[`http_req_failed{scenario:${scenario},endpoint:${endpoint}}`] = [`rate<${failRate}`]
    result[`http_reqs{scenario:${scenario},endpoint:${endpoint}}`] = ['count>0']
  }
  result[`http_reqs{scenario:${scenario}}`] = ['count>0']
  result[`http_req_failed{scenario:${scenario}}`] = [`rate<${failRate}`]
  return result
}

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  scenarios: {
    smoke: { executor: 'constant-vus', vus: 1, duration: '10s', exec: 'mixed', env: { THINK: '0.5' } },
    load: {
      executor: 'ramping-vus',
      startTime: '12s',
      startVUs: 1,
      stages: [
        { duration: '20s', target: 20 },
        { duration: '30s', target: 20 },
        { duration: '20s', target: 50 },
        { duration: '40s', target: 50 },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
      exec: 'mixed',
      env: { THINK: '0.5' },
    },
    stress: {
      executor: 'ramping-vus',
      startTime: '140s',
      startVUs: 10,
      stages: [
        { duration: '20s', target: 150 },
        { duration: '30s', target: 150 },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
      exec: 'mixed',
      env: { THINK: '0' },
    },
  },
  thresholds: {
    // Ngưỡng đạt/không đạt: smoke không lỗi; load (tới 50 VU) p95 < 300 ms cho GET, < 500 ms cho đăng nhập, lỗi < 1%.
    ...endpointThresholds('smoke', { normal: 300, login: 500 }, 0.001),
    ...endpointThresholds('load', { normal: 300, login: 500 }, 0.01),
    // stress chỉ để quan sát, ngưỡng rộng để số liệu xuất hiện trong báo cáo.
    ...endpointThresholds('stress', { normal: 60000, login: 60000 }, 1.01),
    checks: ['rate>0.99'],
  },
}

function login(account) {
  const res = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify(account), {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'setup_login' },
  })
  if (res.status !== 200) throw new Error(`setup: đăng nhập ${account.email} lỗi ${res.status}`)
  return res.json('data.accessToken')
}

export function setup() {
  return { admin: login(ADMIN), doctor: login(DOCTOR) }
}

const auth = (token) => ({ Authorization: `Bearer ${token}` })

export function mixed(data) {
  const health = http.get(`${BASE}/health`, { tags: { endpoint: 'health' } })
  const me = http.get(`${BASE}/api/v1/auth/me`, { headers: auth(data.doctor), tags: { endpoint: 'me' } })
  const hospitals = http.get(`${BASE}/api/v1/hospitals`, { headers: auth(data.admin), tags: { endpoint: 'hospitals' } })
  const studies = http.get(`${BASE}/api/v1/studies?page=${1 + (__ITER % 7)}&perPage=20`, { tags: { endpoint: 'studies' } })
  check(health, { 'health 200': (r) => r.status === 200 })
  check(me, { 'me 200': (r) => r.status === 200 })
  check(hospitals, { 'hospitals 200': (r) => r.status === 200 })
  check(studies, { 'studies 200': (r) => r.status === 200 })
  if (__ITER % 5 === 0) {
    const res = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify(DOCTOR), {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'login' },
    })
    check(res, { 'login 200': (r) => r.status === 200 })
  }
  const think = Number(__ENV.THINK || 0)
  if (think > 0) sleep(think)
}

export function handleSummary(data) {
  return { [__ENV.SUMMARY_PATH || 'k6-api-load.json']: JSON.stringify(data, null, 2), stdout: `[k6] api-load xong, ${data.metrics.http_reqs.values.count} request\n` }
}
