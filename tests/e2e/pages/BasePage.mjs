// Mục đích: Lớp cơ sở của Page Object: mở trang, đọc đường dẫn hiện tại, chờ tường minh và chụp ảnh minh chứng.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { By, until } from 'selenium-webdriver'
import { en, vi } from '../i18n.mjs'

export const SCREENSHOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'reports', 'e2e', 'screenshots')
export const DEFAULT_TIMEOUT = 15000

export class BasePage {
  constructor(driver, baseUrl) {
    this.driver = driver
    this.baseUrl = baseUrl
  }

  /** Mở trực tiếp một đường dẫn của ứng dụng (tải lại toàn trang, như gõ vào thanh địa chỉ). */
  async goto(pathname) {
    await this.driver.get(`${this.baseUrl}${pathname}`)
  }

  currentPath() {
    return this.driver.executeScript('return window.location.pathname')
  }

  /** Chờ tới khi đường dẫn khớp `expected` (chuỗi hoặc RegExp); hết giờ thì báo đường dẫn thực tế. */
  async waitForPath(expected, timeout = DEFAULT_TIMEOUT) {
    const matches = (value) => (expected instanceof RegExp ? expected.test(value) : value === expected)
    try {
      await this.driver.wait(async () => matches(await this.currentPath()), timeout)
    } catch {
      throw new Error(`Đường dẫn mong đợi ${expected}, thực tế ${await this.currentPath()}`)
    }
  }

  /** Nút "Đăng xuất" của UserMenu chỉ hiện khi đã đăng nhập và trang đã dựng xong (cả 3 khu vực đều có). */
  async waitForSignedInShell(timeout = DEFAULT_TIMEOUT) {
    const labels = [en.auth.logout, vi.auth.logout]
    const locator = By.css(labels.map((label) => `button[aria-label="${label}"]`).join(', '))
    await this.driver.wait(async () => {
      const buttons = await this.driver.findElements(locator)
      for (const button of buttons) {
        if (await button.isDisplayed()) return true
      }
      return false
    }, timeout, 'Không thấy giao diện sau đăng nhập (nút Đăng xuất)')
  }

  async waitForVisible(locator, timeout = DEFAULT_TIMEOUT) {
    const element = await this.driver.wait(until.elementLocated(locator), timeout)
    await this.driver.wait(until.elementIsVisible(element), timeout)
    return element
  }

  async screenshot(name) {
    await mkdir(SCREENSHOT_DIR, { recursive: true })
    const png = await this.driver.takeScreenshot()
    const file = path.join(SCREENSHOT_DIR, `${name}.png`)
    await writeFile(file, png, 'base64')
    return file
  }
}
