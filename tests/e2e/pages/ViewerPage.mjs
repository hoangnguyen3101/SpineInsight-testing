// Mục đích: Page Object của màn hình đọc ảnh (/viewer): nạp thư mục DICOM, thao tác thanh công cụ, chia khung,
// thao tác chuột trên từng khung xem và đọc trạng thái khách quan qua window.__e2e (pages/viewerProbe.js).
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { By, Key, Origin, until } from 'selenium-webdriver'
import { en, vi } from '../i18n.mjs'
import { BasePage, DEFAULT_TIMEOUT } from './BasePage.mjs'

const PROBE_SOURCE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'viewerProbe.js'), 'utf8')
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])
// Phông chữ tĩnh của Google (index.html) là request ra ngoài duy nhất được phép; không mang dữ liệu người dùng.
const ALLOWED_EXTERNAL_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])

const label = (key) => {
  const pick = (dict) => key.split('.').reduce((node, part) => node?.[part], dict)
  return [pick(en), pick(vi)].filter(Boolean)
}
const byAriaLabels = (labels) => By.css(labels.map((text) => `button[aria-label="${text}"]`).join(', '))

export class ViewerPage extends BasePage {
  static PATH = '/viewer'

  folderInput = By.css('input[type="file"][webkitdirectory]')
  gridButton = By.css('button[title="Grid layout"]')
  wlButton = By.css('button[aria-label="Window presets"]')
  measureOptionsButton = By.css('button[aria-label="Measure options"]')

  /** Phải gọi trước khi mở trang: chèn probe vào mọi tài liệu để bắt cả lỗi xảy ra lúc tải. */
  async installProbe() {
    await this.driver.sendDevToolsCommand('Page.addScriptToEvaluateOnNewDocument', { source: PROBE_SOURCE })
  }

  probe(fn, ...args) {
    return this.driver.executeScript(`return window.__e2e.${fn}(...arguments)`, ...args)
  }

  async settle(ms = 350) {
    await this.driver.sleep(ms)
    await this.driver.executeScript('return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')
  }

  // ---------- Nạp dữ liệu ----------

  async loadFolder(dir) {
    // Ô chọn thư mục bị ẩn (class hidden): chỉ chờ có trong DOM rồi gửi đường dẫn thư mục.
    const input = await this.driver.wait(until.elementLocated(this.folderInput), 60000, 'Không thấy ô chọn thư mục DICOM')
    const started = Date.now()
    await input.sendKeys(dir)
    return started
  }

  async seriesItems() {
    return this.driver.executeScript(`
      return [...document.querySelectorAll('aside [draggable="true"], [draggable="true"]')]
        .filter((el) => el.querySelector('p') && el.closest('main') === null)
        .map((el) => ({ name: el.querySelector('p').innerText.trim(), count: Number(el.querySelector('span')?.innerText || NaN) }))`)
  }

  async waitForViewports(count, timeout = 60000) {
    await this.driver.wait(async () => (await this.probe('count')) === count, timeout, `Không đủ ${count} khung xem`)
  }

  /** Chờ khung xem `index` vẽ xong ảnh (canvas có kích thước và có điểm sáng). */
  async waitForImage(index, timeout = 30000) {
    let last
    await this.driver.wait(async () => {
      try {
        last = await this.probe('stats', index)
        return last.width > 0 && last.nonBlank > 0.01
      } catch {
        return false
      }
    }, timeout, `Khung ${index} chưa hiển thị ảnh (${JSON.stringify(last)})`)
    return last
  }

  // ---------- Thanh công cụ ----------

  async clickTool(i18nKey) {
    const button = await this.waitForVisible(byAriaLabels(label(`viewer.toolbar.${i18nKey}`)))
    await button.click()
    await this.settle()
  }

  async clickButtonByLabel(text) {
    await (await this.waitForVisible(byAriaLabels([text]))).click()
    await this.settle()
  }

  async isToolActive(i18nKey) {
    const button = await this.waitForVisible(byAriaLabels(label(`viewer.toolbar.${i18nKey}`)))
    return (await button.getAttribute('class')).includes('bg-primary/10')
  }

  async selectLayout(rows, cols) {
    await (await this.waitForVisible(this.gridButton)).click()
    const cells = await this.driver.findElements(By.xpath('//button[@title="Grid layout"]/following-sibling::div//button'))
    await cells[(rows - 1) * 5 + (cols - 1)].click()
    await this.settle()
  }

