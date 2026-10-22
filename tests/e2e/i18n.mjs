// Mục đích: Nạp chuỗi giao diện tiếng Anh/tiếng Việt của SUT để kịch bản không phụ thuộc ngôn ngữ đang chọn.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const { frontendDir } = createRequire(import.meta.url)('../../sut.config.cjs')

const load = (lang) => JSON.parse(readFileSync(path.join(frontendDir, 'src', 'i18n', `${lang}.json`), 'utf8'))

export const en = load('en')
export const vi = load('vi')

/** Các bản dịch có thể có của một khoá, đã thay tham số {name} (giá trị tính theo từng từ điển). */
export function translations(key, params = {}) {
  return [en, vi].map((dict) => {
    const template = key.split('.').reduce((node, part) => node?.[part], dict)
    return Object.entries(params).reduce((text, [name, value]) => text.split(`{${name}}`).join(value(dict)), template)
  })
}
