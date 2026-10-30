// StrykerJS cho frontend SUT (module hình học DICOM, xử lý ảnh, domain). Chạy với cwd = frontend của SUT và inPlace:
// test trong repo này import '@/...' trỏ vào đường dẫn gốc của SUT nên phải đột biến ngay trên file gốc;
// Stryker tự khôi phục file khi kết thúc.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, 'reports', 'mutation-frontend')

export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  vitest: {
    configFile: path.join(here, 'vitest.stryker.config.mjs'),
  },
  coverageAnalysis: 'perTest',
  inPlace: true,
  mutate: [
    'src/features/viewer/utils/spatialUtils.ts',
    'src/features/viewer/utils/measurement/mathUtils.ts',
    'src/features/viewer/utils/measurement/measurementCoordinates.ts',
    'src/features/viewer/hooks/viewport/viewportPresentation.ts',
    'src/features/viewer/utils/dicomRenderer.ts',
    'src/features/auth/utils.ts',
    'src/features/viewer/domain/spine.ts',
    'src/features/viewer/data/localDicomSession.ts',
    'src/features/viewer/utils/dicomUpload.ts',
  ],
  tempDirName: path.join(here, '.stryker-tmp'),
  cleanTempDir: true,
  reporters: ['html', 'clear-text', 'json', 'progress'],
  htmlReporter: { fileName: path.join(outDir, 'mutation.html') },
  jsonReporter: { fileName: path.join(outDir, 'mutation.json') },
  thresholds: { high: 80, low: 60, break: null },
  concurrency: 4,
  timeoutMS: 15000,
}