  async selectWLPreset(name) {
    await (await this.waitForVisible(this.wlButton)).click()
    const option = await this.waitForVisible(By.xpath(`//button[@aria-label="Window presets"]/following-sibling::div//button[starts-with(normalize-space(.), "${name}")]`))
    await option.click()
    await this.settle(500)
  }

  async selectMeasureTool(name) {
    await (await this.waitForVisible(this.measureOptionsButton)).click()
    const option = await this.waitForVisible(By.xpath(`//button[@aria-label="Measure options"]/ancestor::div[contains(@class,"relative")][1]//button[.//span[normalize-space(.)="${name}"]]`))
    await option.click()
    await this.settle()
  }

  // ---------- Khung xem và chuột ----------

  async viewportButton(index, ariaLabels) {
    const roots = await this.driver.findElements(By.xpath('//button[@aria-label="Play cine" or @aria-label="Stop cine"]/ancestor::div[contains(@class,"rounded-lg") and contains(@class,"bg-black")][1]'))
    return roots[index].findElement(byAriaLabels(ariaLabels))
  }

  async clickViewportTitleButton(index, i18nKey) {
    await (await this.viewportButton(index, label(`viewer.viewport.${i18nKey}`))).click()
    await this.settle()
  }

  async toggleCine(index) {
    await (await this.viewportButton(index, ['Play cine', 'Stop cine'])).click()
  }

  async containerCenter(index) {
    const info = await this.probe('info', index)
    return { x: Math.round(info.container.left + info.container.width / 2), y: Math.round(info.container.top + info.container.height / 2) }
  }

  /** Chọn khung đang hoạt động bằng một lần nhấn chuột (mousedown) ở góc khung, ngoài vùng ảnh. */
  async activate(index) {
    const info = await this.probe('info', index)
    const x = Math.round(info.container.left + 6)
    const y = Math.round(info.container.top + info.container.height - 6)
    await this.driver.actions().move({ origin: Origin.VIEWPORT, x, y }).press().release().perform()
    await this.settle()
  }

  async clickAt(point) {
    await this.driver.actions().move({ origin: Origin.VIEWPORT, x: Math.round(point.x), y: Math.round(point.y) }).click().perform()
    await this.settle(120)
  }

  /**
   * Bấm vào điểm ảnh (x, y) của khung `index`. Vì WebDriver chỉ bấm được ở toạ độ nguyên, hàm trả về toạ độ
   * điểm ảnh thực sự nằm dưới vị trí đã bấm (tính ngược bằng ma trận CSS) để làm đáp án đo đạc.
   */
  async clickCanvasPoint(index, x, y) {
    const client = await this.probe('canvasToClient', index, x, y)
    const rounded = { x: Math.round(client.x), y: Math.round(client.y) }
    const actual = await this.probe('clientToCanvas', index, rounded.x, rounded.y)
    await this.clickAt(rounded)
    return actual
  }

  async exactPoint(index, x, y) {
    const client = await this.probe('canvasToClient', index, x, y)
    const rounded = { x: Math.round(client.x), y: Math.round(client.y) }
    return { client: rounded, canvas: await this.probe('clientToCanvas', index, rounded.x, rounded.y) }
  }

  /** Gán series cho ô trống thứ `slot` của lưới: chọn series ở thanh bên rồi bấm vào ô. */
  async assignSeries(seriesName, slot) {
    const item = await this.waitForVisible(By.xpath(`//*[@draggable="true"][.//p[normalize-space(.)="${seriesName}"]]`))
    await item.click()
    const cells = await this.driver.findElements(By.css('main div.grid > *'))
    await cells[slot].click()
    await this.settle()
  }

  /** Chỉ số khung đang hiển thị series có mô tả `description` (đọc từ thanh tiêu đề). */
  async indexOf(description) {
    const count = await this.probe('count')
    for (let i = 0; i < count; i++) {
      const { title } = await this.probe('info', i)
      if (title.includes(` - ${description} [`)) return i
    }
    throw new Error(`Không có khung nào hiển thị ${description}`)
  }

