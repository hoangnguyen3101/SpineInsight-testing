// Công cụ ảnh của viewer (âm bản, cửa sổ/độ sáng, xoay, lật, toạ độ đo) kiểm thử bằng dữ liệu tổng hợp vài pixel,
// không cần ảnh MRI thật. Kết quả mong đợi lấy từ DICOM PS3.3 C.11.2.1.2.1 (hàm VOI LUT tuyến tính),
// C.7.6.3.1.2 (MONOCHROME1, YBR_FULL) và ngữ nghĩa CSS transform (rotate theo chiều kim đồng hồ, gốc ở tâm).
import { describe, expect, test, vi } from 'vitest'
import fc from 'fast-check'
import type { DicomMetadata, Point, ViewerTool, ViewportImageState } from '@/features/viewer/types'
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

function fakeCanvas(ctxAvailable = true) {
  const ctx = {
    createImageData: vi.fn((w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h })),
    putImageData: vi.fn(),
  }
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => (ctxAvailable ? ctx : null)) }
  return { canvas: canvas as unknown as HTMLCanvasElement, ctx, raw: canvas }
}

type Pixels = Uint16Array | Int16Array | Uint8Array

// Ảnh 1 hàng × n cột; trả về kênh xám (R) và kênh alpha của ImageData đã ghi lên canvas.
function render(pixels: Pixels, meta: Partial<DicomMetadata> = {}, options?: RenderOptions) {
  const { canvas, ctx } = fakeCanvas()
  renderDicomToCanvas(canvas, pixels.buffer as ArrayBuffer, imageMeta({ columns: pixels.length, ...meta }), options)
  const data: Uint8ClampedArray = ctx.putImageData.mock.calls[0][0].data
  const gray = Array.from({ length: pixels.length }, (_, i) => data[i * 4])
  const alpha = Array.from({ length: pixels.length }, (_, i) => data[i * 4 + 3])
  return { gray, alpha, data }
}

// Hàm VOI LUT tuyến tính theo PS3.3 C.11.2.1.2.1, đầu ra 8 bit [0, 255].
function dicomVoi(x: number, c: number, w: number): number {
  if (x <= c - 0.5 - (w - 1) / 2) return 0
  if (x > c - 0.5 + (w - 1) / 2) return 255
  return ((x - (c - 0.5)) / (w - 1) + 0.5) * 255
}

describe('viewportPresentation: buildRenderOptions', () => {
  test('FE-UT-43: không âm bản, không preset hoặc preset Default (0, 0) -> undefined', () => {
    expect(buildRenderOptions(state(), null)).toBeUndefined()
    expect(buildRenderOptions(state(), { label: 'Default', center: 0, width: 0 })).toBeUndefined()
  })
  test('FE-UT-44: bật âm bản và/hoặc chọn preset -> invert, windowOverride tương ứng', () => {
    const brain = { label: 'Brain', center: 40, width: 80 }
    expect(buildRenderOptions(state({ isInverted: true }), null)).toEqual({ invert: true })
    expect(buildRenderOptions(state(), brain)).toEqual({ windowOverride: { center: 40, width: 80 } })
    expect(buildRenderOptions(state({ isInverted: true }), brain)).toEqual({ invert: true, windowOverride: { center: 40, width: 80 } })
  })
  // BUG-14: điều kiện `center !== 0 && width !== 0` bỏ qua cửa sổ hợp lệ có tâm 0, trong khi useViewerToolbar
  // chỉ coi (0, 0) là Default.
  test.fails('FE-UT-45 (BUG-14): cửa sổ tâm 0, độ rộng 400 vẫn phải được áp dụng', () => {
    expect(buildRenderOptions(state(), { label: 'Custom', center: 0, width: 400 }))
      .toEqual({ windowOverride: { center: 0, width: 400 } })
  })
})

