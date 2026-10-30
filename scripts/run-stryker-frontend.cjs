// Chạy StrykerJS cho frontend với cwd = frontend của SUT (giống run-stryker.cjs của backend).
// NODE_PATH trỏ về node_modules của repo này để vitest-runner tìm được vitest khi SUT không cài sẵn.
const path = require('path')
const { spawnSync } = require('child_process')
const { frontendDir } = require('../sut.config.cjs')

const root = path.join(__dirname, '..')
const nodeModules = path.join(root, 'node_modules')
const env = {
  ...process.env,
  NODE_PATH: [nodeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
}

const result = spawnSync(
  process.execPath,
  [path.join(nodeModules, '@stryker-mutator', 'core', 'bin', 'stryker.js'), 'run', path.join(root, 'stryker.frontend.config.mjs'), ...process.argv.slice(2)],
  { cwd: frontendDir, env, stdio: 'inherit' },
)
process.exit(result.status ?? 1)
