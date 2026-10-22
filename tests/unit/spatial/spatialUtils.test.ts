// features/viewer/utils/spatialUtils.ts - kiểm thử hộp trắng theo nhánh (thiếu metadata, mặt phẳng song song,
// cắt biên ảnh) và giá trị biên cho findClosestSlice. Toạ độ theo DICOM PS3.3 C.7.6.2.1.1.
import { describe, expect, test } from 'vitest'
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

const meta = (overrides: Partial<DicomMetadata> = {}) => ({
  imagePositionPatient: [-100, -100, 50],
  imageOrientationPatient: [1, 0, 0, 0, 1, 0],
  pixelSpacing: [0.5, 0.8],
  rows: 100,
  columns: 200,
  sliceThickness: 4,
  spacingBetweenSlices: 0,
  ...overrides,
}) as DicomMetadata

const axial = meta()
const sagittal = meta({ imagePositionPatient: [10, -100, 100], imageOrientationPatient: [0, 1, 0, 0, 0, -1] })

describe('pixelToWorld / worldToPixel', () => {
  test.each([
    ['thiếu imagePositionPatient', { imagePositionPatient: [1, 2] }],
    ['thiếu imageOrientationPatient', { imageOrientationPatient: [1, 0, 0] }],
    ['thiếu pixelSpacing', { pixelSpacing: undefined }],
  ])('FE-UT-27: %s -> null', (_name, overrides) => {
    const m = meta(overrides as Partial<DicomMetadata>)
    expect(pixelToWorld(0, 0, m)).toBeNull()
    expect(worldToPixel([0, 0, 0], m)).toBeNull()
    expect(projectLineToViewport({ point: [0, 0, 0], direction: [1, 0, 0] }, m)).toBeNull()
  })

  test('FE-UT-28: lát cắt axial -> cột đi theo x với spacing cột, hàng đi theo y với spacing hàng', () => {
    expect(pixelToWorld(10, 20, axial)).toEqual([-100 + 20 * 0.8, -100 + 10 * 0.5, 50])
  })

  test('FE-UT-29: lát cắt sagittal -> cột đi theo +y, hàng đi theo -z', () => {
    expect(pixelToWorld(10, 20, sagittal)).toEqual([10, -100 + 20 * 0.8, 100 - 10 * 0.5])
  })

  test('FE-UT-30: worldToPixel là hàm ngược của pixelToWorld', () => {
    const world = pixelToWorld(37, 123, sagittal)!
    const pixel = worldToPixel(world, sagittal)!
    expect(pixel.row).toBeCloseTo(37, 9)
    expect(pixel.col).toBeCloseTo(123, 9)
  })
})

describe('computePlaneNormal / computePlaneEquation', () => {
  test('FE-UT-31: pháp tuyến axial (0,0,1), sagittal (-1,0,0) và hệ số d', () => {
    expect(computePlaneNormal(axial)).toEqual([0, 0, 1])
    expect(computePlaneEquation(axial)).toEqual({ normal: [0, 0, 1], d: 50 })
    expect(computePlaneNormal(sagittal)).toEqual([-1, 0, 0])
    expect(computePlaneEquation(sagittal)?.d).toBe(-10)
  })
  test('FE-UT-32: thiếu orientation hoặc position -> null', () => {
    expect(computePlaneNormal(meta({ imageOrientationPatient: [] }))).toBeNull()
    expect(computePlaneEquation(meta({ imagePositionPatient: [] }))).toBeNull()
  })
})

