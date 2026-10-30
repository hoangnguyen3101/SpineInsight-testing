// Vitest cho StrykerJS frontend: Stryker chạy với cwd = frontend của SUT nên phải đặt root về repo này để tìm test.
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const { frontendDir } = require('./sut.config.cjs')
const src = path.join(frontendDir, 'src')

export default defineConfig({
  root: here,
  resolve: {
    alias: { '@': src, '@sut-fe': src },
  },
  test: {
    include: ['tests/unit/{spatial,frontend}/**/*.test.ts'],
    environment: 'node',
  },
})
