// Chạy StrykerJS với cwd = backend của SUT (giống run-jest.cjs). NODE_PATH trỏ về node_modules của repo này
// để jest-runner tìm được jest/jest-environment-node khi SUT không cài sẵn jest.
const path = require('path')
const { spawnSync } = require('child_process')
const { backendDir } = require('../sut.config.cjs')

const root = path.join(__dirname, '..')
const nodeModules = path.join(root, 'node_modules')
const env = {
  ...process.env,
  NODE_PATH: [nodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
}

const result = spawnSync(
  process.execPath,
  [path.join(nodeModules, '@stryker-mutator', 'core', 'bin', 'stryker.js'), 'run', path.join(root, 'stryker.config.mjs'), ...process.argv.slice(2)],
  { cwd: backendDir, env, stdio: 'inherit' },
)
process.exit(result.status ?? 1)