describe('intersectPlanes', () => {
  test('FE-UT-33: hai mặt phẳng song song (hai lát axial) -> null', () => {
    const other = computePlaneEquation(meta({ imagePositionPatient: [0, 0, 80] }))!
    expect(intersectPlanes(computePlaneEquation(axial)!, other)).toBeNull()
  })
  test('FE-UT-34: axial z=50 cắt sagittal x=10 -> đường thẳng song song trục y qua (10, ·, 50)', () => {
    const line = intersectPlanes(computePlaneEquation(axial)!, computePlaneEquation(sagittal)!)!
    expect(line.point[0]).toBeCloseTo(10, 10)
    expect(line.point[2]).toBeCloseTo(50, 10)
    expect(Math.abs(line.direction[1])).toBeCloseTo(1, 10)
    expect(line.direction[0]).toBeCloseTo(0, 10)
    expect(line.direction[2]).toBeCloseTo(0, 10)
  })
  test('FE-UT-35: axial ∩ coronal song song trục x; sagittal ∩ coronal song song trục z', () => {
    const coronal = computePlaneEquation(meta({ imagePositionPatient: [-100, 20, 100], imageOrientationPatient: [1, 0, 0, 0, 0, -1] }))!
    const alongX = intersectPlanes(computePlaneEquation(axial)!, coronal)!
    expect(Math.abs(alongX.direction[0])).toBeCloseTo(1, 10)
    expect(alongX.point[1]).toBeCloseTo(20, 10)
    expect(alongX.point[2]).toBeCloseTo(50, 10)
    const alongZ = intersectPlanes(computePlaneEquation(sagittal)!, coronal)!
    expect(Math.abs(alongZ.direction[2])).toBeCloseTo(1, 10)
    expect(alongZ.point[0]).toBeCloseTo(10, 10)
    expect(alongZ.point[1]).toBeCloseTo(20, 10)
  })
})

describe('projectLineToViewport', () => {
  const view = meta({ imagePositionPatient: [0, 0, 50], pixelSpacing: [1, 1] })

  test('FE-UT-36: đường thẳng nằm ngoài khung ảnh -> null', () => {
    expect(projectLineToViewport({ point: [500, 0, 50], direction: [0, 1, 0] }, view)).toBeNull()
  })
  test.each([
    ['dọc', { point: [10, 0, 50], direction: [0, -1, 0] }, { row: 99, col: 10 }, { row: 0, col: 10 }],
    ['ngang', { point: [0, 50, 50], direction: [1, 0, 0] }, { row: 50, col: 0 }, { row: 50, col: 199 }],
  ] as const)('FE-UT-37: đường %s cắt qua ảnh -> bị cắt trong [0, rows-1] × [0, columns-1]', (_name, line, start, end) => {
    const segment = projectLineToViewport(line as never, view)!
    expect(segment.start).toEqual(start)
    expect(segment.end).toEqual(end)
  })
  test('FE-UT-38: đường chéo -> cả hai đầu mút nằm trong khung ảnh', () => {
    const s = Math.SQRT1_2
    const segment = projectLineToViewport({ point: [50, 50, 50], direction: [s, s, 0] }, view)!
    for (const end of [segment.start, segment.end]) {
      expect(end.col).toBeGreaterThanOrEqual(0)
      expect(end.col).toBeLessThanOrEqual(199)
      expect(end.row).toBeGreaterThanOrEqual(0)
      expect(end.row).toBeLessThanOrEqual(99)
    }
  })
})

describe('findClosestSlice', () => {
  const at = (z: number): [number, number, number] => [0, 0, z]

  test('FE-UT-39: điểm nằm trên lát hiện tại hoặc thiếu metadata -> null', () => {
    expect(findClosestSlice(at(50), axial, 5, 20)).toBeNull()
    expect(findClosestSlice(at(80), meta({ imageOrientationPatient: [] }), 5, 20)).toBeNull()
  })
  test.each([
    [0.29, null],
    [0.3, null],
    [0.6, 6],
    [1, 6],
    [-1, 4],
  ])('FE-UT-40: lệch %f lần độ dày lát (4 mm) -> lát %o', (ratio, expected) => {
    expect(findClosestSlice(at(50 + ratio * 4), axial, 5, 20)).toBe(expected)
  })
  test('FE-UT-41: vượt quá số lát -> kẹp trong [0, total-1]', () => {
    expect(findClosestSlice(at(50 + 4 * 30), axial, 18, 20)).toBe(19)
    expect(findClosestSlice(at(50 - 4 * 30), axial, 5, 20)).toBe(0)
  })
  test('FE-UT-42: ưu tiên spacingBetweenSlices, rồi sliceThickness, cuối cùng 4 mm', () => {
    expect(findClosestSlice(at(60), meta({ spacingBetweenSlices: 10, sliceThickness: 2 }), 5, 20)).toBe(6)
    expect(findClosestSlice(at(60), meta({ sliceThickness: 2 }), 5, 20)).toBe(10)
    expect(findClosestSlice(at(58), meta({ sliceThickness: 0 }), 5, 20)).toBe(7)
  })
})
