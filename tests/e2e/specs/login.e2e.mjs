// Kịch bản E2E đăng nhập và điều hướng theo vai trò (FR-01, FR-04) - xem Test Plan chương 4.
// Chạy qua `npm run test:e2e` (tests/e2e/run.mjs mở sẵn ứng dụng và đặt E2E_BASE_URL, E2E_MOCK_PORT).
import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { createDriver } from '../driver.mjs'
import { translations } from '../i18n.mjs'
import { ACCOUNTS } from '../fixtures/accounts.mjs'
import { createMockServer } from '../fixtures/mockServer.mjs'
import { LoginPage } from '../pages/LoginPage.mjs'

const BASE_URL = process.env.E2E_BASE_URL
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT)

/**
 * Lỗi đã biết: kịch bản phải thất bại đúng với `expectedError` (lỗi khác vẫn báo đỏ);
 * khi lỗi được sửa kịch bản sẽ báo đỏ để nhắc bỏ knownBug.
 */
function knownBug(id, name, expectedError, fn) {
  test(`${id} [lỗi đã biết]: ${name}`, async () => {
    await assert.rejects(fn, expectedError, `${id} đã được sửa: chuyển kịch bản này về test thường`)
  })
}

/** Chạy bước kiểm tra rồi luôn chụp ảnh minh chứng, kể cả khi bước đó thất bại. */
async function checkpoint(page, screenshotName, fn) {
  try {
    return await fn()
  } finally {
    await page.screenshot(screenshotName)
  }
}

describe('E2E đăng nhập và điều hướng theo vai trò', () => {
  let mock
  let driver
  let loginPage

  const sessionKeys = () => driver.executeScript(
    'return Object.keys(localStorage).filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))',
  )

  before(async () => {
    assert.ok(BASE_URL && MOCK_PORT, 'Thiếu E2E_BASE_URL/E2E_MOCK_PORT: hãy chạy bằng npm run test:e2e')
    mock = createMockServer()
    await mock.listen(MOCK_PORT)
  })

  after(async () => {
    await mock?.close()
  })

  beforeEach(async () => {
    driver = await createDriver()
    loginPage = new LoginPage(driver, BASE_URL)
  })

  afterEach(async () => {
    await driver?.quit()
  })

  test('E2E-01: chưa đăng nhập mở /admin -> chuyển về /login', async () => {
    await loginPage.goto('/admin')
    await checkpoint(loginPage, 'e2e_01_chua_dang_nhap_vao_admin', async () => {
      await loginPage.waitForPath(LoginPage.PATH)
      await loginPage.waitUntilLoaded()
    })
  })

  test('E2E-02: sai mật khẩu -> báo "Email hoặc mật khẩu không đúng", ở lại /login', async () => {
    await loginPage.open()
    await loginPage.login({ email: ACCOUNTS.doctor.email, password: 'SaiMatKhau@1' }, 'doctor')
    const message = await checkpoint(loginPage, 'e2e_02_sai_mat_khau', () => loginPage.errorText())
    assert.ok(translations('auth.login.errors.invalidCredentials').includes(message), `Thông báo thực tế: ${message}`)
    assert.equal(await loginPage.currentPath(), LoginPage.PATH)
  })

  test('E2E-03: admin đăng nhập -> /admin/hospitals', async () => {
    await loginPage.open()
    await loginPage.login(ACCOUNTS.admin, 'admin')
    await checkpoint(loginPage, 'e2e_03_admin_dang_nhap', async () => {
      await loginPage.waitForPath('/admin/hospitals')
      await loginPage.waitForSignedInShell()
    })
  })

  test('E2E-04: quản lý bệnh viện đăng nhập -> /hospital/doctors', async () => {
    await loginPage.open()
    await loginPage.login(ACCOUNTS.hospital, 'hospital')
    await checkpoint(loginPage, 'e2e_04_benh_vien_dang_nhap', async () => {
      await loginPage.waitForPath('/hospital/doctors')
      await loginPage.waitForSignedInShell()
    })
  })

  test('E2E-05: bác sĩ đăng nhập -> /viewer', async () => {
    await loginPage.open()
    await loginPage.login(ACCOUNTS.doctor, 'doctor')
    await checkpoint(loginPage, 'e2e_05_bac_si_dang_nhap', async () => {
      await loginPage.waitForPath('/viewer')
      await loginPage.waitForSignedInShell()
    })
  })

  test('E2E-06: tài khoản bị khoá (backend trả 403) -> báo không có quyền, huỷ phiên', async () => {
    await loginPage.open()
    await loginPage.login(ACCOUNTS.locked, 'doctor')
    const message = await checkpoint(loginPage, 'e2e_06_tai_khoan_bi_khoa', () => loginPage.errorText())
    assert.ok(translations('auth.login.errors.noAccess').includes(message), `Thông báo thực tế: ${message}`)
    assert.equal(await loginPage.currentPath(), LoginPage.PATH)
    assert.deepEqual(await sessionKeys(), [], 'Phiên Supabase phải bị xoá khỏi localStorage')
  })

  test('E2E-07: tài khoản bác sĩ đăng nhập ở tab Quản trị -> báo sai loại tài khoản, huỷ phiên', async () => {
    await loginPage.open()
    await loginPage.login(ACCOUNTS.doctor, 'admin')
    const message = await checkpoint(loginPage, 'e2e_07_sai_loai_tai_khoan', () => loginPage.errorText())
    const expected = translations('auth.login.errors.wrongRole', { role: (dict) => dict.auth.role.admin })
    assert.ok(expected.includes(message), `Thông báo thực tế: ${message}`)
    assert.equal(await loginPage.currentPath(), LoginPage.PATH)
    assert.deepEqual(await sessionKeys(), [], 'Phiên Supabase phải bị xoá khỏi localStorage')
  })

  test('E2E-08: bác sĩ đã đăng nhập mở /admin -> bị chuyển về /viewer', async () => {
    await loginPage.open()
    await loginPage.login(ACCOUNTS.doctor, 'doctor')
    await loginPage.waitForPath('/viewer')
    await loginPage.goto('/admin')
    await checkpoint(loginPage, 'e2e_08_bac_si_vao_admin', async () => {
      await loginPage.waitForSignedInShell()
      await loginPage.waitForPath('/viewer')
    })
  })

  // Theo SRS, các chức năng xem/đo/phân tích ảnh chỉ dành cho bác sĩ; App.tsx bọc /viewer bằng
  // RequireAuth không truyền roles nên admin vẫn vào được.
  knownBug('E2E-09 (BUG-15)', 'admin mở /viewer phải bị chuyển về khu vực /admin', /Admin vẫn ở \/viewer/, async () => {
    await loginPage.open()
    await loginPage.login(ACCOUNTS.admin, 'admin')
    await loginPage.waitForPath('/admin/hospitals')
    await loginPage.goto('/viewer')
    await checkpoint(loginPage, 'e2e_09_admin_vao_viewer', async () => {
      await loginPage.waitForSignedInShell()
      const pathname = await loginPage.currentPath()
      assert.match(pathname, /^\/admin/, `Admin vẫn ở ${pathname}`)
    })
  })
})
