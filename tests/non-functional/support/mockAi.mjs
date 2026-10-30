// Mục đích: Máy chủ AI giả (RSNA và P2VG) cho kiểm thử phi chức năng. Nhận và bỏ phần thân tải lên (chỉ đếm byte),
// trả JSON đúng định dạng mà spineMapper/p2vgMapper đọc, với độ trễ cấu hình được để mô phỏng thời gian suy luận.
import http from 'node:http'

const RESULT = {
  study_id: 1001,
  series_mapping: { sagittal_t1: 'S3', sagittal_t2: 'S4', axial_t2: 'S1' },
  coordinates: [{ study_id: 1001, series_id: 'S3', instance_number: 8, level: 'L4/L5', x: 512, y: 480 }],
  severity: [{ level: 'L4/L5', condition: 'spinal_canal_stenosis', normal_mild: 0.7, moderate: 0.2, severe: 0.1, predicted_label: 'normal_mild' }],
  report: 'FINDINGS: mock. IMPRESSION: mock.',
  prompt_used: 'mock prompt',
  series_detected: ['S3', 'S4'],
  processing_time_ms: 10,
}

export function createMockAi({ latencyMs = 0 } = {}) {
  const stats = { uploads: 0, uploadBytes: 0, maxUploadBytes: 0, requests: 0 }

  const server = http.createServer((req, res) => {
    stats.requests++
    let bytes = 0
    req.on('data', (chunk) => { bytes += chunk.length })
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost')
      const json = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      const later = (fn) => (latencyMs > 0 ? setTimeout(fn, latencyMs) : fn())

      if (req.method === 'GET' && url.pathname === '/health') return json(200, { status: 'ok', model: 'mock' })
      if (req.method === 'POST' && (url.pathname === '/predict/analyze' || url.pathname === '/predict/clinical' || url.pathname.startsWith('/api/v1/report/'))) {
        stats.uploads++
        stats.uploadBytes += bytes
        stats.maxUploadBytes = Math.max(stats.maxUploadBytes, bytes)
        return later(() => json(200, RESULT))
      }
      if (req.method === 'GET' && url.pathname === '/patients') return json(200, { patients: [{ id: 'P1' }] })
      if (req.method === 'GET' && url.pathname === '/patients/P1/series') return json(200, { series: [{ id: 'S1', file_count: 2 }] })
      if (req.method === 'GET' && url.pathname === '/patients/P1/series/S1/files') return json(200, { files: ['IM0001.dcm', 'IM0002.dcm'] })
      if (req.method === 'GET' && /^\/patients\/P1\/series\/S1\/files\/IM000[12]\.dcm$/.test(url.pathname)) {
        const body = Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), Buffer.alloc(1024)])
        res.writeHead(200, { 'Content-Type': 'application/dicom', 'Content-Length': body.length })
        return res.end(body)
      }
      return json(404, { detail: 'Not found' })
    })
  })

  return {
    stats,
    listen: (port, host = '127.0.0.1') => new Promise((resolve) => server.listen(port, host, resolve)),
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.()
      server.close(() => resolve())
    }),
  }
}
