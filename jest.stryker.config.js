// Jest cho Stryker: chỉ chạy unit test backend (tests/unit/backend), không đo coverage.
const path = require('path')
const base = require('./jest.config.js')

module.exports = {
  ...base,
  roots: [path.join(base.rootDir, 'src'), path.join(__dirname, 'tests', 'unit', 'backend')],
  collectCoverageFrom: undefined,
  coverageReporters: undefined,
}
