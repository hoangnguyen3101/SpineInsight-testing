// Vitest cho các hàm thuần của frontend SUT; alias '@' trỏ vào frontend/src của SUT như vite.config.ts.
import path from 'node:path'
import { createRequire } from 'node:module'
import { defineConfig } from 'vitest/config'

const require = createRequire(import.meta.url)
const { frontendDir } = require('./sut.config.cjs')
const src = path.join(frontendDir, 'src')

export default defineConfig({
  resolve: {
    alias: { '@': src, '@sut-fe': src },
  },
  test: {
    include: ['tests/unit/{spatial,frontend}/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      allowExternal: true,
      include: [
        `${src.split(path.sep).join('/')}/features/auth/utils.ts`,
        `${src.split(path.sep).join('/')}/features/viewer/utils/measurement/mathUtils.ts`,
        `${src.split(path.sep).join('/')}/features/viewer/utils/spatialUtils.ts`,
        `${src.split(path.sep).join('/')}/services/responseUtils.ts`,
        `${src.split(path.sep).join('/')}/features/viewer/hooks/viewport/viewportPresentation.ts`,
        `${src.split(path.sep).join('/')}/features/viewer/utils/measurement/measurementCoordinates.ts`,
        `${src.split(path.sep).join('/')}/features/viewer/utils/dicomRenderer.ts`,
        `${src.split(path.sep).join('/')}/features/viewer/domain/spine.ts`,
        `${src.split(path.sep).join('/')}/features/viewer/data/localDicomSession.ts`,
        `${src.split(path.sep).join('/')}/features/viewer/utils/dicomUpload.ts`,
      ],
      reportsDirectory: 'reports/coverage/frontend',
      reporter: ['text', 'text-summary', 'lcov', 'json-summary'],
    },
  },
})
