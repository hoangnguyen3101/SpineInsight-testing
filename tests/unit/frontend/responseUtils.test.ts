// services/responseUtils.ts - phân vùng tương đương cho các hàm chuẩn hoá phản hồi từ AI server.
import { describe, expect, test } from 'vitest'
import { isRecord, toNumber, toString } from '@/services/responseUtils'

describe('isRecord', () => {
  test.each([
    [{}, true],
    [{ study_id: 1 }, true],
    [null, false],
    [undefined, false],
    ['{"a":1}', false],
    [42, false],
  ])('FE-UT-07: isRecord(%o) -> %o', (value, expected) => {
    expect(isRecord(value)).toBe(expected)
  })

  // Ghi nhận: mảng cũng là object nên được coi là record; nơi gọi chỉ đọc thuộc tính nên không gây lỗi.
  test('FE-UT-08: mảng được coi là record (typeof object)', () => {
    expect(isRecord([1, 2])).toBe(true)
  })
})

describe('toNumber', () => {
  test.each([
    [5, 5],
    [-1.5, -1.5],
    ['42', 42],
    ['3.5', 3.5],
    [true, 1],
  ])('FE-UT-09: toNumber(%o) -> %o', (value, expected) => {
    expect(toNumber(value)).toBe(expected)
  })

  test.each([[NaN], [Infinity], [-Infinity], ['abc'], [undefined], [{}]])(
    'FE-UT-10: toNumber(%o) không hữu hạn -> fallback', (value) => {
      expect(toNumber(value)).toBe(0)
      expect(toNumber(value, -1)).toBe(-1)
    })

  // Ghi nhận: theo ngữ nghĩa Number(), null và chuỗi rỗng thành 0 chứ không dùng fallback.
  test.each([[null], ['']])('FE-UT-11: toNumber(%o, 7) -> 0 theo Number()', (value) => {
    expect(toNumber(value, 7)).toBe(0)
  })
})

describe('toString', () => {
  test.each([['L4/L5'], ['']])('FE-UT-12: chuỗi %o giữ nguyên', (value) => {
    expect(toString(value, 'x')).toBe(value)
  })
  test.each([[5], [null], [undefined], [['a']]])('FE-UT-13: toString(%o) không phải chuỗi -> fallback', (value) => {
    expect(toString(value)).toBe('')
    expect(toString(value, 'N/A')).toBe('N/A')
  })
})