describe('viewportPresentation: buildCombinedTransform', () => {
  const square = imageMeta({ pixelSpacing: [0.7, 0.7] })

  test('FE-UT-46: không xoay, không lật, pixel vuông -> undefined; chỉ có zoom/pan -> giữ nguyên chuỗi', () => {
    expect(buildCombinedTransform('', state(), square)).toBeUndefined()
    expect(buildCombinedTransform('', state())).toBeUndefined()
    expect(buildCombinedTransform('translate(10px, 5px) scale(2)', state(), square)).toBe('translate(10px, 5px) scale(2)')
  })
  test.each([90, 180, 270] as const)('FE-UT-47: xoay %i° -> chỉ thêm rotate tương ứng', (rotation) => {
    expect(buildCombinedTransform('', state({ rotation }), square)).toBe(`rotate(${rotation}deg)`)
  })
  test.each([
    [{ flipH: true }, 'scale(-1, 1)'],
    [{ flipV: true }, 'scale(1, -1)'],
    [{ flipH: true, flipV: true }, 'scale(-1, -1)'],
  ])('FE-UT-48: lật %o -> %s', (flips, expected) => {
    expect(buildCombinedTransform('', state(flips), square)).toBe(expected)
  })
  test('FE-UT-49: thứ tự zoom/pan -> xoay -> lật (lật áp dụng trước trên ảnh gốc)', () => {
    expect(buildCombinedTransform('translate(10px, 5px) scale(2)', state({ rotation: 90, flipH: true }), square))
      .toBe('translate(10px, 5px) scale(2) rotate(90deg) scale(-1, 1)')
  })
  test.each([
    [[1, 0.5], {}, 'scale(1, 2)'],
    [[0.5, 1], {}, 'scale(2, 1)'],
    [[0.5, 1], { flipH: true }, 'scale(-2, 1)'],
    [[0, 1], {}, undefined],
  ] as const)('FE-UT-50: pixelSpacing %o, %o -> bù tỉ lệ khung pixel %s', (spacing, flips, expected) => {
    expect(buildCombinedTransform('', state(flips), imageMeta({ pixelSpacing: spacing as [number, number] }))).toBe(expected)
  })
})

describe('viewportPresentation: tiêu đề và con trỏ', () => {
  const meta = {
    patientName: 'NGUYEN^VAN^A', patientAge: '045Y ', studyDate: '20261022', studyTime: '143005', seriesDescription: 'T2 SAG',
  } as DicomMetadata

  test('FE-UT-51: tiêu đề viewport', () => {
    expect(buildTitleParts(null, 0, 10)).toBe('...')
    expect(buildTitleParts(meta, 0, 15)).toBe('NGUYEN^VAN^A (045Y) 10/22/2026 2:30:05 PM - T2 SAG [1/15]')
    expect(buildTitleParts({ ...meta, patientAge: '' }, 14, 15)).not.toContain('(')
  })
  test.each([
    [[true, true, false, false, false, 'none'], 'grabbing'],
    [[false, true, false, false, false, 'none'], 'crosshair'],
    [[false, false, false, false, true, 'pencil'], 'crosshair'],
    [[false, false, false, false, false, 'cobb-angle'], 'crosshair'],
    [[false, false, false, false, false, 'pencil'], 'cell'],
    [[false, false, false, false, false, 'none'], 'grab'],
    [[false, false, false, false, false, 'eraser'], 'default'],
  ] as const)('FE-UT-52: resolveCursor%o -> %s', (args, expected) => {
    const [dragging, drawing, angle, shape, polygon, tool] = args
    expect(resolveCursor(dragging, drawing, angle, shape, polygon, tool as ViewerTool)).toBe(expected)
  })
})

