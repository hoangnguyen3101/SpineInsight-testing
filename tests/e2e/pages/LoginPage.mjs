// Mục đích: Page Object của trang đăng nhập (/login): chọn loại tài khoản, nhập thông tin, đọc thông báo lỗi.
import { By } from 'selenium-webdriver'
import { en, vi } from '../i18n.mjs'
import { BasePage, DEFAULT_TIMEOUT } from './BasePage.mjs'

export class LoginPage extends BasePage {
  static PATH = '/login'

  emailInput = By.id('login-email')
  passwordInput = By.id('login-password')
  submitButton = By.css('form button[type="submit"]')
  errorAlert = By.css('form p[role="alert"]')

  /** Tab loại tài khoản tìm theo nhãn hiển thị (tiếng Anh hoặc tiếng Việt). */
  accountTab(role) {
    const labels = [en.auth.login.tabs[role], vi.auth.login.tabs[role]]
    const condition = labels.map((label) => `normalize-space(.)="${label}"`).join(' or ')
    return By.xpath(`//*[@role="tablist"]//button[@role="tab"][${condition}]`)
  }

  async open() {
    await this.goto(LoginPage.PATH)
    await this.waitUntilLoaded()
  }

  async waitUntilLoaded(timeout = DEFAULT_TIMEOUT) {
    await this.waitForVisible(this.emailInput, timeout)
  }

  async selectAccountType(role) {
    const tab = await this.waitForVisible(this.accountTab(role))
    await tab.click()
    await this.driver.wait(async () => (await tab.getAttribute('aria-selected')) === 'true', DEFAULT_TIMEOUT)
  }

  async login({ email, password }, role) {
    await this.selectAccountType(role)
    const emailInput = await this.waitForVisible(this.emailInput)
    await emailInput.clear()
    await emailInput.sendKeys(email)
    const passwordInput = await this.waitForVisible(this.passwordInput)
    await passwordInput.clear()
    await passwordInput.sendKeys(password)
    await (await this.waitForVisible(this.submitButton)).click()
  }

  async errorText(timeout = DEFAULT_TIMEOUT) {
    const alert = await this.waitForVisible(this.errorAlert, timeout)
    return (await alert.getText()).trim()
  }
}
