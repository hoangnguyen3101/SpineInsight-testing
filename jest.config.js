// Jest cho backend: rootDir là backend của SUT để Istanbul đo độ bao phủ trên src/, test nằm trong repo này.
const path = require('path')
const { backendDir } = require('./sut.config.cjs')

const toPosix = (p) => p.split(path.sep).join('/')

module.exports = {
  rootDir: backendDir,
  roots: [
    path.join(backendDir, 'src'),
    path.join(__dirname, 'tests', 'unit', 'backend'),
    path.join(__dirname, 'tests', 'api', 'supertest'),
  ],
  testEnvironment: 'node',
  testMatch: ['**/*.test.js'],
  setupFiles: [path.join(__dirname, 'tests', 'support', 'backend', 'setupEnv.js')],
  moduleNameMapper: {
    '^@sut/(.*)$': `${toPosix(backendDir)}/$1`,
    '^dotenv$': path.join(__dirname, 'tests', 'support', 'backend', 'dotenvStub.js'),
  },
  collectCoverageFrom: ['src/**/*.js', '!src/config/**', '!src/scripts/**', '!src/server.js'],
  coverageDirectory: path.join(__dirname, 'reports', 'coverage', 'backend'),
  coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary'],
}
