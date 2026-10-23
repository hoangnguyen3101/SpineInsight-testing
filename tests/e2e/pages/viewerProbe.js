// Mục đích: Script chạy trong trình duyệt (chèn trước khi trang tải) để đo khách quan trạng thái viewer:
// pixel canvas, chuỗi chữ vẽ lên canvas (nhãn đo), ma trận CSS, lỗi JavaScript và danh sách request mạng.
// Chỉ đọc trạng thái, không thay đổi hành vi ứng dụng (trừ việc ghi lại lời gọi fillText/print).
(() => {
  if (window.__e2e) return

  const errors = []
  const texts = []
  const print = { opened: 0, printed: 0, images: 0 }
  const safe = (value) => {
    if (value instanceof Error) return value.message
    if (typeof value === 'string') return value
    try { return JSON.stringify(value) } catch { return String(value) }
  }

  window.addEventListener('error', (e) => errors.push({ type: 'error', message: safe(e.error || e.message) }))
  window.addEventListener('unhandledrejection', (e) => errors.push({ type: 'rejection', message: safe(e.reason) }))
  const consoleError = console.error
  console.error = function (...args) {
    errors.push({ type: 'console', message: args.map(safe).join(' ').slice(0, 400) })
    return consoleError.apply(this, args)
  }

  const fillText = CanvasRenderingContext2D.prototype.fillText
  CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
    texts.push(String(text))
    if (texts.length > 4000) texts.splice(0, 2000)
    return fillText.call(this, text, ...rest)
  }

  // In: ghi nhận cửa sổ in được mở, số ảnh trong đó và lời gọi print() thay vì mở hộp thoại in thật.
  const openWindow = window.open
  window.open = function (...args) {
    const win = openWindow.apply(this, args)
    if (win) {
      print.opened++
      win.print = () => {
        print.printed++
        print.images = win.document.images.length
      }
    }
    return win
  }

  function roots() {
    return [...document.querySelectorAll('button[aria-label="Play cine"], button[aria-label="Stop cine"]')]
      .map((button) => button.closest('div.rounded-lg.bg-black'))
      .filter(Boolean)
  }

  function parts(index) {
    const root = roots()[index]
    if (!root) throw new Error(`Không có khung xem thứ ${index}`)
    const container = root.children[1]
    const stage = container.firstElementChild
    const canvases = [...stage.querySelectorAll('canvas')]
    return { root, container, stage, canvases, main: canvases[0] }
  }

  const rect = (el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
  }

  function matrixOf(el) {
    const value = getComputedStyle(el).transform
    return value && value !== 'none' ? new DOMMatrix(value) : new DOMMatrix()
  }

  /** Vị trí trên màn hình của điểm ảnh (x, y) trong canvas, tính từ ma trận CSS thật (không dùng công thức của ứng dụng). */
  function canvasToClient(index, x, y) {
    const { container, stage, main } = parts(index)
    const c = container.getBoundingClientRect()
    const left = c.left + container.clientLeft + stage.offsetLeft
    const top = c.top + container.clientTop + stage.offsetTop
    const origin = { x: left + stage.offsetWidth / 2, y: top + stage.offsetHeight / 2 }
    const px = left + main.offsetLeft + (x / main.width) * main.clientWidth
    const py = top + main.offsetTop + (y / main.height) * main.clientHeight
    const m = matrixOf(stage)
    return {
      x: origin.x + m.a * (px - origin.x) + m.c * (py - origin.y) + m.e,
      y: origin.y + m.b * (px - origin.x) + m.d * (py - origin.y) + m.f,
    }
  }

  /** Phép ngược của canvasToClient: điểm trên màn hình -> toạ độ điểm ảnh trong canvas (theo ma trận CSS thật). */
  function clientToCanvas(index, cx, cy) {
    const { container, stage, main } = parts(index)
    const c = container.getBoundingClientRect()
    const left = c.left + container.clientLeft + stage.offsetLeft
    const top = c.top + container.clientTop + stage.offsetTop
    const origin = { x: left + stage.offsetWidth / 2, y: top + stage.offsetHeight / 2 }
    const inv = matrixOf(stage).inverse()
    const dx = cx - origin.x
    const dy = cy - origin.y
    const px = origin.x + inv.a * dx + inv.c * dy + inv.e
    const py = origin.y + inv.b * dx + inv.d * dy + inv.f
    return {
      x: ((px - left - main.offsetLeft) / main.clientWidth) * main.width,
      y: ((py - top - main.offsetTop) / main.clientHeight) * main.height,
    }
  }

  function pixels(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data
  }

  function stats(index) {
    const { main } = parts(index)
    if (!main.width || !main.height) return { width: 0, height: 0, hash: 0, mean: 0, nonBlank: 0 }
    const data = pixels(main)
    let hash = 0x811c9dc5
    let sum = 0
    let nonBlank = 0
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i]
      hash = Math.imul(hash ^ v, 16777619) >>> 0
      sum += v
      if (v > 8) nonBlank++
    }
    const count = data.length / 4
    return { width: main.width, height: main.height, hash, mean: sum / count, nonBlank: nonBlank / count }
  }

  function sample(index, points) {
    const { main } = parts(index)
    const data = pixels(main)
    return points.map(([x, y]) => data[(Math.round(y) * main.width + Math.round(x)) * 4])
  }

  /** Số điểm có màu (alpha > 0) trên từng canvas phủ; thứ tự: 1 Length ... 14 Magnify, 15 đường tham chiếu. */
  function ink(index, which, region) {
    const canvas = parts(index).canvases[which]
    if (!canvas || !canvas.width) return { count: 0 }
    const data = pixels(canvas)
    const [x0, y0, x1, y1] = region || [0, 0, canvas.width, canvas.height]
    let count = 0
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let sumY = 0
    for (let y = Math.max(0, y0); y < Math.min(canvas.height, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(canvas.width, x1); x++) {
        if (data[(y * canvas.width + x) * 4 + 3] > 0) {
          count++
          sumY += y
          if (x < minX) minX = x
          if (y < minY) minY = y
          if (x > maxX) maxX = x
          if (y > maxY) maxY = y
        }
      }
    }
    return count ? { count, minX, minY, maxX, maxY, meanY: sumY / count } : { count: 0 }
  }

  function info(index) {
    const { root, container, stage, main } = parts(index)
    return {
      title: root.querySelector('p.font-mono')?.textContent || '',
      overlay: [...container.querySelectorAll('.dicom-text')].map((n) => n.innerText).join('\n'),
      overlayCount: container.querySelectorAll('.dicom-text').length,
      text: container.innerText,
      infoBadges: [...container.querySelectorAll('.font-mono')].map((n) => n.innerText).join(' | '),
      root: rect(root),
      container: rect(container),
      canvas: rect(main),
      canvasSize: { width: main.width, height: main.height, cssWidth: main.clientWidth, cssHeight: main.clientHeight },
      transform: stage.style.transform || '',
      matrix: (() => { const m = matrixOf(stage); return [m.a, m.b, m.c, m.d, m.e, m.f] })(),
      cursor: container.style.cursor,
    }
  }

  function grid() {
    const area = document.querySelector('main div.grid')
    return {
      area: area ? rect(area) : null,
      template: area ? [area.style.gridTemplateRows, area.style.gridTemplateColumns] : null,
      cells: area ? [...area.children].map((cell) => ({
        rect: rect(cell),
        viewport: !!cell.querySelector('button[aria-label="Play cine"], button[aria-label="Stop cine"]'),
        text: cell.innerText.slice(0, 60),
      })) : [],
      viewports: roots().length,
    }
  }

  function requests() {
    return performance.getEntriesByType('resource').map((entry) => entry.name)
  }

  window.__e2e = {
    errors, texts, print, info, grid, stats, sample, ink, canvasToClient, clientToCanvas, requests,
    count: () => roots().length,
    clearTexts: () => { texts.length = 0 },
    lastText: (pattern) => {
      const re = new RegExp(pattern)
      for (let i = texts.length - 1; i >= 0; i--) if (re.test(texts[i])) return texts[i]
      return null
    },
  }
})()
