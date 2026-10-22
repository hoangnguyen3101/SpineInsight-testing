// utils/request.js - phân vùng tương đương (EP) và giá trị biên (BVA), xem Test Plan chương 4.
const { toArray, parseJsonArray, paginationFrom } = require('@sut/src/utils/request')

describe('toArray', () => {
  test('UT-REQ-01: mảng -> giữ nguyên tham chiếu', () => {
    const value = ['a', 'b']
    expect(toArray(value)).toBe(value)
  })
  test('UT-REQ-02: một giá trị đơn -> bọc thành mảng 1 phần tử', () => {
    expect(toArray('a.dcm')).toEqual(['a.dcm'])
  })
  test.each([[undefined], [null], ['']])('UT-REQ-03: giá trị rỗng %p -> mảng rỗng', (value) => {
    expect(toArray(value)).toEqual([])
  })
})

describe('parseJsonArray', () => {
  test.each([[undefined], ['']])('UT-REQ-04: chuỗi rỗng/không có %p -> []', (value) => {
    expect(parseJsonArray(value)).toEqual([])
  })
  test('UT-REQ-05: JSON hỏng -> [] (không ném lỗi)', () => {
    expect(parseJsonArray('[{"a":1')).toEqual([])
  })
  test.each([['{"a":1}'], ['"text"'], ['42'], ['null']])('UT-REQ-06: JSON hợp lệ nhưng không phải mảng %s -> []', (value) => {
    expect(parseJsonArray(value)).toEqual([])
  })
  test('UT-REQ-07: mảng JSON hợp lệ -> mảng đã parse', () => {
    expect(parseJsonArray('[{"level":"L4/L5"}]')).toEqual([{ level: 'L4/L5' }])
  })
})

describe('paginationFrom', () => {
  test('UT-REQ-08: không truyền page/perPage -> mặc định page 1, perPage 20', () => {
    expect(paginationFrom({})).toEqual({ page: 1, perPage: 20 })
  })
  test.each([
    ['1', 1], ['99', 99], ['100', 100], ['101', 100], ['1000', 100],
  ])('UT-REQ-09: biên trên perPage=%s -> %i', (perPage, expected) => {
    expect(paginationFrom({ perPage }).perPage).toBe(expected)
  })
  test.each([['0'], ['abc'], ['']])('UT-REQ-10: perPage=%p không hợp lệ -> mặc định 20', (perPage) => {
    expect(paginationFrom({ perPage }).perPage).toBe(20)
  })
  test.each([['0', 1], ['1', 1], ['2', 2], ['abc', 1]])('UT-REQ-11: page=%p -> %i', (page, expected) => {
    expect(paginationFrom({ page }).page).toBe(expected)
  })
  test('UT-REQ-12: perPage dạng "20abc" -> parseInt lấy 20', () => {
    expect(paginationFrom({ perPage: '20abc' }).perPage).toBe(20)
  })

  // BUG-03: không chặn biên dưới, giá trị âm đi thẳng vào .range() của Supabase.
  test.failing('UT-REQ-13 (BUG-03): page=-1 phải được đưa về 1', () => {
    expect(paginationFrom({ page: '-1' }).page).toBe(1)
  })
  test.failing('UT-REQ-14 (BUG-03): perPage=-1 phải nằm trong [1, 100]', () => {
    expect(paginationFrom({ perPage: '-1' }).perPage).toBeGreaterThanOrEqual(1)
  })
})
