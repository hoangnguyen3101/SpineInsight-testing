// Kịch bản E2E màn hình đọc ảnh với MỘT ca MRI thật đã ẩn danh (FR-05, FR-06) - xem Test Plan chương 4.
// Dữ liệu: thư mục DICOM_TEST_DIR (mỗi series một thư mục con), không nằm trong repo; thiếu thì bỏ qua cả nhóm.
// Mọi kết quả mong đợi lấy từ đặc tả/chuẩn DICOM hoặc tính độc lập (ma trận CSS, tệp DICOM đọc ở phía Node),
// không lấy từ chính công thức của ứng dụng.
import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { after, before, beforeEach, describe, test } from 'node:test'
import { By, Key, Origin } from 'selenium-webdriver'
import { createDriver } from '../driver.mjs'
import { ACCOUNTS } from '../fixtures/accounts.mjs'
import { readSlice, seriesFiles, seriesFolders, voiLinear } from '../fixtures/dicomTruth.mjs'
import { createMockServer } from '../fixtures/mockServer.mjs'
import { LoginPage } from '../pages/LoginPage.mjs'
import { ViewerPage } from '../pages/ViewerPage.mjs'

const BASE_URL = process.env.E2E_BASE_URL
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT)
const DATA_DIR = process.env.DICOM_TEST_DIR
const HAS_DATA = Boolean(DATA_DIR) && existsSync(DATA_DIR)
const SKIP = HAS_DATA ? false : 'Bỏ qua: chưa đặt DICOM_TEST_DIR (thư mục một ca MRI đã ẩn danh) trong .env'
const WINDOW = { width: 1366, height: 900 }

