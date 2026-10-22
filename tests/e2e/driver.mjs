// Mục đích: Tạo phiên Chrome cho Selenium (mặc định headless; đặt E2E_HEADED=1 để xem trình duyệt).
import { Builder, Browser } from 'selenium-webdriver'
import chrome from 'selenium-webdriver/chrome.js'

export async function createDriver() {
  const options = new chrome.Options()
  if (process.env.E2E_HEADED !== '1') {
    options.addArguments('--headless=new')
  }
  options.addArguments(
    '--window-size=1366,900',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
    '--lang=en-US',
  )

  const driver = await new Builder().forBrowser(Browser.CHROME).setChromeOptions(options).build()
  await driver.manage().setTimeouts({ pageLoad: 30000, script: 10000 })
  return driver
}