describe('measurementCoordinates: getCanvasPointFromMouseEvent', () => {
  // Canvas 400 × 200 pixel; khi xoay 90°/270° khung bao trên màn hình đổi thành 200 × 400.
  const W = 400
  const H = 200
  const canvasWithRect = (rect: { left?: number; top?: number; width: number; height: number }) => ({
    width: W, height: H, getBoundingClientRect: () => ({ left: 0, top: 0, ...rect }),
  }) as unknown as HTMLCanvasElement
  const click = (clientX: number, clientY: number) => ({ clientX, clientY }) as MouseEvent

  test('FE-UT-53: không có canvas hoặc khung bao rỗng -> null', () => {
    expect(getCanvasPointFromMouseEvent(click(1, 1), null)).toBeNull()
    expect(getCanvasPointFromMouseEvent(click(1, 1), canvasWithRect({ width: 0, height: 200 }))).toBeNull()
  })
  test('FE-UT-54: không xoay, canvas hiển thị lệch (100, 50) và thu nhỏ 1/2 -> quy đổi đúng pixel', () => {
    const canvas = canvasWithRect({ left: 100, top: 50, width: 200, height: 100 })
    expect(getCanvasPointFromMouseEvent(click(150, 75), canvas, state())).toEqual({ x: 100, y: 50 })
    expect(getCanvasPointFromMouseEvent(click(150, 75), canvas)).toEqual({ x: 100, y: 50 })
  })
  // Điểm canvas (100, 50) nằm ở góc trên-trái; mỗi dòng là vị trí điểm đó trên màn hình sau phép biến đổi.
  test.each([
    ['xoay 0°', state(), { width: W, height: H }, [100, 50]],
    ['xoay 90°', state({ rotation: 90 }), { width: H, height: W }, [150, 100]],
    ['xoay 180°', state({ rotation: 180 }), { width: W, height: H }, [300, 150]],
    ['xoay 270°', state({ rotation: 270 }), { width: H, height: W }, [50, 300]],
    ['lật ngang', state({ flipH: true }), { width: W, height: H }, [300, 50]],
    ['lật dọc', state({ flipV: true }), { width: W, height: H }, [100, 150]],
    ['xoay 90° + lật ngang', state({ rotation: 90, flipH: true }), { width: H, height: W }, [150, 300]],
  ] as const)('FE-UT-55: %s, bấm vào vị trí tương ứng trên màn hình -> điểm canvas (100, 50)', (_name, imageState, rect, [x, y]) => {
    expect(getCanvasPointFromMouseEvent(click(x, y), canvasWithRect(rect), imageState)).toEqual({ x: 100, y: 50 })
  })
  test.each([
    [0, 0, { x: 0, y: 0 }],
    [399, 199, { x: 399, y: 199 }],
    [400, 100, null],
    [100, 200, null],
    [-1, 100, null],
  ])('FE-UT-56: biên khung ảnh, bấm (%i, %i) -> %o', (x, y, expected) => {
    expect(getCanvasPointFromMouseEvent(click(x, y), canvasWithRect({ width: W, height: H }), state())).toEqual(expected)
  })
})

describe('measurementCoordinates: findNearestHandleIndex', () => {
  const origin = { x: 0, y: 0 }

  test.each([
    [[{ x: 10, y: 0 }], 0],
    [[{ x: 6, y: 8 }], 0],
    [[{ x: 10.001, y: 0 }], -1],
    [[], -1],
  ])('FE-UT-57: bán kính 10, tay nắm %j -> %i', (handles, expected) => {
    expect(findNearestHandleIndex(origin, handles)).toBe(expected)
  })
  test('FE-UT-58: chọn tay nắm gần nhất; bán kính 0 chỉ nhận điểm trùng; hoà khoảng cách -> chỉ số sau', () => {
    const handles: Point[] = [{ x: 9, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 5 }]
    expect(findNearestHandleIndex(origin, handles)).toBe(1)
    expect(findNearestHandleIndex(origin, [{ x: 0, y: 0.1 }, { x: 0, y: 0 }], 0)).toBe(1)
    expect(findNearestHandleIndex(origin, [{ x: 3, y: 0 }, { x: 0, y: 3 }])).toBe(1)
  })
})

