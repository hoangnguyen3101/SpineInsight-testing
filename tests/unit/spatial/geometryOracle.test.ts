// spatialUtils.ts và mathUtils.ts đối chiếu với một cài đặt tham chiếu độc lập (oracle) viết lại từ công thức DICOM
// PS3.3 C.7.6.2.1.1: P = IPP + cột × ΔX × hướng hàng + hàng × ΔY × hướng cột. Dùng mặt phẳng nghiêng bất kỳ và toạ độ
// lệch gốc để mọi thành phần của công thức đều tham gia; các mặt phẳng trục chuẩn (axial, sagittal) làm triệt tiêu số hạng.
import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import type { DicomMetadata } from '@/features/viewer/types'
import {
  computePlaneEquation,
  computePlaneNormal,
  findClosestSlice,
  intersectPlanes,
  pixelToWorld,
  projectLineToViewport,
  worldToPixel,
} from '@/features/viewer/utils/spatialUtils'
import { calcPolygonAreaMM2, calcPolygonLengthMM, calcShapeMM } from '@/features/viewer/utils/measurement/mathUtils'

type Vec3 = [number, number, number]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = (a: Vec3) => Math.sqrt(dot(a, a))
const unit = (a: Vec3): Vec3 => mul(a, 1 / norm(a))

// Ma trận quay R = Rz(a)·Ry(b)·Rx(c); cột 0 là hướng hàng, cột 1 là hướng cột (trực chuẩn).
function orientation(a: number, b: number, c: number): { rowCos: Vec3; colCos: Vec3 } {
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)]
  const r = [
    [ca * cb, ca * sb * sc - sa * cc, ca * sb * cc + sa * sc],
    [sa * cb, sa * sb * sc + ca * cc, sa * sb * cc - ca * sc],
    [-sb, cb * sc, cb * cc],
  ]
  return { rowCos: [r[0][0], r[1][0], r[2][0]], colCos: [r[0][1], r[1][1], r[2][1]] }
}

function meta(ipp: Vec3, angles: [number, number, number], ps: [number, number], extra: Partial<DicomMetadata> = {}) {
  const { rowCos, colCos } = orientation(...angles)
  return {
    imagePositionPatient: ipp, imageOrientationPatient: [...rowCos, ...colCos], pixelSpacing: ps,
    rows: 120, columns: 200, ...extra,
  } as unknown as DicomMetadata
}

// Oracle theo công thức DICOM.
function refPixelToWorld(row: number, col: number, m: DicomMetadata): Vec3 {
  const iop = m.imageOrientationPatient as number[]
  const rowCos = iop.slice(0, 3) as Vec3
  const colCos = iop.slice(3, 6) as Vec3
  const [rowSpacing, colSpacing] = m.pixelSpacing as number[]
  return add(add(m.imagePositionPatient as Vec3, mul(rowCos, col * colSpacing)), mul(colCos, row * rowSpacing))
}
function refWorldToPixel(p: Vec3, m: DicomMetadata) {
  const iop = m.imageOrientationPatient as number[]
  const d = sub(p, m.imagePositionPatient as Vec3)
  const [rowSpacing, colSpacing] = m.pixelSpacing as number[]
  return { row: dot(d, iop.slice(3, 6) as Vec3) / rowSpacing, col: dot(d, iop.slice(0, 3) as Vec3) / colSpacing }
}
const refNormal = (m: DicomMetadata) => {
  const iop = m.imageOrientationPatient as number[]
  return cross(iop.slice(0, 3) as Vec3, iop.slice(3, 6) as Vec3)
}

const OBLIQUE = meta([-12.5, 37.25, 81.75], [0.3, 0.5, 0.7], [0.45, 0.8])

describe('Biến đổi pixel <-> toạ độ bệnh nhân trên mặt phẳng nghiêng', () => {
  test.each([
    [0, 0], [119, 199], [37, 123], [80, 5],
  ])('FE-UT-101: pixel (hàng %i, cột %i) khớp oracle DICOM theo cả hai chiều', (row, col) => {
    const world = pixelToWorld(row, col, OBLIQUE)!
    const expected = refPixelToWorld(row, col, OBLIQUE)
    world.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 9))
    const back = worldToPixel(expected, OBLIQUE)!
    expect(back.row).toBeCloseTo(row, 9)
    expect(back.col).toBeCloseTo(col, 9)
  })

  test('FE-UT-102: pháp tuyến = hướng hàng × hướng cột, d = pháp tuyến · IPP; thiếu hoặc thiếu phần tử IPP -> null', () => {
    const normal = computePlaneNormal(OBLIQUE)!
    refNormal(OBLIQUE).forEach((v, i) => expect(normal[i]).toBeCloseTo(v, 12))
    const plane = computePlaneEquation(OBLIQUE)!
    expect(plane.d).toBeCloseTo(dot(refNormal(OBLIQUE), [-12.5, 37.25, 81.75]), 9)
    expect(computePlaneEquation({ ...OBLIQUE, imagePositionPatient: undefined } as unknown as DicomMetadata)).toBeNull()
    expect(computePlaneEquation({ ...OBLIQUE, imagePositionPatient: [1, 2] } as unknown as DicomMetadata)).toBeNull()
  })
})

