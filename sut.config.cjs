// Xác định vị trí mã nguồn SUT (SPINEINSIGHT_AI) cho Jest, Vitest, Stryker và E2E.
const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true })

const sutDir = path.resolve(__dirname, process.env.SUT_DIR || 'sut')
const backendDir = path.join(sutDir, 'backend')
const frontendDir = path.join(sutDir, 'frontend')

if (!fs.existsSync(path.join(backendDir, 'src', 'app.js'))) {
  throw new Error(`[sut.config] Khong tim thay SUT tai ${sutDir}. Dat SUT_DIR trong .env (xem .env.example).`)
}

module.exports = { sutDir, backendDir, frontendDir }