describe('dicomRenderer: renderDicomToCanvas', () => {
  test('FE-UT-59: rows/columns = 0 hoặc buffer rỗng -> không vẽ; không lấy được context 2D -> không lỗi', () => {
    const empty = fakeCanvas()
    renderDicomToCanvas(empty.canvas, new ArrayBuffer(0), imageMeta())
    renderDicomToCanvas(empty.canvas, new Uint16Array([1]).buffer, imageMeta({ rows: 0 }))
    expect(empty.raw.getContext).not.toHaveBeenCalled()
    const noCtx = fakeCanvas(false)
    expect(() => renderDicomToCanvas(noCtx.canvas, new Uint16Array([1]).buffer, imageMeta())).not.toThrow()
    expect(noCtx.ctx.putImageData).not.toHaveBeenCalled()
  })
  test('FE-UT-60: canvas lấy kích thước ảnh, ghi ImageData tại (0, 0), alpha = 255', () => {
    const { canvas, ctx, raw } = fakeCanvas()
    renderDicomToCanvas(canvas, new Uint16Array([0, 1, 2, 3, 4, 5]).buffer, imageMeta({ rows: 2, columns: 3 }))
    expect([raw.width, raw.height]).toEqual([3, 2])
    expect(ctx.createImageData).toHaveBeenCalledWith(3, 2)
    expect(ctx.putImageData).toHaveBeenCalledWith(expect.anything(), 0, 0)
    expect(render(new Uint16Array([0, 9, 4000])).alpha).toEqual([255, 255, 255])
  })
  test('FE-UT-61: cửa sổ Spine MRI (C=500, W=1000) khớp hàm VOI LUT của DICOM', () => {
    const stored = [0, 1, 250, 500, 750, 999, 1000, 4000]
    const { gray } = render(new Uint16Array(stored))
    expect(gray).toEqual([0, 0, 64, 128, 191, 255, 255, 255])
    expect(gray).toEqual(stored.map((x) => Math.round(dicomVoi(x, 500, 1000))))
  })
  test('FE-UT-62: dưới cận dưới -> 0 (đen), trên cận trên -> 255 (trắng); windowOverride thắng cửa sổ trong metadata', () => {
    const { gray } = render(new Uint16Array([0, 40, 80, 200]), {}, { windowOverride: { center: 40, width: 80 } })
    expect(gray[0]).toBe(0)
    expect(gray[1]).toBe(128)
    expect(gray.slice(2)).toEqual([255, 255])
  })
  test.each([[0], [-10]])('FE-UT-63: windowWidth = %i -> tự tính cửa sổ theo min/max', (windowWidth) => {
    expect(render(new Uint16Array([100, 200, 300]), { windowWidth }).gray).toEqual([0, 128, 255])
  })
  test('FE-UT-64: ảnh hằng (max = min) -> độ rộng 1, không chia cho 0', () => {
    expect(render(new Uint16Array([7, 7]), { windowWidth: 0 }).gray).toEqual([128, 128])
  })
  test('FE-UT-65: áp rescale slope/intercept trước khi lấy cửa sổ', () => {
    const meta = { rescaleSlope: 2, rescaleIntercept: -1000, windowCenter: 0, windowWidth: 2000 }
    expect(render(new Uint16Array([0, 500, 1000]), meta).gray).toEqual([0, 128, 255])
  })
  test('FE-UT-66: pixelRepresentation = 1 đọc số có dấu; ảnh 8 bit đọc Uint8', () => {
    const signed = { pixelRepresentation: 1, windowCenter: 0, windowWidth: 2000 }
    expect(render(new Int16Array([-1000, 0, 1000]), signed).gray).toEqual([0, 128, 255])
    expect(render(new Uint8Array([0, 128, 255]), { bitsAllocated: 8, windowWidth: 0 }).gray).toEqual([0, 128, 255])
  })
  test('FE-UT-67: âm bản -> 255 − v', () => {
    const pixels = new Uint16Array([0, 250, 1000])
    expect(render(pixels).gray).toEqual([0, 64, 255])
    expect(render(pixels, {}, { invert: true }).gray).toEqual([255, 191, 0])
  })
  test('FE-UT-68: MONOCHROME1 hiển thị đảo; MONOCHROME1 + âm bản -> như MONOCHROME2', () => {
    const pixels = new Uint16Array([0, 250, 1000])
    expect(render(pixels, { photometricInterpretation: 'MONOCHROME1' }).gray).toEqual([255, 191, 0])
    expect(render(pixels, { photometricInterpretation: 'MONOCHROME1' }, { invert: true }).gray).toEqual([0, 64, 255])
  })
  test('FE-UT-69: RGB chép nguyên; YBR_FULL đổi sang RGB theo công thức của DICOM', () => {
    const rgb = fakeCanvas()
    renderDicomToCanvas(rgb.canvas, new Uint8Array([10, 20, 30]).buffer, imageMeta({ photometricInterpretation: 'RGB' }))
    expect(Array.from(rgb.ctx.putImageData.mock.calls[0][0].data)).toEqual([10, 20, 30, 255])
    const ybr = fakeCanvas()
    renderDicomToCanvas(ybr.canvas, new Uint8Array([100, 128, 200, 128, 128, 128]).buffer,
      imageMeta({ columns: 2, photometricInterpretation: 'YBR_FULL' }))
    expect(Array.from(ybr.ctx.putImageData.mock.calls[0][0].data)).toEqual([201, 49, 100, 255, 128, 128, 128, 255])
  })
  // BUG-12: công thức (x − (C − W/2)) / W bỏ các hạng −0,5 và (W − 1) của C.11.2.1.2.1; sai lệch ≈ 255/W mức xám,
  // nhỏ với cửa sổ rộng nhưng lớn khi cửa sổ hẹp.
  test.fails.each([
    ['W = 1 (ngưỡng hoá), C = 100', 100, 1, [99, 100, 101]],
    ['preset Brain C = 40, W = 80, sát cận trên', 40, 80, [78, 79]],
  ] as const)('FE-UT-70 (BUG-12): cửa sổ hẹp %s -> lệch DICOM không quá 1 mức xám', (_name, c, w, stored) => {
    const { gray } = render(new Uint16Array(stored), {}, { windowOverride: { center: c, width: w } })
    stored.forEach((x, i) => expect(Math.abs(gray[i] - Math.round(dicomVoi(x, c, w)))).toBeLessThanOrEqual(1))
  })
})

