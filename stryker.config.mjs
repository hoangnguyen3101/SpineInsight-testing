// StrykerJS cho backend SUT. Chạy với cwd = backend của SUT và inPlace: test trong repo này import '@sut/...'
// (đường dẫn gốc của SUT) nên phải đột biến ngay trên file gốc; Stryker tự khôi phục file khi kết thúc.
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, 'reports', 'mutation')

export default {
  packageManager: 'npm',
  testRunner: 'jest',
  jest: {
    projectType: 'custom',
    configFile: path.join(here, 'jest.stryker.config.js'),
  },
  coverageAnalysis: 'perTest',
  inPlace: true,
  mutate: ['src/utils/**/*.js', 'src/mappers/**/*.js', 'src/middlewares/**/*.js'],
  tempDirName: path.join(here, '.stryker-tmp'),
  cleanTempDir: true,
  reporters: ['html', 'clear-text', 'json', 'progress'],
  htmlReporter: { fileName: path.join(outDir, 'mutation.html') },
  jsonReporter: { fileName: path.join(outDir, 'mutation.json') },
  thresholds: { high: 80, low: 60, break: null },
  concurrency: 4,
  timeoutMS: 10000,
}
