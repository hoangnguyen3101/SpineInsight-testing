// Mục đích: Page Object cho các trang quản trị: danh sách bệnh viện (admin), tài khoản/bác sĩ và khoa
// (quản lý bệnh viện), cùng hộp thoại xác nhận/thông báo dùng chung (DialogHost) và menu thao tác mỗi dòng.
import { By, Key } from 'selenium-webdriver'
import { translations } from '../i18n.mjs'
import { BasePage, DEFAULT_TIMEOUT } from './BasePage.mjs'

const textIs = (values) => values.map((v) => `normalize-space(.)="${v}"`).join(' or ')
const textHas = (values) => values.map((v) => `contains(normalize-space(.), "${v}")`).join(' or ')

export class ManagementPage extends BasePage {
  modal = By.css('[role="dialog"]')
  alertDialog = By.css('[role="alertdialog"]')

  async openPath(path) {
    await this.goto(path)
    await this.waitForPath(path)
    await this.waitForSignedInShell()
  }

  async clickButtonText(keys) {
    const button = await this.waitForVisible(By.xpath(`//main//button[${textHas(keys.flatMap((k) => translations(k)))}]`))
    await button.click()
  }

  async waitForRow(text, timeout = DEFAULT_TIMEOUT) {
    return this.waitForVisible(By.xpath(`//table//tr[.//*[normalize-space(.)="${text}"]]`), timeout)
  }

  async rowText(text) {
    return (await this.waitForRow(text)).getText()
  }

  async rowCount() {
    return (await this.driver.findElements(By.css('table tbody tr'))).length
  }

  /**
   * Mở menu "Thao tác" của dòng rồi chọn mục theo khoá i18n. `name` là nhãn của menu: tên bệnh viện ở trang bệnh
   * viện, email ở trang tài khoản/bác sĩ.
   */
  async rowAction(name, actionKey) {
    const labels = translations('admin.fields.actions').map((a) => `${a} ${name}`)
    await (await this.waitForVisible(By.css(labels.map((l) => `button[aria-label="${l}"]`).join(', ')))).click()
    await (await this.waitForVisible(By.xpath(`//*[@role="menuitem"][${textIs(translations(actionKey))}]`))).click()
  }

  async dialog() {
    const dialog = await this.waitForVisible(this.alertDialog)
    return { title: await dialog.findElement(By.css('h2')).getText(), text: await dialog.getText() }
  }

  /**
   * Bấm nút cuối (xác nhận/OK) của hộp thoại xác nhận hoặc thông báo, rồi chờ hộp thoại đó đóng hoặc được thay
   * bằng hộp thoại khác (ví dụ thông báo kết quả ngay sau hộp xác nhận).
   */
  async confirmDialog() {
    const dialog = await this.waitForVisible(this.alertDialog)
    const before = await dialog.getText()
    const buttons = await dialog.findElements(By.css('button'))
    await buttons[buttons.length - 1].click()
    await this.driver.wait(async () => {
      const open = await this.driver.findElements(this.alertDialog)
      if (open.length === 0) return true
      try {
        return (await open[0].getText()) !== before
      } catch {
        return true
      }
    }, DEFAULT_TIMEOUT, 'Hộp thoại không đóng')
  }

  async type(id, value) {
    const input = await this.waitForVisible(By.id(id))
    await input.click()
    await this.driver.actions().keyDown(Key.CONTROL).sendKeys('a').keyUp(Key.CONTROL).sendKeys(Key.BACK_SPACE).perform()
    if (value) await input.sendKeys(value)
    return input
  }

  async value(id) {
    return (await this.driver.findElement(By.id(id))).getAttribute('value')
  }

  async submitModal() {
    const modal = await this.waitForVisible(this.modal)
    await (await modal.findElement(By.css('button[type="submit"]'))).click()
  }

  async modalAlerts() {
    const modal = await this.waitForVisible(this.modal)
    const alerts = await modal.findElements(By.css('[role="alert"]'))
    return Promise.all(alerts.map((a) => a.getText()))
  }

  async modalText() {
    return (await this.waitForVisible(this.modal)).getText()
  }

  async waitModalClosed(timeout = DEFAULT_TIMEOUT) {
    await this.driver.wait(async () => (await this.driver.findElements(this.modal)).length === 0, timeout, 'Hộp thoại không đóng')
  }
}

export class HospitalsAdminPage extends ManagementPage {
  static PATH = '/admin/hospitals'

  async openCreateForm() {
    await this.clickButtonText(['admin.hospitals.add'])
    await this.waitForVisible(By.id('h-name'))
  }

  async deleteHospital(name, code) {
    await this.rowAction(name, 'admin.hospitals.delete.action')
    const submit = await this.waitForVisible(By.css('[role="dialog"] button[type="submit"]'))
    const disabledBefore = !(await submit.isEnabled())
    await this.type('delete-code', code)
    await submit.click()
    return { disabledBefore }
  }
}

export class AccountsManagementPage extends ManagementPage {
  async openCreateForm(addKey) {
    await this.clickButtonText([addKey])
    await this.waitForVisible(By.id('a-name'))
  }
}

export class DepartmentsPage extends ManagementPage {
  static PATH = '/hospital/departments'

  async openCreateForm() {
    await this.clickButtonText(['departments.add'])
    await this.waitForVisible(By.id('dept-name'))
  }
}