describe('Giao tuyến hai mặt phẳng', () => {
  test.each([
    ['thành phần z trội', [1, 0.2, 0.1], [0.3, 1, 0.2]],
    ['thành phần y trội', [1, 0.1, 0.2], [0.2, 0.3, 1]],
    ['thành phần x trội', [0.1, 1, 0.2], [0.3, 0.2, 1]],
  ] as const)('FE-UT-103: %s -> điểm nằm trên cả hai mặt phẳng, hướng đơn vị song song n1 × n2', (_name, a, b) => {
    const n1 = unit([...a] as Vec3)
    const n2 = unit([...b] as Vec3)
    const line = intersectPlanes({ normal: n1, d: 12.3 }, { normal: n2, d: -7.9 })!
    expect(dot(n1, line.point as Vec3)).toBeCloseTo(12.3, 9)
    expect(dot(n2, line.point as Vec3)).toBeCloseTo(-7.9, 9)
    expect(norm(line.direction as Vec3)).toBeCloseTo(1, 12)
    expect(Math.abs(dot(line.direction as Vec3, unit(cross(n1, n2))))).toBeCloseTo(1, 12)
  })
  test('FE-UT-103b: hai mặt phẳng song song (cùng hoặc ngược pháp tuyến) -> null', () => {
    const n = unit([0.2, 0.5, 0.8])
    expect(intersectPlanes({ normal: n, d: 1 }, { normal: n, d: 5 })).toBeNull()
    expect(intersectPlanes({ normal: n, d: 1 }, { normal: mul(n, -1), d: 5 })).toBeNull()
  })
})

describe('Chiếu đường thẳng lên khung ảnh (đường tham chiếu)', () => {
  const m = OBLIQUE
  const iop = m.imageOrientationPatient as number[]
  const rowCos = iop.slice(0, 3) as Vec3
  const colCos = iop.slice(3, 6) as Vec3
  const normal = refNormal(m)

  // Đường cuối đi qua pixel (hàng 0, cột 150): vào ảnh từ biên dưới rồi ra ở biên phải, không đi qua cột 0.
  test.each([
    [1, 0.3, 40, 60], [0.2, 1, 40, 60], [1, -0.7, 40, 60], [-0.4, 1, 40, 60], [1, 0.28125, 0, 150],
  ])('FE-UT-104: hướng (%d theo hàng, %d theo cột) qua pixel (%i, %i) -> đầu mút thẳng hàng với hình chiếu, trong ảnh, chạm biên', (a, b, row, col) => {
    const start = add(refPixelToWorld(row, col, m), mul(normal, 7))
    const dir = add(add(mul(rowCos, a), mul(colCos, b)), mul(normal, 0.3))
    const result = projectLineToViewport({ point: start, direction: dir }, m)!
    const p = refWorldToPixel(start, m)
    const q = refWorldToPixel(add(start, dir), m)
    const [vx, vy] = [q.col - p.col, q.row - p.row]
    for (const end of [result.start, result.end]) {
      const distance = Math.abs((end.col - p.col) * vy - (end.row - p.row) * vx) / Math.hypot(vx, vy)
      expect(distance).toBeLessThan(1e-6)
      expect(end.col).toBeGreaterThanOrEqual(-1e-9)
      expect(end.col).toBeLessThanOrEqual(m.columns - 1 + 1e-9)
      expect(end.row).toBeGreaterThanOrEqual(-1e-9)
      expect(end.row).toBeLessThanOrEqual(m.rows - 1 + 1e-9)
      const onBorder = Math.min(Math.abs(end.col), Math.abs(end.col - (m.columns - 1)), Math.abs(end.row), Math.abs(end.row - (m.rows - 1)))
      expect(onBorder).toBeLessThan(1e-6)
    }
    expect(Math.hypot(result.start.col - result.end.col, result.start.row - result.end.row)).toBeGreaterThan(1)
  })

  // Biên của vùng ảnh: cột hợp lệ 0..columns-1, hàng hợp lệ 0..rows-1. Đường chỉ chạm cột = columns (hoặc hàng = rows)
  // từ phía ngoài thì không có phần nào nằm trong ảnh.
  const axial = { imagePositionPatient: [0, 0, 0], imageOrientationPatient: [1, 0, 0, 0, 1, 0], pixelSpacing: [1, 1], rows: 100, columns: 200 } as unknown as DicomMetadata
  test.each([
    ['chạm cột 200 (= columns)', [2700, 3800, 0], [0.5, 0.75, 0]],
    ['chạm hàng 100 (= rows)', [3870, 2600, 0], [0.75, 0.5, 0]],
  ] as const)('FE-UT-105: đường thẳng nằm ngoài ảnh, %s -> null (BVA biên phải/dưới)', (_name, point, direction) => {
    expect(projectLineToViewport({ point: [...point] as Vec3, direction: [...direction] as Vec3 }, axial)).toBeNull()
  })
})