describe('dicomRenderer: autoWindowLevel', () => {
  const auto = (pixels: Pixels, meta: Partial<DicomMetadata> = {}) =>
    autoWindowLevel(pixels.buffer as ArrayBuffer, imageMeta({ columns: pixels.length, ...meta }))

  test('FE-UT-71: ảnh 16 bit không dấu -> tâm = (min+max)/2, rộng = max − min', () => {
    expect(auto(new Uint16Array([100, 300, 200]))).toEqual({ center: 200, width: 200 })
  })
  test('FE-UT-72: ảnh 16 bit có dấu (pixelRepresentation = 1) đọc đúng giá trị âm', () => {
    expect(auto(new Int16Array([-500, 1500]), { pixelRepresentation: 1 })).toEqual({ center: 500, width: 2000 })
  })
  test('FE-UT-73: ảnh 8 bit; ảnh hằng -> độ rộng 1 (biên)', () => {
    expect(auto(new Uint8Array([10, 20]), { bitsAllocated: 8 })).toEqual({ center: 15, width: 10 })
    expect(auto(new Uint16Array([7, 7, 7]))).toEqual({ center: 7, width: 1 })
  })
  // BUG-13: cửa sổ áp lên giá trị sau rescale (như calcMinMax trong renderMonochrome) nhưng autoWindowLevel tính trên
  // giá trị lưu trữ. Hàm hiện chưa được nơi nào gọi nên lỗi ở dạng tiềm ẩn.
  test.fails('FE-UT-74 (BUG-13): có rescale slope 2, intercept −1000 -> cửa sổ tính trên giá trị sau rescale', () => {
    expect(auto(new Uint16Array([0, 1000]), { rescaleSlope: 2, rescaleIntercept: -1000 })).toEqual({ center: 0, width: 2000 })
  })
})

