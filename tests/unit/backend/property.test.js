// Kiểm thử dựa trên tính chất (property-based) với fast-check cho utils/request.js và mappers/spineMapper.js.
const fc = require('fast-check')
const { toArray, parseJsonArray, paginationFrom } = require('@sut/src/utils/request')
const { toSpineResultDto } = require('@sut/src/mappers/spineMapper')

const integerString = fc.integer({ min: -1_000_000, max: 1_000_000 }).map(String)
const hasSnakeCaseKey = (object) => Object.keys(object).some((key) => key.includes('_'))

describe('Tính chất của paginationFrom', () => {
  test('UT-PBT-01: với mọi chuỗi số nguyên, perPage không vượt quá trần 100', () => {
    fc.assert(fc.property(integerString, integerString, (page, perPage) => {
      expect(paginationFrom({ page, perPage }).perPage).toBeLessThanOrEqual(100)
    }))
  })

  // BUG-03: fast-check thu gọn được phản ví dụ nhỏ nhất ["0","-1"] (page "0" -> 1 hợp lệ, perPage "-1" -> -1).
  test.failing('UT-PBT-02 (BUG-03): với mọi chuỗi số nguyên, page >= 1 và 1 <= perPage', () => {
    fc.assert(fc.property(integerString, integerString, (page, perPage) => {
      const result = paginationFrom({ page, perPage })
      expect(result.page).toBeGreaterThanOrEqual(1)
      expect(result.perPage).toBeGreaterThanOrEqual(1)
    }))
  })
})

describe('Tính chất của toArray và parseJsonArray', () => {
  test('UT-PBT-03: toArray luôn trả mảng và giữ nguyên tham chiếu khi đầu vào đã là mảng', () => {
    fc.assert(fc.property(fc.anything(), (value) => {
      expect(Array.isArray(toArray(value))).toBe(true)
    }))
    fc.assert(fc.property(fc.array(fc.anything()), (array) => {
      expect(toArray(array)).toBe(array)
    }))
  })

  test('UT-PBT-04: parseJsonArray là nghịch đảo của JSON.stringify trên mảng JSON', () => {
    fc.assert(fc.property(fc.array(fc.jsonValue()), (array) => {
      const text = JSON.stringify(array)
      expect(parseJsonArray(text)).toEqual(JSON.parse(text))
    }))
  })
})

describe('Tính chất của toSpineResultDto', () => {
  const coordinate = fc.record({
    study_id: fc.integer(), series_id: fc.string(), instance_number: fc.nat(),
    x: fc.double({ noNaN: true }), y: fc.double({ noNaN: true }), level: fc.constantFrom('L1/L2', 'L4/L5', 'L5/S1'),
  })
  const severity = fc.record({
    normal_mild: fc.double({ min: 0, max: 1, noNaN: true }), moderate: fc.double({ min: 0, max: 1, noNaN: true }),
    severe: fc.double({ min: 0, max: 1, noNaN: true }), predicted_label: fc.constantFrom('normal_mild', 'moderate', 'severe'),
  })
  const aiResponse = fc.record({
    study_id: fc.oneof(fc.integer(), fc.string()),
    series_mapping: fc.dictionary(fc.string(), fc.string()),
    coordinates: fc.array(coordinate, { maxLength: 30 }),
    severity: fc.array(severity, { maxLength: 30 }),
  })

  test('UT-PBT-05: không còn khoá snake_case ở mọi cấp, giữ nguyên số phần tử và giá trị', () => {
    fc.assert(fc.property(aiResponse, (data) => {
      const dto = toSpineResultDto(data)
      expect(hasSnakeCaseKey(dto)).toBe(false)
      expect(dto.coordinates.some(hasSnakeCaseKey)).toBe(false)
      expect(dto.severity.some(hasSnakeCaseKey)).toBe(false)
      expect(dto.coordinates).toHaveLength(data.coordinates.length)
      expect(dto.severity).toHaveLength(data.severity.length)
      expect(dto.studyId).toBe(data.study_id)
      dto.coordinates.forEach((item, i) => expect(item.instanceNumber).toBe(data.coordinates[i].instance_number))
      dto.severity.forEach((item, i) => expect(item.predictedLabel).toBe(data.severity[i].predicted_label))
    }))
  })
})
