// Kiểm thử dựa trên tính chất (property-based) với fast-check cho các phép đo và biến đổi toạ độ.
import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import type { DicomMetadata } from '@/features/viewer/types'
import { calcPhysicalDistance, calcPolygonAreaMM2, calcShapeMM } from '@/features/viewer/utils/measurement/mathUtils'
import { pixelToWorld, worldToPixel } from '@/features/viewer/utils/spatialUtils'

const NUM_RUNS = 500
const coord = fc.integer({ min: -10_000, max: 10_000 })
const point = fc.record({ x: coord, y: coord })
const positive = fc.double({ min: 0.01, max: 10, noNaN: true })
const spacing = fc.oneof(positive, fc.tuple(positive, positive))

describe('Tính chất của phép đo', () => {
  test('FE-PBT-01: khoảng cách luôn không âm và đối xứng', () => {
    fc.assert(fc.property(point, point, spacing, (a, b, s) => {
      const d = calcPhysicalDistance(a, b, s)
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBe(calcPhysicalDistance(b, a, s))
    }), { numRuns: NUM_RUNS })
  })

  test('FE-PBT-02: bất đẳng thức tam giác d(a,c) ≤ d(a,b) + d(b,c)', () => {
    fc.assert(fc.property(point, point, point, spacing, (a, b, c, s) => {
      const direct = calcPhysicalDistance(a, c, s)
      const detour = calcPhysicalDistance(a, b, s) + calcPhysicalDistance(b, c, s)
      expect(direct).toBeLessThanOrEqual(detour + 1e-9 * Math.max(1, detour))
    }), { numRuns: NUM_RUNS })
  })

  test('FE-PBT-03: diện tích đa giác không đổi khi tịnh tiến', () => {
    const exactSpacing = fc.constantFrom(0.5, 1, 2)
    fc.assert(fc.property(fc.array(point, { minLength: 3, maxLength: 8 }), point, exactSpacing, (polygon, shift, s) => {
      const moved = polygon.map(({ x, y }) => ({ x: x + shift.x, y: y + shift.y }))
      expect(calcPolygonAreaMM2(moved, s)).toBeCloseTo(calcPolygonAreaMM2(polygon, s), 6)
    }), { numRuns: NUM_RUNS })
  })

  test('FE-PBT-04: hình chữ nhật có diện tích = rộng × cao ≥ 0, ellipse = π/4 × rộng × cao', () => {
    fc.assert(fc.property(point, point, spacing, (a, b, s) => {
      const rect = calcShapeMM(a, b, s, 'rectangle')
      expect(rect.widthMM).toBeGreaterThanOrEqual(0)
      expect(rect.heightMM).toBeGreaterThanOrEqual(0)
      expect(rect.areaMM2).toBeCloseTo(rect.widthMM * rect.heightMM, 6)
      expect(calcShapeMM(a, b, s, 'ellipse').areaMM2).toBeCloseTo((Math.PI / 4) * rect.widthMM * rect.heightMM, 6)
    }), { numRuns: NUM_RUNS })
  })
})

describe('Tính chất của biến đổi toạ độ', () => {
  // Hướng cơ sở axial/sagittal/coronal, xoay thêm một góc ngẫu nhiên trong mặt phẳng ảnh: vẫn trực chuẩn.
  const BASES: Array<[number[], number[]]> = [
    [[1, 0, 0], [0, 1, 0]],
    [[0, 1, 0], [0, 0, -1]],
    [[1, 0, 0], [0, 0, -1]],
  ]
  const orientation = fc.tuple(fc.integer({ min: 0, max: 2 }), fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }))
    .map(([index, angle]) => {
      const [r, c] = BASES[index]
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const rowCos = r.map((v, i) => cos * v + sin * c[i])
      const colCos = c.map((v, i) => -sin * r[i] + cos * v)
      return [...rowCos, ...colCos]
    })
  const position = fc.tuple(...[0, 1, 2].map(() => fc.double({ min: -500, max: 500, noNaN: true })))

  test('FE-PBT-05: pixel -> thế giới -> pixel trả lại đúng (sai số < 1e-6)', () => {
    fc.assert(fc.property(
      orientation, position, fc.tuple(positive, positive),
      fc.double({ min: 0, max: 1024, noNaN: true }), fc.double({ min: 0, max: 1024, noNaN: true }),
      (iop, ipp, ps, row, col) => {
        const m = { imageOrientationPatient: iop, imagePositionPatient: ipp, pixelSpacing: ps } as DicomMetadata
        const back = worldToPixel(pixelToWorld(row, col, m)!, m)!
        expect(Math.abs(back.row - row)).toBeLessThan(1e-6)
        expect(Math.abs(back.col - col)).toBeLessThan(1e-6)
      },
    ), { numRuns: NUM_RUNS })
  })
})