describe('Tính chất của hiển thị ảnh', () => {
  const pixels = fc.array(fc.integer({ min: 0, max: 65535 }), { minLength: 1, maxLength: 64 })
  const voiParams = fc.record({
    windowCenter: fc.integer({ min: -2000, max: 70000 }),
    windowWidth: fc.integer({ min: 1, max: 70000 }),
    rescaleSlope: fc.constantFrom(0.5, 1, 2),
    rescaleIntercept: fc.integer({ min: -2048, max: 2048 }),
  })

  test('FE-PBT-06: đầu ra trong [0, 255], alpha 255, đơn điệu tăng; âm bản hai lần = ảnh gốc; ảnh + âm bản ≈ 255', () => {
    fc.assert(fc.property(pixels, voiParams, (values, meta) => {
      const input = new Uint16Array(values)
      const normal = render(input, meta)
      const inverted = render(input, meta, { invert: true })
      const doubleInverted = render(input, { ...meta, photometricInterpretation: 'MONOCHROME1' }, { invert: true })

      for (const v of normal.gray) expect(v >= 0 && v <= 255).toBe(true)
      expect(normal.alpha.every((a) => a === 255)).toBe(true)
      expect(doubleInverted.gray).toEqual(normal.gray)
      normal.gray.forEach((v, i) => expect(Math.abs(v + inverted.gray[i] - 255)).toBeLessThanOrEqual(1))

      const order = values.map((v, i) => [v, normal.gray[i]]).sort((a, b) => a[0] - b[0])
      for (let i = 1; i < order.length; i++) expect(order[i][1]).toBeGreaterThanOrEqual(order[i - 1][1])
    }), { numRuns: 300 })
  })

  // Mô hình thuận theo CSS: lật (scale ±1 quanh tâm) trước, xoay theo chiều kim đồng hồ sau; khung bao xoay 90°/270°
  // có kích thước H × W. Hàm cần kiểm thử là phép nghịch đảo của mô hình này.
  function toScreen(p: Point, W: number, H: number, s: ViewportImageState, rect: { left: number; top: number; zoom: number }) {
    const x = s.flipH ? W - p.x : p.x
    const y = s.flipV ? H - p.y : p.y
    const rel = {
      0: [x / W, y / H],
      90: [1 - y / H, x / W],
      180: [1 - x / W, 1 - y / H],
      270: [y / H, 1 - x / W],
    }[s.rotation]
    const swap = s.rotation === 90 || s.rotation === 270
    const width = (swap ? H : W) * rect.zoom
    const height = (swap ? W : H) * rect.zoom
    return { clientX: rect.left + rel[0] * width, clientY: rect.top + rel[1] * height, width, height }
  }

  test('FE-PBT-07: mọi tổ hợp xoay/lật/zoom/pan, điểm canvas -> màn hình -> canvas trả lại đúng điểm', () => {
    const scenario = fc.record({
      W: fc.integer({ min: 4, max: 1024 }),
      H: fc.integer({ min: 4, max: 1024 }),
      rotation: fc.constantFrom(0, 90, 180, 270),
      flipH: fc.boolean(),
      flipV: fc.boolean(),
      left: fc.integer({ min: -500, max: 500 }),
      top: fc.integer({ min: -500, max: 500 }),
      zoom: fc.double({ min: 0.25, max: 4, noNaN: true }),
      fx: fc.double({ min: 0, max: 1, noNaN: true }),
      fy: fc.double({ min: 0, max: 1, noNaN: true }),
    })
    fc.assert(fc.property(scenario, (sc) => {
      const s = state({ rotation: sc.rotation as ViewportImageState['rotation'], flipH: sc.flipH, flipV: sc.flipV })
      const point = { x: 1 + sc.fx * (sc.W - 3), y: 1 + sc.fy * (sc.H - 3) }
      const screen = toScreen(point, sc.W, sc.H, s, sc)
      const canvas = {
        width: sc.W, height: sc.H,
        getBoundingClientRect: () => ({ left: sc.left, top: sc.top, width: screen.width, height: screen.height }),
      } as unknown as HTMLCanvasElement
      const back = getCanvasPointFromMouseEvent({ clientX: screen.clientX, clientY: screen.clientY } as MouseEvent, canvas, s)!
      expect(Math.abs(back.x - point.x)).toBeLessThan(1e-6)
      expect(Math.abs(back.y - point.y)).toBeLessThan(1e-6)
    }), { numRuns: 500 })
  })
})
