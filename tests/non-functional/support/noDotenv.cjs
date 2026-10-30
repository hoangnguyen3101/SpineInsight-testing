// Mục đích: Nạp trước (node -r) khi chạy backend SUT cho kiểm thử phi chức năng.
// 1. Thay module dotenv bằng hàm rỗng để tệp .env thật (khoá, URL dịch vụ) không bao giờ được đọc.
// 2. Nếu có HARNESS_MEMORY_LOG, ghi bộ nhớ tiến trình mỗi 100 ms (CSV: t,rss,heapUsed,external,arrayBuffers).
const Module = require('module')
const fs = require('fs')

const originalLoad = Module._load
Module._load = function load(request, parent, isMain) {
  if (request === 'dotenv') {
    return { config: () => ({ parsed: {} }), parse: () => ({}) }
  }
  return originalLoad.call(this, request, parent, isMain)
}

const memoryLog = process.env.HARNESS_MEMORY_LOG
if (memoryLog) {
  fs.writeFileSync(memoryLog, 't,rss,heapUsed,external,arrayBuffers\n')
  const timer = setInterval(() => {
    const m = process.memoryUsage()
    fs.appendFileSync(memoryLog, `${Date.now()},${m.rss},${m.heapUsed},${m.external},${m.arrayBuffers}\n`)
  }, 100)
  timer.unref()
}
