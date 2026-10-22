// features/viewer/utils/measurement/mathUtils.ts - giá trị biên (BVA) và phân vùng tương đương cho các phép đo trên ảnh.
// pixelSpacing dạng mảng theo DICOM là [khoảng cách hàng (trục y), khoảng cách cột (trục x)].
import { describe, expect, test } from 'vitest'
import {
  calcPhysicalDistance,
  calcPolygonAreaMM2,
  calcPolygonLengthMM,
  calcShapeMM,
} from '@/features/viewer/utils/measurement/mathUtils'

const p = (x: number, y: number) => ({ x, y })
const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)]

describe('calcPhysicalDistance', () => {
  test('FE-UT-14: hai điểm trùng nhau -> 0', () => {
    expect(calcPhysicalDistance(p(7, 7), p(7, 7), 1)).toBe(0)
  })
  test('FE-UT-15: không truyền pixelSpacing -> dùng mặc định 0,75 mm', () => {
    expect(calcPhysicalDistance(p(0, 0), p(3, 4))).toBeCloseTo(3.75, 10)
  })
  test('FE-UT-16: pixelSpacing [hàng, cột] = [2, 1] -> dy nhân 2, dx nhân 1', () => {
    expect(calcPhysicalDistance(p(0, 0), p(3, 4), [2, 1])).toBeCloseTo(Math.sqrt(3 * 3 + 8 * 8), 10)
  })
  test('FE-UT-17: pixelSpacing = 0 (biên dưới) -> 0', () => {
    expect(calcPhysicalDistance(p(0, 0), p(100, 100), 0)).toBe(0)
  })
})

describe('calcShapeMM', () => {
  test('FE-UT-18: hình chữ nhật -> rộng, cao, diện tích = rộng × cao', () => {
    expect(calcShapeMM(p(0, 0), p(10, 20), 0.5)).toEqual({ widthMM: 5, heightMM: 10, areaMM2: 50 })
  })
  test.each(['ellipse', 'circle'] as const)('FE-UT-19: %s -> diện tích π·(rộng/2)·(cao/2)', (kind) => {
    expect(calcShapeMM(p(0, 0), p(10, 20), 0.5, kind).areaMM2).toBeCloseTo(Math.PI * 2.5 * 5, 10)
  })
  test('FE-UT-20: đảo hai góc -> kích thước không đổi; spacing 0 -> 0', () => {
    expect(calcShapeMM(p(10, 20), p(0, 0), [1, 2])).toEqual(calcShapeMM(p(0, 0), p(10, 20), [1, 2]))
    expect(calcShapeMM(p(0, 0), p(10, 20), 0)).toEqual({ widthMM: 0, heightMM: 0, areaMM2: 0 })
  })
})

describe('calcPolygonLengthMM', () => {
  test.each([[[]], [[p(1, 1)]]])('FE-UT-21: ít hơn 2 điểm %j -> 0', (points) => {
    expect(calcPolygonLengthMM(points, true, 1)).toBe(0)
  })
  test('FE-UT-22: đường gấp khúc mở 30 mm, khép kín cộng thêm cạnh cuối -> 40 mm', () => {
    expect(calcPolygonLengthMM(square, false, 1)).toBe(30)
    expect(calcPolygonLengthMM(square, true, 1)).toBe(40)
  })
  test('FE-UT-23: khép kín nhưng chỉ có 2 điểm -> không cộng cạnh quay về', () => {
    expect(calcPolygonLengthMM([p(0, 0), p(10, 0)], true, 1)).toBe(10)
  })
})

describe('calcPolygonAreaMM2', () => {
  test.each([[[]], [[p(0, 0), p(5, 5)]]])('FE-UT-24: ít hơn 3 điểm %j -> 0', (points) => {
    expect(calcPolygonAreaMM2(points, 1)).toBe(0)
  })
  test('FE-UT-25: hình vuông đơn vị với spacing [2, 3] -> 6 mm²', () => {
    expect(calcPolygonAreaMM2([p(0, 0), p(1, 0), p(1, 1), p(0, 1)], [2, 3])).toBe(6)
  })
  test('FE-UT-26: không phụ thuộc chiều duyệt; đa giác lõm chữ L -> 75', () => {
    expect(calcPolygonAreaMM2([...square].reverse(), 1)).toBe(calcPolygonAreaMM2(square, 1))
    const lShape = [p(0, 0), p(10, 0), p(10, 5), p(5, 5), p(5, 10), p(0, 10)]
    expect(calcPolygonAreaMM2(lShape, 1)).toBe(75)
  })
})
