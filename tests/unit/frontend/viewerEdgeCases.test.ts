// Bổ sung giá trị biên và phân vùng tương đương cho công cụ ảnh của viewer, rút ra từ các mutant còn sống của StrykerJS:
// khung bao chỉ có một chiều bằng 0, bấm phía trên canvas, tay nắm ở xa gốc toạ độ, từng công cụ đo, pixel spacing bằng 0,
// ảnh RGB nhiều pixel, YBR có Cb ≠ 128, tự tính cửa sổ khi có rescale (DICOM PS3.3 C.11.1: cửa sổ áp lên giá trị sau rescale).
import { describe, expect, test, vi } from 'vitest'
import type { DicomMetadata, ViewerTool, ViewportImageState } from '@/features/viewer/types'
import {
  buildCombinedTransform,
  buildRenderOptions,
  buildTitleParts,
  resolveCursor,
} from '@/features/viewer/hooks/viewport/viewportPresentation'
import {
  findNearestHandleIndex,
  getCanvasPointFromMouseEvent,
} from '@/features/viewer/utils/measurement/measurementCoordinates'
import { autoWindowLevel, renderDicomToCanvas, type RenderOptions } from '@/features/viewer/utils/dicomRenderer'

const state = (overrides: Partial<ViewportImageState> = {}): ViewportImageState => ({
  rotation: 0, flipH: false, flipV: false, isInverted: false, ...overrides,
})
const imageMeta = (overrides: Partial<DicomMetadata> = {}) => ({
  rows: 1, columns: 1, bitsAllocated: 16, pixelRepresentation: 0, samplesPerPixel: 1,
  rescaleSlope: 1, rescaleIntercept: 0, photometricInterpretation: 'MONOCHROME2',
  windowCenter: 500, windowWidth: 1000, pixelSpacing: [0.5, 0.5],
  ...overrides,
}) as DicomMetadata

function fakeCanvas() {
  const ctx = {
    createImageData: vi.fn((w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })),
    putImageData: vi.fn(),
  }
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) }
  return { canvas: canvas as unknown as HTMLCanvasElement, ctx }
}
function draw(buffer: ArrayBuffer, meta: Partial<DicomMetadata>, options?: RenderOptions) {
  const { canvas, ctx } = fakeCanvas()
  renderDicomToCanvas(canvas, buffer, imageMeta(meta), options)
  return { ctx, data: ctx.putImageData.mock.calls[0]?.[0].data as Uint8ClampedArray | undefined }
}
const pixel = (data: Uint8ClampedArray, i: number) => Array.from(data.slice(i * 4, i * 4 + 4))

describe('measurementCoordinates', () => {
  const canvasWith = (rect: { left: number; top: number; width: number; height: number }) =>
    ({ width: 400, height: 200, getBoundingClientRect: () => rect }) as unknown as HTMLCanvasElement
  const click = (clientX: number, clientY: number) => ({ clientX, clientY }) as MouseEvent

  // Bấm đúng cạnh có kích thước 0 tạo phép chia 0/0 = NaN; NaN lọt qua mọi phép so sánh biên nếu không chặn từ đầu.
  test.each([
    ['chỉ chiều rộng bằng 0', { left: 0, top: 0, width: 0, height: 200 }, 0, 10],
    ['chỉ chiều cao bằng 0', { left: 0, top: 0, width: 400, height: 0 }, 10, 0],
  ])('FE-UT-109: khung bao %s, bấm tại cạnh đó -> null (không trả toạ độ NaN)', (_name, rect, x, y) => {
    expect(getCanvasPointFromMouseEvent(click(x, y), canvasWith(rect), state())).toBeNull()
  })
  test('FE-UT-109b: bấm phía trên canvas (y = −1) -> null; bấm tại hàng 0 -> nhận', () => {
    const canvas = canvasWith({ left: 0, top: 0, width: 400, height: 200 })
    expect(getCanvasPointFromMouseEvent(click(100, -1), canvas, state())).toBeNull()
    expect(getCanvasPointFromMouseEvent(click(100, 0), canvas, state())).toEqual({ x: 100, y: 0 })
  })
  test('FE-UT-110: tay nắm gần điểm (100, 100) nhất trong bán kính 10 được chọn; điểm xa gốc toạ độ', () => {
    expect(findNearestHandleIndex({ x: 100, y: 100 }, [{ x: 120, y: 120 }, { x: 106, y: 103 }, { x: 300, y: 5 }])).toBe(1)
    expect(findNearestHandleIndex({ x: 100, y: 100 }, [{ x: 111, y: 100 }])).toBe(-1)
  })
})

