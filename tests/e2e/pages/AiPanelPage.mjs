// Mục đích: Page Object của khung AI bên phải màn hình đọc ảnh: nút phân tích RSNA, danh sách phát hiện,
// trình soạn báo cáo P2VG (findings/impression) và nút in phiếu kết quả.
import { By, Key } from 'selenium-webdriver'
import { translations } from '../i18n.mjs'
import { BasePage, DEFAULT_TIMEOUT } from './BasePage.mjs'

const attrIn = (attr, values) => values.map((v) => `@${attr}="${v}"`).join(' or ')

export class AiPanelPage extends BasePage {
  analyzeTitles = [...translations('ai.spineAnalysis.buttonTitleIdle'), ...translations('ai.spineAnalysis.buttonTitleLoading')]
  panel = By.xpath(`//aside[.//button[${attrIn('title', this.analyzeTitles)}]]`)
  analyzeButton = By.xpath(`//aside//button[${attrIn('title', this.analyzeTitles)}]`)
  findingsInput = By.css(translations('ai.report.findingsPlaceholder').map((p) => `textarea[placeholder="${p}"]`).join(', '))
  impressionInput = By.css(translations('ai.report.impressionPlaceholder').map((p) => `textarea[placeholder="${p}"]`).join(', '))
  generateButton = By.xpath(`//aside//button[${translations('ai.report.generate').map((t) => `contains(normalize-space(.), "${t}")`).join(' or ')}]`)
  printButton = By.xpath('//aside//button[.//span[normalize-space(.)="print"]]')

  async text() {
    return (await this.waitForVisible(this.panel)).getText()
  }

  async analyze() {
    await (await this.waitForVisible(this.analyzeButton)).click()
  }

  /** Đọc trạng thái qua thuộc tính title của nút phân tích (đọc bằng script để tránh phần tử bị React vẽ lại). */
  async isAnalyzing() {
    const loading = translations('ai.spineAnalysis.buttonTitleLoading')
    return this.driver.executeScript(
      'return [...document.querySelectorAll("aside button[title]")].some((b) => arguments[0].includes(b.getAttribute("title")))',
      loading,
    )
  }

  async waitForAnalysisEnd(timeout = 60000) {
    await this.driver.wait(async () => !(await this.isAnalyzing()), timeout, 'Phân tích AI không kết thúc')
  }

  /** Mở nhóm bệnh lý (SCS/NFN/SS) và trả về các dòng phát hiện dạng { label, severity, percent }. */
  async openCondition(conditionKey) {
    const labels = translations(`ai.findings.${conditionKey}`)
    const button = await this.waitForVisible(By.xpath(`//aside//button[.//span[${labels.map((l) => `contains(normalize-space(.), "${l}")`).join(' or ')}]]`))
    await button.click()
    await this.driver.sleep(200)
    return this.findingRows()
  }

  async findingRows() {
    return this.driver.executeScript(`
      return [...document.querySelectorAll('aside div[title]')]
        .filter((el) => el.querySelector('button') && /%/.test(el.innerText))
        .map((el) => ({ title: el.getAttribute('title'), text: el.innerText.replace(/\\s+/g, ' ').trim() }))`)
  }

  async clickFinding(level) {
    const row = await this.waitForVisible(By.xpath(`//aside//div[@title][.//span[contains(normalize-space(.), "${level}")]][.//button]`))
    await row.click()
    await this.driver.sleep(400)
  }

  async confirmFinding(level) {
    const button = await this.waitForVisible(By.xpath(`//aside//div[@title][.//span[contains(normalize-space(.), "${level}")]]//button`))
    await button.click()
    await this.driver.sleep(300)
  }

  async waitForReport(timeout = 60000) {
    await this.driver.wait(async () => (await this.driver.findElements(this.findingsInput)).length > 0, timeout, 'Báo cáo không xuất hiện trong trình soạn')
  }

  async reportValues() {
    const findings = await this.driver.findElement(this.findingsInput).getAttribute('value')
    const impression = await this.driver.findElement(this.impressionInput).getAttribute('value')
    return { findings, impression }
  }

  async appendToFindings(text) {
    const area = await this.waitForVisible(this.findingsInput)
    await area.click()
    await area.sendKeys(Key.chord(Key.CONTROL, Key.END), text)
  }

  async replaceImpression(text) {
    const area = await this.waitForVisible(this.impressionInput)
    await area.click()
    await this.driver.actions().keyDown(Key.CONTROL).sendKeys('a').keyUp(Key.CONTROL).perform()
    await area.sendKeys(Key.BACK_SPACE, text)
  }

  async printReport() {
    await (await this.waitForVisible(this.printButton)).click()
    await this.driver.wait(async () => (await this.driver.executeScript('return window.__e2e.printedReports.length')) > 0, DEFAULT_TIMEOUT, 'Không gọi in phiếu kết quả')
    return this.driver.executeScript('return window.__e2e.printedReports[window.__e2e.printedReports.length - 1]')
  }
}