/** Lỗi đã biết: kịch bản phải thất bại đúng với `expectedError`; khi lỗi được sửa sẽ báo đỏ để nhắc bỏ knownBug. */
function knownBug(id, name, expectedError, fn) {
  test(`${id} [lỗi đã biết]: ${name}`, async () => {
    await assert.rejects(async () => {
      try {
        await fn()
      } catch (err) {
        console.log(`[${id}] Thực tế: ${err.message.split('\n')[0]}`)
        throw err
      }
    }, expectedError, `${id} đã được sửa: chuyển kịch bản này về test thường`)
  })
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const numbers = (text) => (text.match(/-?\d+(?:\.\d+)?/g) || []).map(Number)

/** Tỉ lệ diện tích ảnh (canvas) nằm trong khung chứa nó. */
function visibleFraction(info) {
  const c = info.container
  const k = info.canvas
  const w = Math.max(0, Math.min(c.right, k.right) - Math.max(c.left, k.left))
  const h = Math.max(0, Math.min(c.bottom, k.bottom) - Math.max(c.top, k.top))
  return (w * h) / (k.width * k.height)
}

function overlapArea(a, b) {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  return w * h
}

describe('E2E màn hình đọc ảnh với ca MRI thật đã ẩn danh', { skip: SKIP }, () => {
  let mock
  let driver
  let viewer
  let truth
  const nativeDir = HAS_DATA ? DATA_DIR.replace(/\//g, '\\') : ''

  /** Mở lại /viewer (trạng thái ứng dụng sạch, phiên đăng nhập giữ trong localStorage) và nạp ca MRI. */
  async function openCase() {
    await driver.get(`${BASE_URL}${ViewerPage.PATH}`)
    const started = await viewer.loadFolder(nativeDir)
    await viewer.waitForViewports(4)
    for (let i = 0; i < 4; i++) await viewer.waitForImage(i)
    return Date.now() - started
  }

  async function assertClean(id) {
    assert.deepEqual(await viewer.unexpectedErrors(), [], `${id}: có lỗi JavaScript ngoài dự kiến`)
    assert.deepEqual(await viewer.externalRequests(), [], `${id}: có request ra máy chủ ngoài`)
  }

  async function shot(name) {
    await viewer.screenshot(name)
  }

  /** Phóng to một khung thành một khung duy nhất để đo chính xác hơn; trả về chỉ số mới (0). */
  async function expand(description) {
    const index = await viewer.indexOf(description)
    await viewer.clickViewportTitleButton(index, 'expand')
    await viewer.waitForViewports(1)
    await viewer.waitForImage(0)
    await viewer.activate(0)
    return 0
  }

  before(async () => {
    assert.ok(BASE_URL && MOCK_PORT, 'Thiếu E2E_BASE_URL/E2E_MOCK_PORT: hãy chạy bằng npm run test:e2e')
    const folders = seriesFolders(DATA_DIR)
    truth = folders.map((folder) => {
      const first = readSlice(DATA_DIR, folder, 0)
      return { folder, count: seriesFiles(DATA_DIR, folder).length, description: first.seriesDescription, first }
    })
    const find = (re) => truth.find((s) => re.test(s.description))
    truth.ax = find(/^ax/i)
    truth.cor = find(/^cor/i)
    truth.sagT1 = find(/^sag.*t1/i)
    truth.sagT2 = find(/^sag.*t2/i)
    assert.ok(truth.ax && truth.cor && truth.sagT1 && truth.sagT2, 'Ca kiểm thử cần đủ 4 series Ax, Cor, Sag T1, Sag T2')

    mock = createMockServer()
    await mock.listen(MOCK_PORT)
    driver = await createDriver()
    viewer = new ViewerPage(driver, BASE_URL)
    await viewer.installProbe()
    const login = new LoginPage(driver, BASE_URL)
    await login.open()
    await login.login(ACCOUNTS.doctor, 'doctor')
    await login.waitForPath(ViewerPage.PATH)
  })

  after(async () => {
    await driver?.quit()
    await mock?.close()
  })

  beforeEach(async () => {
    await driver.manage().window().setRect(WINDOW)
  })

  // ---------------- Nạp dữ liệu và hiển thị ----------------

  test('E2E-10: nạp thư mục ca MRI -> đủ 4 series, 4 khung 2×2, ảnh đúng kích thước, chữ trên ảnh đã ẩn danh', async () => {
    const loadMs = await openCase()
    const items = await viewer.seriesItems()
    assert.deepEqual(items, truth.map((s) => ({ name: s.folder, count: s.count })))
    const grid = await viewer.probe('grid')
    assert.deepEqual(grid.template, ['repeat(2, 1fr)', 'repeat(2, 1fr)'])
    const shown = []
    for (let i = 0; i < 4; i++) {
      const info = await viewer.probe('info', i)
      const stats = await viewer.probe('stats', i)
      const series = truth.find((s) => info.title.includes(` - ${s.description} [1/${s.count}]`))
      assert.ok(series, `Khung ${i} có tiêu đề lạ: ${info.title}`)
      shown.push(series.folder)
      assert.equal(stats.width, series.first.columns)
      assert.equal(stats.height, series.first.rows)
      assert.ok(stats.nonBlank > 0.05, `Khung ${i} gần như đen (${stats.nonBlank})`)
      assert.match(info.overlay, /ANONYMOUS/)
      assert.match(info.overlay, new RegExp(`Im: 1/${series.count}`))
    }
    assert.deepEqual([...shown].sort(), truth.map((s) => s.folder).sort(), 'Mỗi series phải nằm ở đúng một khung')
    assert.ok(loadMs < 15000, `Nạp thư mục quá lâu: ${loadMs} ms`)
    console.log(`[E2E-10] Thời gian nạp ${truth.reduce((n, s) => n + s.count, 0)} ảnh: ${loadMs} ms`)
    await shot('viewer_10_nap_thu_muc')
    await assertClean('E2E-10')
  })

  test('E2E-11: ảnh mặc định khớp hàm VOI LUT chuẩn DICOM với cửa sổ trong tệp (±2 mức xám)', async () => {
    await openCase()
    const index = await viewer.indexOf(truth.ax.description)
    const slice = truth.ax.first
    const points = []
    for (let y = 40; y < slice.rows; y += 47) for (let x = 40; x < slice.columns; x += 53) points.push([x, y])
    const actual = await viewer.probe('sample', index, points)
    const diffs = points.map(([x, y], k) => Math.abs(actual[k] - Math.round(voiLinear(slice.values[y * slice.columns + x], slice.windowCenter, slice.windowWidth))))
    assert.ok(Math.max(...diffs) <= 2, `Lệch tối đa ${Math.max(...diffs)} mức xám trên ${points.length} điểm`)
    const info = await viewer.probe('info', index)
    assert.match(info.overlay, new RegExp(`WL: ${Math.round(slice.windowCenter)} WW: ${Math.round(slice.windowWidth)}`))
    await assertClean('E2E-11')
  })

  // ---------------- Cuộn lát, đồng bộ, bàn phím ----------------

  test('E2E-12: cuộn chuột qua các lát (BVA: trước lát đầu, lát cuối, sau lát cuối)', async () => {
    await openCase()
    const index = await viewer.indexOf(truth.ax.description)
    const other = await viewer.indexOf(truth.cor.description)
    const first = await viewer.probe('stats', index)
    await viewer.wheel(index, -120)
    assert.deepEqual(await viewer.sliceOf(index), { current: 1, total: truth.ax.count }, 'Lăn lên ở lát đầu phải giữ lát 1')
    assert.equal((await viewer.probe('stats', index)).hash, first.hash)
    await viewer.wheel(index, 120)
    assert.deepEqual(await viewer.sliceOf(index), { current: 2, total: truth.ax.count })
    assert.notEqual((await viewer.probe('stats', index)).hash, first.hash, 'Ảnh phải đổi khi sang lát 2')
    await viewer.wheel(index, 120, truth.ax.count - 2)
    assert.deepEqual(await viewer.sliceOf(index), { current: truth.ax.count, total: truth.ax.count })
    await viewer.wheel(index, 120)
    assert.deepEqual(await viewer.sliceOf(index), { current: truth.ax.count, total: truth.ax.count }, 'Lăn xuống ở lát cuối phải giữ lát cuối')
    assert.match((await viewer.probe('info', index)).overlay, new RegExp(`Im: ${truth.ax.count}/${truth.ax.count}`))
    assert.deepEqual(await viewer.sliceOf(other), { current: 1, total: truth.cor.count }, 'Khung khác không được đổi lát')
    await shot('viewer_12_cuon_lat_cuoi')
    await assertClean('E2E-12')
  })

  test('E2E-13: cuộn một khung sagittal -> khung sagittal còn lại đồng bộ cùng vị trí, khung axial giữ nguyên', async () => {
    await openCase()
    const t1 = await viewer.indexOf(truth.sagT1.description)
    const t2 = await viewer.indexOf(truth.sagT2.description)
    const ax = await viewer.indexOf(truth.ax.description)
    await viewer.wheel(t1, 120, 4)
    assert.equal((await viewer.sliceOf(t1)).current, 5)
    assert.equal((await viewer.sliceOf(t2)).current, 5)
    assert.equal((await viewer.sliceOf(ax)).current, 1)
    await assertClean('E2E-13')
  })

  knownBug('E2E-14 (BUG-16)', 'phím ↓ chỉ chuyển 1 lát ở khung đang chọn', /Phím mũi tên tác động sai/, async () => {
    await openCase()
    const ax = await viewer.indexOf(truth.ax.description)
    await viewer.activate(ax)
    await viewer.pressKey(Key.ARROW_DOWN)
    const slices = {}
    for (const key of ['ax', 'cor', 'sagT1', 'sagT2']) slices[key] = (await viewer.sliceOf(await viewer.indexOf(truth[key].description))).current
    await shot('viewer_14_phim_mui_ten')
    await assertClean('E2E-14')
    assert.deepEqual(slices, { ax: 2, cor: 1, sagT1: 1, sagT2: 1 }, `Phím mũi tên tác động sai: ${JSON.stringify(slices)}`)
  })

  test('E2E-15: phím → / ← đổi series trong khung đang chọn theo thứ tự danh sách', async () => {
    await openCase()
    const slot = await viewer.indexOf(truth.ax.description)
    await viewer.activate(slot)
    await viewer.pressKey(Key.ARROW_RIGHT)
    const next = truth[(truth.indexOf(truth.ax) + 1) % truth.length]
    assert.match((await viewer.probe('info', slot)).title, new RegExp(` - ${next.description} \\[`))
    await viewer.pressKey(Key.ARROW_LEFT)
    assert.match((await viewer.probe('info', slot)).title, new RegExp(` - ${truth.ax.description} \\[`))
    await assertClean('E2E-15')
  })

  knownBug('E2E-16 (BUG-17)', 'sau khi đổi series bằng phím, chỉ khung đang chọn bị xoay', /Thao tác lan sang khung khác/, async () => {
    await openCase()
    const slot = await viewer.indexOf(truth.ax.description)
    await viewer.activate(slot)
    await viewer.pressKey(Key.ARROW_RIGHT)
    await viewer.clickTool('rotate')
    const rotated = []
    for (let i = 0; i < 4; i++) if ((await viewer.probe('info', i)).transform.includes('rotate(90deg)')) rotated.push(i)
    await shot('viewer_16_xoay_lan_khung')
    await assertClean('E2E-16')
    assert.deepEqual(rotated, [slot], `Thao tác lan sang khung khác: các khung bị xoay ${JSON.stringify(rotated)}`)
  })

  // ---------------- Chia khung ----------------

  async function checkLayout(rows, cols) {
    const problems = []
    await viewer.selectLayout(rows, cols)
    let grid = await viewer.probe('grid')
    if (grid.cells.length !== rows * cols) problems.push(`${rows}×${cols}: ${grid.cells.length} ô`)
    const k = Math.min(4, rows * cols)
    for (let slot = 0; slot < k; slot++) await viewer.assignSeries(truth[slot].folder, slot)
    await viewer.waitForViewports(k)
    for (let i = 0; i < k; i++) await viewer.waitForImage(i)
    grid = await viewer.probe('grid')
    const area = grid.area
    grid.cells.forEach((cell, i) => {
      const r = cell.rect
      if (!(r.width > 0 && r.height > 0)) problems.push(`${rows}×${cols}: ô ${i} kích thước ${r.width}×${r.height}`)
      if (r.left < area.left - 1 || r.right > area.right + 1 || r.top < area.top - 1 || r.bottom > area.bottom + 1) problems.push(`${rows}×${cols}: ô ${i} tràn khỏi lưới`)
      grid.cells.forEach((other, j) => {
        if (j > i && overlapArea(r, other.rect) > 1) problems.push(`${rows}×${cols}: ô ${i} chồng ô ${j}`)
      })
    })
    for (let i = 0; i < k; i++) {
      const info = await viewer.probe('info', i)
      const aspect = info.canvas.width / info.canvas.height
      if (Math.abs(aspect - 1) > 0.02) problems.push(`${rows}×${cols}: khung ${i} ảnh bị méo (tỉ lệ ${aspect.toFixed(3)})`)
      const visible = visibleFraction(info)
      if (visible < 0.99) problems.push(`${rows}×${cols}: khung ${i} chỉ thấy ${(visible * 100).toFixed(0)}% ảnh`)
    }
    return problems
  }

  test('E2E-17: chia khung 1×1, 1×2, 2×2, 3×3 và 4×5 (BVA) -> đúng số ô, không chồng/tràn, ảnh không méo và thấy trọn ảnh', async () => {
    await openCase()
    const problems = []
    for (const [rows, cols] of [[1, 1], [1, 2], [2, 2], [3, 3], [4, 5]]) {
      problems.push(...await checkLayout(rows, cols))
      if (rows === 3) await shot('viewer_17_chia_khung_3x3')
    }
    await shot('viewer_17_chia_khung_4x5')
    assert.deepEqual(problems, [], `Lỗi chia khung: ${problems.join('; ')}`)
    await assertClean('E2E-17')
  })

  /** Lỗi khi ô lưới rộng hơn cao: ảnh được co theo chiều rộng nên tràn và bị cắt theo chiều cao. */
  knownBug('E2E-18 (BUG-24)', 'ô lưới rộng hơn cao (2×1, hoặc 2×2 trên màn hình 1600×1000) vẫn thấy trọn ảnh', /Lỗi chia khung/, async () => {
    await openCase()
    const problems = await checkLayout(2, 1)
    await shot('viewer_18_chia_khung_2x1')
    await driver.manage().window().setRect({ width: 1600, height: 1000 })
    await openCase()
    for (let i = 0; i < 4; i++) {
      const visible = visibleFraction(await viewer.probe('info', i))
      if (visible < 0.99) problems.push(`2×2 ở 1600×1000: khung ${i} chỉ thấy ${(visible * 100).toFixed(0)}% ảnh`)
    }
    await assertClean('E2E-18')
    assert.deepEqual(problems, [], `Lỗi chia khung: ${problems.join('; ')}`)
  })

  test('E2E-19: đổi kích thước cửa sổ trình duyệt -> lưới 2×2 vẫn đủ 4 khung, không chồng nhau, ảnh không méo', async () => {
    await openCase()
    const problems = []
    for (const rect of [{ width: 1100, height: 760 }, { width: 1600, height: 1000 }, { width: WINDOW.width, height: WINDOW.height }]) {
      await driver.manage().window().setRect(rect)
      await viewer.settle(600)
      const grid = await viewer.probe('grid')
      if (grid.viewports !== 4) problems.push(`${rect.width}×${rect.height}: ${grid.viewports} khung`)
      grid.cells.forEach((cell, i) => grid.cells.forEach((other, j) => {
        if (j > i && overlapArea(cell.rect, other.rect) > 1) problems.push(`${rect.width}×${rect.height}: ô ${i} chồng ô ${j}`)
      }))
      for (let i = 0; i < 4; i++) {
        const info = await viewer.probe('info', i)
        const aspect = info.canvas.width / info.canvas.height
        if (Math.abs(aspect - 1) > 0.02) problems.push(`${rect.width}×${rect.height}: khung ${i} méo ${aspect.toFixed(3)}`)
        if ((await viewer.probe('stats', i)).nonBlank < 0.05) problems.push(`${rect.width}×${rect.height}: khung ${i} mất ảnh`)
      }
      if (rect.width === 1100) await shot('viewer_19_doi_kich_thuoc_1100')
    }
    assert.deepEqual(problems, [], problems.join('; '))
    await assertClean('E2E-19')
  })

  knownBug('E2E-20 (BUG-18)', 'Auto Layout đặt Sag T2 làm khung chính (T2 ưu tiên trước T1)', /Khung chính không phải Sag T2/, async () => {
    await openCase()
    await viewer.selectLayout(1, 1)
    await viewer.clickButtonByLabel('Auto Layout')
    await viewer.waitForViewports(4)
    const title = (await viewer.probe('info', 0)).title
    await assertClean('E2E-20')
    assert.match(title, new RegExp(` - ${truth.sagT2.description} \\[`), `Khung chính không phải Sag T2: ${title}`)
  })

  test('E2E-21: mở rộng một khung rồi thu nhỏ lại', async () => {
    await openCase()
    const before = await viewer.probe('info', await viewer.indexOf(truth.ax.description))
    await expand(truth.ax.description)
    const big = await viewer.probe('info', 0)
    assert.match(big.title, new RegExp(` - ${truth.ax.description} \\[`))
    assert.ok(big.container.width > before.container.width * 1.8, 'Khung mở rộng phải lớn hơn rõ rệt')
    assert.ok(visibleFraction(big) > 0.99)
    await viewer.clickViewportTitleButton(0, 'collapse')
    await viewer.waitForViewports(4)
    await assertClean('E2E-21')
  })

  test('E2E-22: đóng một khung -> ô trống, gán lại series từ thanh bên', async () => {
    await openCase()
    const index = await viewer.indexOf(truth.cor.description)
    await viewer.clickViewportTitleButton(index, 'close')
    await viewer.waitForViewports(3)
    const cell = (await viewer.probe('grid')).cells[index]
    assert.equal(cell.viewport, false)
    await viewer.assignSeries(truth.cor.folder, index)
    await viewer.waitForViewports(4)
    await viewer.waitForImage(await viewer.indexOf(truth.cor.description))
    await assertClean('E2E-22')
  })

  // ---------------- Zoom, kéo, độ sáng, cửa sổ, âm bản, xoay/lật ----------------

  test('E2E-23: Ctrl+lăn chuột phóng to, kéo để dịch ảnh, Fit to Window đưa về mặc định', async () => {
    await openCase()
    const index = await viewer.indexOf(truth.sagT1.description)
    await viewer.activate(index)
    const base = await viewer.probe('info', index)
    const hash = (await viewer.probe('stats', index)).hash
    assert.deepEqual(base.matrix, [0.8, 0, 0, 0.8, 0, 0])
    await viewer.wheel(index, -300, 2, { ctrl: true })
    const zoomed = await viewer.probe('info', index)
    assert.ok(zoomed.matrix[0] > 0.85, `Ctrl+lăn không phóng to: ${zoomed.matrix}`)
    assert.match(zoomed.text, /\d\.\d×/, 'Thiếu nhãn mức phóng to')
    await viewer.clickTool('fitWindow')
    assert.deepEqual((await viewer.probe('info', index)).matrix, [0.8, 0, 0, 0.8, 0, 0])
    const center = await viewer.containerCenter(index)
    await viewer.drag(center, { x: center.x + 60, y: center.y + 40 })
    const panned = (await viewer.probe('info', index)).matrix
    assert.ok(Math.abs(panned[4] - 60) <= 2 && Math.abs(panned[5] - 40) <= 2, `Kéo 60×40 px nhưng ảnh dịch ${panned[4]}×${panned[5]}`)
    assert.equal((await viewer.probe('stats', index)).hash, hash, 'Phóng to/kéo không được đổi điểm ảnh')
    await viewer.clickTool('fitWindow')
    assert.deepEqual((await viewer.probe('info', index)).matrix, [0.8, 0, 0, 0.8, 0, 0])
    await assertClean('E2E-23')
  })

  test('E2E-24: công cụ độ sáng/tương phản: kéo lên tăng sáng đơn điệu, kéo ngang tăng tương phản, Reset All khôi phục', async () => {
    await openCase()
    const index = await viewer.indexOf(truth.sagT1.description)
    const base = await viewer.probe('stats', index)
    await viewer.clickTool('brightness')
    assert.equal(await viewer.isToolActive('brightness'), true)
    const center = await viewer.containerCenter(index)
    await viewer.drag(center, { x: center.x, y: center.y - 40 })
    const once = await viewer.probe('stats', index)
    await viewer.drag(center, { x: center.x, y: center.y - 40 })
    const twice = await viewer.probe('stats', index)
    assert.ok(once.mean > base.mean + 5 && twice.mean > once.mean + 5, `Độ sáng trung bình ${base.mean} -> ${once.mean} -> ${twice.mean}`)
    assert.match((await viewer.probe('info', index)).text, /B:\s*\+\d+%/)
    await viewer.drag(center, { x: center.x + 60, y: center.y })
    assert.match((await viewer.probe('info', index)).text, /C:\s*\+\d+%/)
    await shot('viewer_24_do_sang')
    await viewer.clickTool('reset')
    assert.equal((await viewer.probe('stats', index)).hash, base.hash)
    await assertClean('E2E-24')
  })

  knownBug('E2E-25 (BUG-19)', 'độ sáng vừa chỉnh được giữ khi chuyển sang công cụ đo', /Độ sáng bị mất khi đổi công cụ/, async () => {
    await openCase()
    const index = await viewer.indexOf(truth.sagT1.description)
    const base = await viewer.probe('stats', index)
    await viewer.clickTool('brightness')
    const center = await viewer.containerCenter(index)
    await viewer.drag(center, { x: center.x, y: center.y - 60 })
    const bright = await viewer.probe('stats', index)
    await viewer.selectMeasureTool('Length')
    const after = await viewer.probe('stats', index)
    await assertClean('E2E-25')
    assert.ok(bright.mean > base.mean + 5, 'Kéo độ sáng không có tác dụng')
    assert.ok(Math.abs(after.mean - bright.mean) < 1, `Độ sáng bị mất khi đổi công cụ: ${bright.mean.toFixed(1)} -> ${after.mean.toFixed(1)}`)
  })

  test('E2E-26: các preset cửa sổ đổi ảnh; Spine MRI khớp VOI LUT chuẩn (C500/W1000); Default khôi phục', async () => {
    await openCase()
    const index = await viewer.indexOf(truth.sagT1.description)
    const base = await viewer.probe('stats', index)
    for (const preset of ['Brain', 'Bone', 'Lung', 'Abdomen', 'Spine MRI']) {
      await viewer.selectWLPreset(preset)
      assert.notEqual((await viewer.probe('stats', index)).hash, base.hash, `Preset ${preset} không đổi ảnh`)
    }
    const slice = truth.sagT1.first
    const points = []
    for (let y = 30; y < slice.rows; y += 61) for (let x = 30; x < slice.columns; x += 59) points.push([x, y])
    const actual = await viewer.probe('sample', index, points)
    const diffs = points.map(([x, y], k) => Math.abs(actual[k] - Math.round(voiLinear(slice.values[y * slice.columns + x], 500, 1000))))
    assert.ok(Math.max(...diffs) <= 2, `Spine MRI lệch tối đa ${Math.max(...diffs)} mức xám`)
    await shot('viewer_26_preset_spine_mri')
    await viewer.selectWLPreset('Default')
    assert.equal((await viewer.probe('stats', index)).hash, base.hash)
    await assertClean('E2E-26')
  })

  knownBug('E2E-27 (BUG-20)', 'chữ WL/WW trên ảnh hiển thị cửa sổ đang áp dụng', /Thông tin WL\/WW trên ảnh không cập nhật/, async () => {
    await openCase()
    const index = await viewer.indexOf(truth.sagT1.description)
    await viewer.selectWLPreset('Spine MRI')
    const overlay = (await viewer.probe('info', index)).overlay.match(/WL:.*/)?.[0]
    await assertClean('E2E-27')
    assert.equal(overlay, 'WL: 500 WW: 1000', `Thông tin WL/WW trên ảnh không cập nhật: ${overlay}`)
  })

  test('E2E-28: âm bản chỉ áp dụng cho khung đang chọn, điểm ảnh = 255 − giá trị cũ, bấm lại trả về như cũ', async () => {
    await openCase()
    const index = await viewer.indexOf(truth.sagT1.description)
    const other = await viewer.indexOf(truth.sagT2.description)
    const otherHash = (await viewer.probe('stats', other)).hash
    const base = await viewer.probe('stats', index)
    const points = []
    for (let y = 50; y < 1024; y += 71) for (let x = 50; x < 1024; x += 67) points.push([x, y])
    const before = await viewer.probe('sample', index, points)
    await viewer.activate(index)
    await viewer.clickTool('invert')
    const inverted = await viewer.probe('sample', index, points)
    const worst = Math.max(...inverted.map((v, k) => Math.abs(v - (255 - before[k]))))
    assert.ok(worst <= 1, `Âm bản lệch ${worst} mức xám so với 255 − v`)
    assert.equal((await viewer.probe('stats', other)).hash, otherHash, 'Khung không được chọn cũng bị âm bản')
    await shot('viewer_28_am_ban')
    await viewer.clickTool('invert')
    assert.equal((await viewer.probe('stats', index)).hash, base.hash)
    await assertClean('E2E-28')
  })

  test('E2E-29: xoay 90° bốn lần, lật ngang/dọc hai lần đều trả về ảnh ban đầu; điểm ảnh gốc không đổi', async () => {
    await openCase()
    const index = await viewer.indexOf(truth.ax.description)
    await viewer.activate(index)
    const hash = (await viewer.probe('stats', index)).hash
    const baseline = await viewer.elementScreenshot(index)
    const baseTransform = (await viewer.probe('info', index)).transform
    await viewer.clickTool('rotate')
    assert.match((await viewer.probe('info', index)).transform, /rotate\(90deg\)/)
    assert.notEqual(await viewer.elementScreenshot(index), baseline, 'Xoay 90° không đổi hình hiển thị')
    await shot('viewer_29_xoay_90')
    for (let i = 0; i < 3; i++) await viewer.clickTool('rotate')
    assert.equal((await viewer.probe('info', index)).transform, baseTransform)
    assert.equal(await viewer.elementScreenshot(index), baseline, 'Xoay 4 lần không trả về ảnh ban đầu')
    for (const [tool, pattern] of [['flipH', /scale\(-1, 1\)/], ['flipV', /scale\(1, -1\)/]]) {
      await viewer.clickTool(tool)
      assert.match((await viewer.probe('info', index)).transform, pattern)
      assert.notEqual(await viewer.elementScreenshot(index), baseline)
      await viewer.clickTool(tool)
      assert.equal(await viewer.elementScreenshot(index), baseline, `${tool} hai lần không trả về ảnh ban đầu`)
    }
    assert.equal((await viewer.probe('stats', index)).hash, hash, 'Xoay/lật không được sửa điểm ảnh gốc')
    await assertClean('E2E-29')
  })

  // ---------------- Đo đạc ----------------

  const spacingOf = (series) => ({ sy: series.first.pixelSpacing[0], sx: series.first.pixelSpacing[1] })
  const mm = (a, b, { sx, sy }) => Math.hypot((b.x - a.x) * sx, (b.y - a.y) * sy)

  test('E2E-30: đo chiều dài: nhãn mm = khoảng cách điểm ảnh × pixel spacing; nét đo nằm đúng hai điểm; Ctrl+Z xoá', async () => {
    await openCase()
    const index = await expand(truth.sagT1.description)
    await viewer.selectMeasureTool('Length')
    await viewer.probe('clearTexts')
    const a = await viewer.clickCanvasPoint(index, 212, 512)
    const b = await viewer.clickCanvasPoint(index, 812, 512)
    const expected = mm(a, b, spacingOf(truth.sagT1))
    const label = await viewer.probe('lastText', ' mm$')
    assert.ok(label, 'Không thấy nhãn đo')
    assert.ok(Math.abs(numbers(label)[0] - expected) <= 0.11, `Nhãn ${label}, mong đợi ${expected.toFixed(2)} mm`)
    for (const p of [a, b]) {
      const near = await viewer.probe('ink', index, 1, [Math.round(p.x) - 12, Math.round(p.y) - 12, Math.round(p.x) + 12, Math.round(p.y) + 12])
      assert.ok(near.count > 0, `Không có nét đo tại (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`)
    }
    await shot('viewer_30_do_chieu_dai')
    await viewer.pressCtrl('z')
    assert.equal((await viewer.probe('ink', index, 1)).count, 0, 'Ctrl+Z không xoá phép đo')
    await assertClean('E2E-30')
  })

  test('E2E-31: đo sau khi xoay 90° và lật ngang -> nét đo vẫn nằm đúng vị trí giải phẫu đã bấm', async () => {
    await openCase()
    const index = await expand(truth.sagT1.description)
    await viewer.clickTool('rotate')
    await viewer.clickTool('flipH')
    await viewer.selectMeasureTool('Length')
    await viewer.probe('clearTexts')
    const a = await viewer.clickCanvasPoint(index, 300, 400)
    const b = await viewer.clickCanvasPoint(index, 700, 650)
    const label = await viewer.probe('lastText', ' mm$')
    assert.ok(Math.abs(numbers(label)[0] - mm(a, b, spacingOf(truth.sagT1))) <= 0.11, `Nhãn ${label}`)
    for (const p of [a, b]) {
      const near = await viewer.probe('ink', index, 1, [Math.round(p.x) - 12, Math.round(p.y) - 12, Math.round(p.x) + 12, Math.round(p.y) + 12])
      assert.ok(near.count > 0, `Nét đo không nằm tại điểm đã bấm (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`)
    }
    await shot('viewer_31_do_sau_xoay_lat')
    await assertClean('E2E-31')
  })

  test('E2E-32: đo góc 3 điểm -> nhãn độ khớp góc tính từ các điểm đã bấm (±0,15°)', async () => {
    await openCase()
    const index = await expand(truth.sagT1.description)
    await viewer.selectMeasureTool('Angle')
    await viewer.probe('clearTexts')
    const a = await viewer.clickCanvasPoint(index, 312, 312)
    const v = await viewer.clickCanvasPoint(index, 512, 512)
    const c = await viewer.clickCanvasPoint(index, 712, 312)
    const { sx, sy } = spacingOf(truth.sagT1)
    const u = { x: (a.x - v.x) * sx, y: (a.y - v.y) * sy }
    const w = { x: (c.x - v.x) * sx, y: (c.y - v.y) * sy }
    const expected = (Math.acos((u.x * w.x + u.y * w.y) / (Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y))) * 180) / Math.PI
    const label = await viewer.probe('lastText', '°$')
    assert.ok(label && Math.abs(numbers(label)[0] - expected) <= 0.15, `Nhãn ${label}, mong đợi ${expected.toFixed(2)}°`)
    await assertClean('E2E-32')
  })

  test('E2E-33: hình chữ nhật, ellipse, circle ROI -> kích thước và diện tích mm² đúng công thức', async () => {
    await openCase()
    const index = await expand(truth.sagT1.description)
    const s = spacingOf(truth.sagT1)
    const cases = [
      { tool: 'Rectangle', from: [312, 312], to: [712, 612], area: (w, h) => w * h },
      { tool: 'Ellipse', from: [312, 312], to: [712, 612], area: (w, h) => (Math.PI / 4) * w * h },
    ]
    for (const shape of cases) {
      await viewer.selectMeasureTool(shape.tool)
      await viewer.probe('clearTexts')
      const p = await viewer.exactPoint(index, ...shape.from)
      const q = await viewer.exactPoint(index, ...shape.to)
      await viewer.drag(p.client, q.client)
      const w = Math.abs(q.canvas.x - p.canvas.x) * s.sx
      const h = Math.abs(q.canvas.y - p.canvas.y) * s.sy
      const label = await viewer.probe('lastText', 'mm²$')
      const [lw, lh, la] = numbers(label)
      assert.ok(Math.abs(lw - w) <= 0.11 && Math.abs(lh - h) <= 0.11, `${shape.tool}: nhãn ${label}, mong đợi ${w.toFixed(2)}×${h.toFixed(2)}`)
      assert.ok(Math.abs(la - shape.area(w, h)) <= shape.area(w, h) * 0.003 + 0.1, `${shape.tool}: diện tích ${la}, mong đợi ${shape.area(w, h).toFixed(1)}`)
    }
    await viewer.selectMeasureTool('Circle ROI')
    await viewer.probe('clearTexts')
    const p = await viewer.exactPoint(index, 412, 412)
    const q = await viewer.exactPoint(index, 612, 562)
    await viewer.drag(p.client, q.client)
    const side = Math.max(Math.abs(q.canvas.x - p.canvas.x), Math.abs(q.canvas.y - p.canvas.y))
    const area = Math.PI * (side / 2) * s.sx * (side / 2) * s.sy
    const label = await viewer.probe('lastText', 'mm²$')
    const [r, a] = numbers(label)
    assert.ok(Math.abs(a - area) <= area * 0.004 + 0.1 && Math.abs(r - Math.sqrt(area / Math.PI)) <= 0.11, `Circle ROI: nhãn ${label}, mong đợi A=${area.toFixed(1)}`)
    await shot('viewer_33_hinh_va_dien_tich')
    await assertClean('E2E-33')
  })

  test('E2E-34: bidirectional và Cobb angle -> có nhãn; góc Cobb khớp góc giữa hai đường đã bấm (±0,3°)', async () => {
    await openCase()
    const index = await expand(truth.sagT1.description)
    await viewer.selectMeasureTool('Bidirectional')
    await viewer.probe('clearTexts')
    for (const [x, y] of [[312, 512], [712, 512], [512, 412], [512, 612]]) await viewer.clickCanvasPoint(index, x, y)
    assert.ok((await viewer.probe('ink', index, 2)).count > 0, 'Không vẽ bidirectional')
    assert.ok(await viewer.probe('lastText', 'mm'), 'Thiếu nhãn bidirectional')
    await viewer.selectMeasureTool('Cobb angle')
    await viewer.probe('clearTexts')
    const pts = []
    for (const [x, y] of [[312, 400], [712, 400], [312, 600], [712, 800]]) pts.push(await viewer.clickCanvasPoint(index, x, y))
    const { sx, sy } = spacingOf(truth.sagT1)
    const angle = (p, q) => Math.atan2((q.y - p.y) * sy, (q.x - p.x) * sx)
    let expected = Math.abs(angle(pts[0], pts[1]) - angle(pts[2], pts[3])) * 180 / Math.PI
    if (expected > 90) expected = 180 - expected
    const label = await viewer.probe('lastText', '°')
    assert.ok(label && Math.abs(numbers(label)[0] - expected) <= 0.3, `Cobb: nhãn ${label}, mong đợi ${expected.toFixed(2)}°`)
    await assertClean('E2E-34')
  })

  test('E2E-35: probe hiển thị đúng toạ độ điểm ảnh đã bấm; Arrow note ghi chú văn bản', async () => {
    await openCase()
    const index = await expand(truth.sagT1.description)
    await viewer.selectMeasureTool('Probe')
    await viewer.probe('clearTexts')
    const p = await viewer.clickCanvasPoint(index, 400, 600)
    const label = await viewer.probe('lastText', '^X: ')
    const [x, y] = numbers(label)
    assert.ok(Math.abs(x - p.x) <= 1 && Math.abs(y - p.y) <= 1, `Probe ${label}, điểm đã bấm (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`)
    await viewer.selectMeasureTool('Arrow note')
    const from = await viewer.exactPoint(index, 600, 300)
    const to = await viewer.exactPoint(index, 512, 512)
    await viewer.drag(from.client, to.client)
    const input = await viewer.waitForVisible(By.css('input[placeholder^="Enter note"]'))
    await input.sendKeys('L4-L5', Key.ENTER)
    await viewer.settle()
    assert.ok(await viewer.probe('lastText', 'L4-L5'), 'Ghi chú không được vẽ lên ảnh')
    await shot('viewer_35_probe_ghi_chu')
    await assertClean('E2E-35')
  })

  test('E2E-36: đa giác kín (diện tích theo công thức shoelace) và đa giác hở (tổng chiều dài)', async () => {
    await openCase()
    const index = await expand(truth.sagT1.description)
    const { sx, sy } = spacingOf(truth.sagT1)
    await viewer.selectMeasureTool('Closed polygon')
    await viewer.probe('clearTexts')
    const pts = []
    for (const [x, y] of [[312, 312], [712, 312], [712, 712], [312, 712]]) pts.push(await viewer.clickCanvasPoint(index, x, y))
    await viewer.pressKey(Key.ENTER)
    let shoelace = 0
    pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; shoelace += p.x * sx * q.y * sy - q.x * sx * p.y * sy })
    const area = Math.abs(shoelace) / 2
    const closed = await viewer.probe('lastText', 'mm²')
    assert.ok(closed && numbers(closed).some((n) => Math.abs(n - area) <= area * 0.003 + 0.1), `Đa giác kín: nhãn ${closed}, mong đợi ${area.toFixed(1)} mm²`)
    await viewer.selectMeasureTool('Open polygon')
    await viewer.probe('clearTexts')
    const line = []
    for (const [x, y] of [[300, 800], [500, 700], [700, 800]]) line.push(await viewer.clickCanvasPoint(index, x, y))
    await viewer.pressKey(Key.ENTER)
    const length = mm(line[0], line[1], { sx, sy }) + mm(line[1], line[2], { sx, sy })
    const open = await viewer.probe('lastText', ' mm')
    assert.ok(open && numbers(open).some((n) => Math.abs(n - length) <= 0.15), `Đa giác hở: nhãn ${open}, mong đợi ${length.toFixed(2)} mm`)
    await shot('viewer_36_da_giac')
    await assertClean('E2E-36')
  })

  test('E2E-37: freehand ROI và bút vẽ để lại nét; tẩy xoá được hình chữ nhật đã vẽ', async () => {
    await openCase()
    const index = await expand(truth.sagT1.description)
    await viewer.selectMeasureTool('Freehand ROI')
    await viewer.dragCanvas(index, [300, 300], [600, 500], { steps: 12 })
    assert.ok((await viewer.probe('ink', index, 11)).count > 0, 'Freehand ROI không để lại nét')
    await viewer.selectMeasureTool('Pencil')
    await viewer.dragCanvas(index, [300, 700], [700, 750], { steps: 12 })
    assert.ok((await viewer.probe('ink', index, 7)).count > 0, 'Bút vẽ không để lại nét')
    await viewer.selectMeasureTool('Rectangle')
    await viewer.dragCanvas(index, [450, 150], [650, 300])
    assert.ok((await viewer.probe('ink', index, 6)).count > 0)
    await viewer.selectMeasureTool('Eraser')
    await viewer.dragCanvas(index, [550, 225], [552, 227], { steps: 2 })
    assert.equal((await viewer.probe('ink', index, 6)).count, 0, 'Tẩy không xoá được hình chữ nhật')
    await assertClean('E2E-37')
  })

  test('E2E-38: Clear Measurements xoá mọi phép đo; Reset All trả xoay, âm bản, preset, zoom và công cụ về mặc định', async () => {
    // Màn hình rộng 1600 px để nút Clear Measurements hiện đủ (ở 1366 px nút bị che, xem E2E-47).
    await driver.manage().window().setRect({ width: 1600, height: 1000 })
    await openCase()
    const index = await viewer.indexOf(truth.sagT1.description)
    const base = await viewer.probe('info', index)
    const baseHash = (await viewer.probe('stats', index)).hash
    await viewer.activate(index)
    await viewer.selectMeasureTool('Length')
    await viewer.clickCanvasPoint(index, 300, 500)
    await viewer.clickCanvasPoint(index, 700, 500)
    await viewer.selectMeasureTool('Rectangle')
    await viewer.dragCanvas(index, [300, 300], [600, 600])
    await viewer.clickTool('clearMeasurements')
    for (const overlay of [1, 6]) assert.equal((await viewer.probe('ink', index, overlay)).count, 0, `Còn nét đo ở lớp ${overlay}`)
    await viewer.clickTool('rotate')
    await viewer.clickTool('invert')
    await viewer.selectWLPreset('Bone')
    await viewer.wheel(index, -300, 1, { ctrl: true })
    await viewer.clickTool('reset')
    const after = await viewer.probe('info', index)
    assert.equal(after.transform, base.transform)
    assert.equal((await viewer.probe('stats', index)).hash, baseHash)
    assert.equal(await viewer.isToolActive('brightness'), false)
    await assertClean('E2E-38')
  })

  // ---------------- Đường tham chiếu, kính lúp, chữ trên ảnh, in, cine ----------------

  test('E2E-39: đường tham chiếu: chọn khung axial -> khung sagittal có đường gần nằm ngang, di chuyển khi cuộn axial', async () => {
    await openCase()
    const ax = await viewer.indexOf(truth.ax.description)
    const sag = await viewer.indexOf(truth.sagT1.description)
    await viewer.activate(ax)
    await viewer.clickTool('refLines')
    assert.equal(await viewer.isToolActive('refLines'), true)
    await viewer.wheel(ax, 120, 6)
    const first = await viewer.probe('ink', sag, 15)
    assert.ok(first.count > 0, 'Không có đường tham chiếu trên khung sagittal')
    assert.ok((first.maxX - first.minX) > 5 * (first.maxY - first.minY + 1), `Đường tham chiếu không gần nằm ngang: ${JSON.stringify(first)}`)
    await shot('viewer_39_duong_tham_chieu')
    await viewer.wheel(ax, 120, 8)
    const moved = await viewer.probe('ink', sag, 15)
    assert.ok(Math.abs(moved.meanY - first.meanY) > 5, `Đường tham chiếu không di chuyển: ${first.meanY} -> ${moved.meanY}`)
    await viewer.clickTool('refLines')
    assert.equal((await viewer.probe('ink', sag, 15)).count, 0)
    await assertClean('E2E-39')
  })

  test('E2E-40: kính lúp vẽ vùng phóng đại khi rê chuột trên ảnh', async () => {
    await openCase()
    const index = await viewer.indexOf(truth.sagT1.description)
    await viewer.clickTool('magnify')
    const point = await viewer.probe('canvasToClient', index, 512, 512)
    await driver.actions().move({ origin: Origin.VIEWPORT, x: Math.round(point.x), y: Math.round(point.y) }).press().move({ origin: Origin.VIEWPORT, x: Math.round(point.x) + 3, y: Math.round(point.y) + 3 }).perform()
    await viewer.settle()
    const lens = await viewer.probe('ink', index, 14)
    await shot('viewer_40_kinh_lup')
    await driver.actions().release().perform()
    assert.ok(lens.count > 0, 'Kính lúp không vẽ vùng phóng đại')
    await assertClean('E2E-40')
  })

  test('E2E-41: ẩn/hiện chữ thông tin trên ảnh (Text Overlay)', async () => {
    await openCase()
    for (let i = 0; i < 4; i++) assert.ok((await viewer.probe('info', i)).overlayCount > 0)
    await viewer.clickTool('textOverlay')
    for (let i = 0; i < 4; i++) assert.equal((await viewer.probe('info', i)).overlayCount, 0, `Khung ${i} vẫn còn chữ`)
    await viewer.clickTool('textOverlay')
    for (let i = 0; i < 4; i++) assert.ok((await viewer.probe('info', i)).overlayCount > 0)
    await assertClean('E2E-41')
  })

  test('E2E-42: in DICOM: chọn 2 series -> mở cửa sổ in có đúng 2 ảnh và gọi print()', async () => {
    await openCase()
    await viewer.clickTool('printDicom')
    for (const series of [truth.sagT2, truth.ax]) {
      await (await viewer.waitForVisible(By.xpath(`//div[contains(@class,"fixed") and contains(@class,"inset-0")]//img[@alt="${series.folder}"]/parent::div`))).click()
    }
    await viewer.settle()
    await viewer.waitForVisible(By.xpath('//p[contains(normalize-space(.), "Selected: 2 series") or contains(normalize-space(.), "2 series")]'))
    await shot('viewer_42_in_dicom')
    await (await viewer.waitForVisible(By.xpath('//button[normalize-space(.)="Print" or normalize-space(.)="In"]'))).click()
    await viewer.waitUntil(async () => (await driver.executeScript('return window.__e2e.print')).printed === 1, 'Không gọi print()', 20000)
    const print = await driver.executeScript('return window.__e2e.print')
    assert.deepEqual(print, { opened: 1, printed: 1, images: 2 })
    const handles = await driver.getAllWindowHandles()
    if (handles.length > 1) {
      const main = await driver.getWindowHandle()
      for (const h of handles) if (h !== main) { await driver.switchTo().window(h); await driver.close() }
      await driver.switchTo().window(main)
    }
    await assertClean('E2E-42')
  })

  test('E2E-43: cine ở khung đang chọn tự chuyển lát, dừng thì đứng yên', async () => {
    await openCase()
    const index = await viewer.indexOf(truth.ax.description)
    await viewer.activate(index)
    await viewer.toggleCine(index)
    await driver.sleep(1300)
    const playing = await viewer.sliceOf(index)
    assert.ok(playing.current > 2, `Cine không chạy: ${JSON.stringify(playing)}`)
    await viewer.toggleCine(index)
    await viewer.settle()
    const stopped = await viewer.sliceOf(index)
    await driver.sleep(700)
    assert.deepEqual(await viewer.sliceOf(index), stopped, 'Đã dừng cine nhưng lát vẫn đổi')
    await assertClean('E2E-43')
  })

  async function playCineAndStop(index) {
    await viewer.activate(index)
    await viewer.toggleCine(index)
    await driver.sleep(1300)
    await viewer.toggleCine(index)
    await viewer.settle()
    return viewer.sliceOf(index)
  }

  knownBug('E2E-44 (BUG-21)', 'sau khi dừng cine, lăn chuột tiếp tục từ lát đang xem', /Cuộn sau cine không tiếp tục từ lát đang xem/, async () => {
    await openCase()
    const index = await viewer.indexOf(truth.ax.description)
    const stopped = await playCineAndStop(index)
    await viewer.wheel(index, 120)
    const next = await viewer.sliceOf(index)
    await assertClean('E2E-44')
    assert.equal(next.current, Math.min(stopped.current + 1, stopped.total), `Cuộn sau cine không tiếp tục từ lát đang xem: dừng ở ${stopped.current}, lăn xuống thành ${next.current}`)
  })

  knownBug('E2E-45 (BUG-22)', 'sau cine, bật/tắt âm bản vẫn hiển thị đúng lát ghi trên tiêu đề', /Ảnh hiển thị không khớp lát/, async () => {
    await openCase()
    const index = await viewer.indexOf(truth.ax.description)
    const stopped = await playCineAndStop(index)
    const shown = (await viewer.probe('stats', index)).hash
    await viewer.clickTool('invert')
    await viewer.clickTool('invert')
    const after = (await viewer.probe('stats', index)).hash
    const title = await viewer.sliceOf(index)
    await shot('viewer_45_lech_lat_sau_cine')
    await assertClean('E2E-45')
    assert.deepEqual(title, stopped)
    assert.equal(after, shown, `Ảnh hiển thị không khớp lát: tiêu đề ghi lát ${title.current} nhưng ảnh đã đổi sang lát khác`)
  })

  knownBug('E2E-46 (BUG-23)', 'nút cine ở khung chưa được chọn vẫn phát', /Cine không chạy ở khung chưa được chọn/, async () => {
    await openCase()
    const index = await viewer.indexOf(truth.cor.description)
    await viewer.wheel(index, 120, 3)
    const before = await viewer.sliceOf(index)
    await viewer.toggleCine(index)
    await driver.sleep(1300)
    const after = await viewer.sliceOf(index)
    const label = await (await viewer.viewportButton(index, ['Play cine', 'Stop cine'])).getAttribute('aria-label')
    await assertClean('E2E-46')
    assert.ok(label === 'Stop cine' && after.current !== before.current, `Cine không chạy ở khung chưa được chọn: lát ${before.current} -> ${after.current}, nút "${label}"`)
  })

  knownBug('E2E-47 (BUG-25)', 'ở độ phân giải laptop phổ biến 1366×768, mọi nút thanh công cụ đều thấy và bấm được', /Nút bị che/, async () => {
    await driver.manage().window().setRect({ width: 1366, height: 768 })
    await openCase()
    const hidden = await viewer.hiddenToolbarButtons()
    await shot('viewer_47_thanh_cong_cu_1366')
    await assertClean('E2E-47')
    assert.deepEqual(hidden, [], `Nút bị che hoặc nằm ngoài vùng ảnh: ${hidden.join(', ')}`)
  })

  // SRS (Chương 3, sơ đồ tuần tự và trạng thái): ảnh chỉ được gửi đi phân tích sau khi bác sĩ bấm nút AI.
  knownBug('E2E-48 (BUG-26)', 'nạp thư mục mà chưa bấm nút AI thì không có ảnh DICOM nào bị gửi đi', /Ảnh DICOM bị gửi đi khi chưa bấm phân tích/, async () => {
    const start = mock.uploads.length
    await openCase()
    // Không bấm nút AI nào; chờ tối đa 30 s cho mọi request tự động (nếu có) gửi xong.
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      const fresh = mock.uploads.slice(start)
      if (fresh.length > 0 && fresh.every((u) => u.completed)) break
      await driver.sleep(500)
    }
    const fresh = mock.uploads.slice(start)
    const caseBytes = truth.reduce((sum, s) => sum + seriesFiles(DATA_DIR, s.folder)
      .reduce((n, f) => n + statSync(path.join(DATA_DIR, s.folder, f)).size, 0), 0)
    const seen = (await viewer.probe('requests')).filter((u) => /upload-dicom-zip|\/analyze|\/predict/.test(u))
    const details = fresh.map((u) => `${u.path} ${u.contentType.split(';')[0]} trường "${u.field}" (${u.fileName}) ${(u.bytes / 1048576).toFixed(1)} MB, ${u.zipEntries} mục ZIP, ${u.dicomMagic} chữ ký DICM`)
    console.log(`[E2E-48] Ca kiểm thử ${(caseBytes / 1048576).toFixed(1)} MB; request trình duyệt ghi nhận: ${seen.join(', ') || 'không có'}`)
    await shot('viewer_48_tu_dong_gui_anh')
    await assertClean('E2E-48')
    assert.deepEqual(details, [], `Ảnh DICOM bị gửi đi khi chưa bấm phân tích: ${details.join('; ')}`)
  })
})