describe('viewportPresentation', () => {
  test('FE-UT-111: preset có tâm khác 0 nhưng độ rộng 0 (không hợp lệ) -> không ghi đè cửa sổ', () => {
    expect(buildRenderOptions(state(), { name: 'Lỗi', center: 40, width: 0 } as never)).toBeUndefined()
    expect(buildRenderOptions(state({ isInverted: true }), { name: 'Lỗi', center: 40, width: 0 } as never)).toEqual({ invert: true })
  })
  test('FE-UT-112: thiếu tuổi bệnh nhân -> tiêu đề giống hệt khi có tuổi nhưng bỏ phần "(tuổi)"', () => {
    const base = { patientName: 'ANONYMOUS^CASE01', studyDate: '20250101', studyTime: '083938', seriesDescription: 'Sag T1 FSE' }
    const withAge = buildTitleParts({ ...base, patientAge: '035Y' } as DicomMetadata, 0, 15)
    const withoutAge = buildTitleParts({ ...base, patientAge: '' } as DicomMetadata, 0, 15)
    expect(withoutAge).toBe(withAge.replace('(035Y)', ''))
  })
  test.each(['measurement', 'bidirectional', 'angle', 'cobb-angle', 'brightness', 'magnify', 'ellipse', 'rectangle', 'closed-polygon', 'open-polygon'] as ViewerTool[])(
    'FE-UT-113: công cụ %s đang chọn, không thao tác -> con trỏ crosshair', (tool) => {
      expect(resolveCursor(false, false, false, false, false, tool)).toBe('crosshair')
    })
  test.each([
    ['[0,5; 0] (cột bằng 0)', [0.5, 0]],
    ['[0; 0,5] (hàng bằng 0)', [0, 0.5]],
    ['[−0,5; 0,5] (âm)', [-0.5, 0.5]],
  ])('FE-UT-114: pixel spacing %s không hợp lệ -> không co giãn ảnh', (_name, pixelSpacing) => {
    expect(buildCombinedTransform('', state(), { pixelSpacing } as unknown as DicomMetadata)).toBeUndefined()
  })
})

describe('dicomRenderer', () => {
  test('FE-UT-115: số cột bằng 0 (hàng khác 0) -> không vẽ', () => {
    const { ctx } = draw(new Uint16Array([1, 2]).buffer, { rows: 1, columns: 0 })
    expect(ctx.putImageData).not.toHaveBeenCalled()
  })
  test('FE-UT-115b: ảnh xám ghi cùng giá trị cho R, G, B ở mọi pixel', () => {
    const { data } = draw(new Uint16Array([0, 250, 500, 1000]).buffer, { rows: 2, columns: 2 })
    for (let i = 0; i < 4; i++) {
      const [r, g, b, a] = pixel(data!, i)
      expect([g, b, a]).toEqual([r, r, 255])
    }
  })
  test('FE-UT-116: RGB 2 × 2 pixel chép đúng từng pixel theo thứ tự', () => {
    const rgb = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120])
    const { data } = draw(rgb.buffer, { rows: 2, columns: 2, photometricInterpretation: 'RGB', samplesPerPixel: 3 })
    expect([0, 1, 2, 3].map((i) => pixel(data!, i))).toEqual([[10, 20, 30, 255], [40, 50, 60, 255], [70, 80, 90, 255], [100, 110, 120, 255]])
  })
  test('FE-UT-116b: YBR_FULL với Cb ≠ 128 -> G = Y − 0,344136(Cb − 128) − 0,714136(Cr − 128), B = Y + 1,772(Cb − 128)', () => {
    const { data } = draw(new Uint8Array([100, 150, 128]).buffer, { photometricInterpretation: 'YBR_FULL', samplesPerPixel: 3 })
    expect(pixel(data!, 0)).toEqual([100, Math.round(100 - 0.344136 * 22), Math.round(100 + 1.772 * 22), 255])
  })
  test('FE-UT-117: tự tính cửa sổ (độ rộng 0) trên giá trị sau rescale: slope 2, intercept −1000', () => {
    const { data } = draw(new Uint16Array([0, 500, 1000]).buffer, { rows: 1, columns: 3, rescaleSlope: 2, rescaleIntercept: -1000, windowWidth: 0 })
    expect([0, 1, 2].map((i) => pixel(data!, i)[0])).toEqual([0, 128, 255])
  })
  test('FE-UT-117b: tự tính cửa sổ với pixel giảm dần (min, max không nằm ở cuối mảng)', () => {
    const { data } = draw(new Uint16Array([1000, 500, 0]).buffer, { rows: 1, columns: 3, windowWidth: 0 })
    expect([0, 1, 2].map((i) => pixel(data!, i)[0])).toEqual([255, 128, 0])
  })
  test('FE-UT-117c: autoWindowLevel ảnh 16 bit không dấu có giá trị > 32767', () => {
    const buffer = new Uint16Array([40000, 100]).buffer
    expect(autoWindowLevel(buffer, imageMeta({ rows: 1, columns: 2, pixelRepresentation: 0 }))).toEqual({ center: 20050, width: 39900 })
  })
})