describe('Tìm lát gần nhất trên chuỗi nghiêng', () => {
  const m = meta([-12.5, 37.25, 81.75], [0.3, 0.5, 0.7], [0.45, 0.8], { spacingBetweenSlices: 3.3 })
  const normal = refNormal(m)
  const inPlane = refPixelToWorld(55, 17, m)

  test.each([
    [2.2, 7], [-1.6, 3], [0.2, null], [40, 19], [-40, 0],
  ])('FE-UT-106: điểm lệch %d khoảng cách lát theo pháp tuyến (cộng dịch trong mặt phẳng), lát hiện tại 5/20 -> %o', (k, expected) => {
    const point = add(inPlane, mul(normal, k * 3.3))
    expect(findClosestSlice(point, m, 5, 20)).toBe(expected)
  })
  test('FE-UT-106b: IPP thiếu phần tử -> null', () => {
    expect(findClosestSlice([1, 2, 3], { ...m, imagePositionPatient: [1, 2] } as unknown as DicomMetadata, 5, 20)).toBeNull()
  })
})

describe('Đo đạc với toạ độ lệch gốc', () => {
  test('FE-UT-107: hình chữ nhật (10,20)-(40,60), spacing [hàng 0,5; cột 0,25] -> 7,5 × 20 mm, 150 mm²', () => {
    expect(calcShapeMM({ x: 10, y: 20 }, { x: 40, y: 60 }, [0.5, 0.25])).toEqual({ widthMM: 7.5, heightMM: 20, areaMM2: 150 })
  })
  test('FE-UT-108: tam giác (biên 3 điểm) -> chu vi khép kín cộng cạnh quay về; diện tích 600', () => {
    const triangle = [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 10, y: 50 }]
    expect(calcPolygonLengthMM(triangle, true, 1)).toBeCloseTo(120, 10)
    expect(calcPolygonLengthMM(triangle, false, 1)).toBeCloseTo(80, 10)
    expect(calcPolygonAreaMM2(triangle, 1)).toBeCloseTo(600, 10)
  })
})

describe('Tính chất (fast-check)', () => {
  test('FE-PBT-10: hướng lát cắt, vị trí, spacing ngẫu nhiên -> khớp oracle DICOM; giao tuyến nằm trên cả hai mặt phẳng', () => {
    const angle = fc.double({ min: -Math.PI, max: Math.PI, noNaN: true })
    const pos = fc.double({ min: -300, max: 300, noNaN: true })
    const spacing = fc.double({ min: 0.1, max: 5, noNaN: true })
    fc.assert(fc.property(
      fc.tuple(angle, angle, angle), fc.tuple(angle, angle, angle), fc.tuple(pos, pos, pos),
      fc.tuple(spacing, spacing), fc.integer({ min: 0, max: 511 }), fc.integer({ min: 0, max: 511 }),
      (anglesA, anglesB, ipp, ps, row, col) => {
        const a = meta(ipp, anglesA, ps)
        const world = pixelToWorld(row, col, a)!
        const expected = refPixelToWorld(row, col, a)
        world.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6))
        const back = worldToPixel(expected, a)!
        expect(back.row).toBeCloseTo(row, 6)
        expect(back.col).toBeCloseTo(col, 6)

        const b = meta([0, 0, 0], anglesB, ps)
        const pa = computePlaneEquation(a)!
        const pb = computePlaneEquation(b)!
        if (norm(cross(pa.normal as Vec3, pb.normal as Vec3)) < 1e-3) return
        const line = intersectPlanes(pa, pb)!
        expect(dot(pa.normal as Vec3, line.point as Vec3)).toBeCloseTo(pa.d, 4)
        expect(dot(pb.normal as Vec3, line.point as Vec3)).toBeCloseTo(pb.d, 4)
        expect(norm(line.direction as Vec3)).toBeCloseTo(1, 9)
      },
    ), { numRuns: 300 })
  })
})