  async drag(from, to, { steps = 8, shift = false } = {}) {
    const actions = this.driver.actions()
    if (shift) actions.keyDown(Key.SHIFT)
    actions.move({ origin: Origin.VIEWPORT, x: Math.round(from.x), y: Math.round(from.y) }).press()
    for (let i = 1; i <= steps; i++) {
      actions.move({
        origin: Origin.VIEWPORT,
        x: Math.round(from.x + ((to.x - from.x) * i) / steps),
        y: Math.round(from.y + ((to.y - from.y) * i) / steps),
        duration: 20,
      })
    }
    actions.release()
    if (shift) actions.keyUp(Key.SHIFT)
    await actions.perform()
    await this.settle()
  }

  async dragCanvas(index, from, to, options) {
    const a = await this.probe('canvasToClient', index, from[0], from[1])
    const b = await this.probe('canvasToClient', index, to[0], to[1])
    await this.drag(a, b, options)
  }

  /** Lăn chuột thật (WebDriver wheel) trên tâm khung; deltaY > 0 là lăn xuống. */
  async wheel(index, deltaY, times = 1, { ctrl = false } = {}) {
    const center = await this.containerCenter(index)
    for (let i = 0; i < times; i++) {
      const actions = this.driver.actions()
      if (ctrl) actions.keyDown(Key.CONTROL)
      actions.scroll(center.x, center.y, 0, deltaY, Origin.VIEWPORT)
      if (ctrl) actions.keyUp(Key.CONTROL)
      await actions.perform()
      await this.driver.sleep(60)
    }
    await this.settle()
  }

  async pressKey(key, times = 1) {
    for (let i = 0; i < times; i++) {
      await this.driver.actions().sendKeys(key).perform()
      await this.driver.sleep(80)
    }
    await this.settle()
  }

  /** Nhấn tổ hợp Ctrl+phím (giữ Ctrl trong suốt lần nhấn, như người dùng thật). */
  async pressCtrl(key) {
    await this.driver.actions().keyDown(Key.CONTROL).sendKeys(key).keyUp(Key.CONTROL).perform()
    await this.settle()
  }

  /** Các nút thanh công cụ không hiển thị được hoặc nằm ngoài cột hiển thị ảnh (main). */
  async hiddenToolbarButtons() {
    const buttons = await this.driver.findElements(By.css('header .rounded-xl button'))
    const main = await this.driver.executeScript('const r = document.querySelector("main").getBoundingClientRect(); return { left: r.left, right: r.right }')
    const hidden = []
    for (const button of buttons) {
      const name = (await button.getAttribute('aria-label')) || (await button.getAttribute('title')) || (await button.getText())
      const rect = await button.getRect()
      if (!(await button.isDisplayed()) || rect.x < main.left - 1 || rect.x + rect.width > main.right + 1) hidden.push(name)
    }
    return hidden
  }

  /** Chỉ số lát đang hiển thị, đọc từ thanh tiêu đề dạng "[k/n]". */
  async sliceOf(index) {
    const { title } = await this.probe('info', index)
    const match = title.match(/\[(\d+)\/(\d+)\]/)
    return match ? { current: Number(match[1]), total: Number(match[2]) } : null
  }

  async elementScreenshot(index) {
    const roots = await this.driver.findElements(By.xpath('//button[@aria-label="Play cine" or @aria-label="Stop cine"]/ancestor::div[contains(@class,"rounded-lg") and contains(@class,"bg-black")][1]'))
    const container = await roots[index].findElement(By.xpath('./div[2]'))
    return container.takeScreenshot()
  }

  /** Lỗi JavaScript ngoài các thông báo đã biết của luồng AI bị tắt trong E2E. */
  async unexpectedErrors(allowed = []) {
    const errors = await this.driver.executeScript('return window.__e2e ? window.__e2e.errors : []')
    return errors.filter((e) => !/P2VG|AI service disabled|AI report service|Failed to load resource/.test(e.message))
      .filter((e) => !allowed.some((re) => re.test(e.message)))
  }

  async externalRequests() {
    const urls = await this.probe('requests')
    return urls.filter((u) => {
      const host = new URL(u).hostname
      return !LOCAL_HOSTS.has(host) && !ALLOWED_EXTERNAL_HOSTS.has(host)
    })
  }

  async waitUntil(fn, message, timeout = DEFAULT_TIMEOUT) {
    await this.driver.wait(fn, timeout, message)
  }
}
