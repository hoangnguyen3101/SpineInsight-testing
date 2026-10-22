// Chạy Jest với thư mục làm việc là backend của SUT: babel-plugin-istanbul chỉ đo độ bao phủ cho file nằm trong cwd.
const path = require('path')
const { backendDir } = require('../sut.config.cjs')

// SUT không cài jest; NODE_PATH giúp jest-resolve tìm jest-environment-node trong node_modules của repo này.
process.env.NODE_PATH = [path.join(__dirname, '..', 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter)
process.chdir(backendDir)
process.argv.push('--config', path.join(__dirname, '..', 'jest.config.js'))
require('jest/bin/jest')
