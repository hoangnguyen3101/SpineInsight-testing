// Kịch bản E2E luồng quản trị theo SRS Chương 3 (FR-11, FR-12, FR-13): admin quản lý bệnh viện, quản lý
// bệnh viện quản lý khoa và tài khoản bác sĩ, bác sĩ chỉ thấy dữ liệu bệnh viện của mình. Backend do máy chủ giả
// mô phỏng trong bộ nhớ (fixtures/mockBackend.mjs) theo quy tắc của controller/service backend; kịch bản kiểm tra
// cả giao diện lẫn request frontend gửi đi (method, đường dẫn, body). Không cần dữ liệu ảnh.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import { By } from 'selenium-webdriver'
import { createDriver } from '../driver.mjs'
import { translations } from '../i18n.mjs'
import { ACCOUNTS, HOSPITAL } from '../fixtures/accounts.mjs'
import { createBackendState } from '../fixtures/mockBackend.mjs'
import { createMockServer } from '../fixtures/mockServer.mjs'
import { AccountsManagementPage, DepartmentsPage, HospitalsAdminPage } from '../pages/AdminPages.mjs'
import { LoginPage } from '../pages/LoginPage.mjs'

const BASE_URL = process.env.E2E_BASE_URL
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT)

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

const oneOf = (key) => translations(key)
const includesAny = (text, key, params) => translations(key, params).some((t) => text.includes(t))

describe('E2E quản trị bệnh viện, khoa và tài khoản', () => {
  let mock
  let driver
  let mark

  /** Các request quản trị kể từ đầu kịch bản, lọc theo method và mẫu đường dẫn. */
  const calls = (method, pattern) => mock.backend.calls.slice(mark).filter((c) => c.method === method && pattern.test(c.path))

  async function loginAs(role) {
    const login = new LoginPage(driver, BASE_URL)
    await login.open()
    await login.login(ACCOUNTS[role], role)
    await login.waitForPath(role === 'admin' ? '/admin/hospitals' : role === 'hospital' ? '/hospital/doctors' : '/viewer')
  }

  before(async () => {
    assert.ok(BASE_URL && MOCK_PORT, 'Thiếu E2E_BASE_URL/E2E_MOCK_PORT: hãy chạy bằng npm run test:e2e')
    mock = createMockServer()
    await mock.listen(MOCK_PORT)
  })

  after(async () => {
    await mock?.close()
  })

  beforeEach(async () => {
    Object.assign(mock.backend, createBackendState())
    mark = 0
    driver = await createDriver()
  })

  afterEach(async () => {
    await driver?.quit()
  })

  test('E2E-59: admin thêm bệnh viện: mã 5 ký tự bị chặn, 6 ký tự hợp lệ (BVA), 31 ký tự bị cắt còn 30; hiện tài khoản quản lý', async () => {
    await loginAs('admin')
    const page = new HospitalsAdminPage(driver, BASE_URL)
    await page.openCreateForm()
    await page.type('h-name', 'Benh vien Kiem thu E2E')
    assert.equal(await page.value('h-code'), 'BV-KIEM-THU-E2E', 'Mã gợi ý từ tên')
    await page.type('h-code', 'A'.repeat(31))
    assert.equal((await page.value('h-code')).length, 30, 'Ô mã phải giới hạn 30 ký tự')
    await page.type('h-code', 'ABCDE')
    await page.submitModal()
    const alerts = await page.modalAlerts()
    assert.ok(alerts.some((a) => oneOf('admin.errors.invalidCode').includes(a)), `Mã 5 ký tự phải báo lỗi: ${JSON.stringify(alerts)}`)
    assert.ok(includesAny(await page.modalText(), 'admin.hospitals.form.accountPreviewEmpty'))
    assert.equal(calls('POST', /^\/api\/v1\/hospitals$/).length, 0, 'Mã không hợp lệ không được gửi lên')
    await page.type('h-code', 'ABCDE1')
    const preview = await page.modalText()
    assert.match(preview, /abcde1@spineinsight\.vn/)
    await page.submitModal()
    const dialog = await page.dialog()
    assert.ok(includesAny(dialog.title, 'admin.hospitals.created', { name: () => 'Benh vien Kiem thu E2E' }), `Tiêu đề: ${dialog.title}`)
    assert.match(dialog.text, /abcde1@spineinsight\.vn/)
    assert.match(dialog.text, /ABCDE1/)
    const posts = calls('POST', /^\/api\/v1\/hospitals$/)
    assert.equal(posts.length, 1)
    assert.deepEqual(posts[0].body, { code: 'ABCDE1', name: 'Benh vien Kiem thu E2E' })
    await page.screenshot('admin_59_tao_benh_vien')
    await page.confirmDialog()
    const row = await page.rowText('ABCDE1')
    assert.match(row, /Benh vien Kiem thu E2E/)
  })

  test('E2E-60: admin tạm ngưng rồi mở lại hợp tác với bệnh viện (có hộp xác nhận, gửi PATCH status)', async () => {
    await loginAs('admin')
    const page = new HospitalsAdminPage(driver, BASE_URL)
    await page.waitForRow(HOSPITAL.code)
    await page.rowAction(HOSPITAL.name, 'admin.hospitals.suspend')
    await page.confirmDialog()
    await page.driver.wait(async () => includesAny(await page.rowText(HOSPITAL.code), 'admin.hospitals.suspended'), 10000, 'Trạng thái không đổi sang tạm ngưng')
    await page.rowAction(HOSPITAL.name, 'admin.hospitals.resume')
    await page.driver.wait(async () => includesAny(await page.rowText(HOSPITAL.code), 'admin.status.active'), 10000, 'Trạng thái không trở lại hoạt động')
    const patches = calls('PATCH', /\/api\/v1\/hospitals\/[^/]+\/status$/)
    assert.deepEqual(patches.map((p) => [p.path, p.body]), [
      [`/api/v1/hospitals/${HOSPITAL.id}/status`, { isActive: false }],
      [`/api/v1/hospitals/${HOSPITAL.id}/status`, { isActive: true }],
    ])
  })

  test('E2E-61: admin đặt lại mật khẩu tài khoản quản lý -> thông báo mật khẩu mới bằng mã bệnh viện', async () => {
    await loginAs('admin')
    const page = new HospitalsAdminPage(driver, BASE_URL)
    await page.waitForRow(HOSPITAL.code)
    await page.rowAction(HOSPITAL.name, 'admin.hospitals.resetPassword.action')
    await page.confirmDialog()
    const dialog = await page.dialog()
    assert.match(dialog.text, new RegExp(HOSPITAL.code))
    assert.match(dialog.text, new RegExp(ACCOUNTS.hospital.email))
    assert.equal(calls('POST', /\/reset-password$/)[0].path, `/api/v1/hospitals/${HOSPITAL.id}/reset-password`)
  })

  test('E2E-62: admin xoá bệnh viện: nút xoá khoá cho tới khi gõ đúng mã; sau khi xoá dòng biến mất', async () => {
    const id = randomUUID()
    mock.backend.hospitals.push({ id, code: 'BV-XOA-E2E', name: 'Benh vien Se Xoa', address: null, phone: null, email: null, isActive: true, createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' })
    mock.backend.users.push({ id: randomUUID(), email: 'bv-xoa-e2e@spineinsight.vn', fullName: 'Benh vien Se Xoa', role: 'hospital', hospitalId: id, departmentId: null, specialty: null, employeeCode: null, phone: null, isActive: true, createdAt: '2026-02-01T00:00:00.000Z' })
    await loginAs('admin')
    const page = new HospitalsAdminPage(driver, BASE_URL)
    await page.waitForRow('BV-XOA-E2E')
    const { disabledBefore } = await page.deleteHospital('Benh vien Se Xoa', 'BV-XOA-E2E')
    assert.equal(disabledBefore, true, 'Nút xoá phải bị khoá khi chưa gõ mã')
    const dialog = await page.dialog()
    assert.ok(includesAny(dialog.text, 'admin.hospitals.delete.doneMessage', { accounts: () => '1', studies: () => '0' }), dialog.text)
    await page.confirmDialog()
    assert.deepEqual(calls('DELETE', /\/api\/v1\/hospitals\//).map((c) => c.path), [`/api/v1/hospitals/${id}`])
    await page.driver.wait(async () => (await page.driver.findElements(By.xpath('//td[normalize-space(.)="BV-XOA-E2E"]'))).length === 0, 10000, 'Dòng bệnh viện đã xoá vẫn còn')
  })

  test('E2E-63: admin thêm bệnh viện trùng mã -> backend từ chối, form báo "mã đã tồn tại"', async () => {
    await loginAs('admin')
    const page = new HospitalsAdminPage(driver, BASE_URL)
    await page.openCreateForm()
    await page.type('h-name', 'Benh vien Trung Ma')
    await page.type('h-code', HOSPITAL.code)
    await page.submitModal()
    await page.driver.wait(async () => (await page.modalAlerts()).some((a) => oneOf('admin.errors.codeExists').includes(a)), 10000, 'Không báo mã đã tồn tại')
    assert.equal(calls('POST', /^\/api\/v1\/hospitals$/).length, 1)
  })

  test('E2E-64: quản lý bệnh viện thêm khoa: tên rỗng bị chặn; tên hợp lệ gửi đúng bệnh viện của mình', async () => {
    await loginAs('hospital')
    const page = new DepartmentsPage(driver, BASE_URL)
    await page.openPath(DepartmentsPage.PATH)
    await page.openCreateForm()
    await page.submitModal()
    assert.ok((await page.modalAlerts()).some((a) => oneOf('admin.errors.requiredField').includes(a)), 'Tên rỗng phải báo lỗi')
    assert.equal(calls('POST', /^\/api\/v1\/departments$/).length, 0)
    await page.type('dept-name', '  Khoa   Chan doan hinh anh  ')
    await page.submitModal()
    await page.waitModalClosed()
    await page.waitForRow('Khoa Chan doan hinh anh')
    const posts = calls('POST', /^\/api\/v1\/departments$/)
    assert.equal(posts.length, 1)
    assert.equal(posts[0].body.hospitalId, HOSPITAL.id)
    assert.equal(posts[0].role, 'hospital')
    await page.screenshot('admin_64_them_khoa')
  })

  test('E2E-65: quản lý bệnh viện tạo tài khoản bác sĩ: mật khẩu 7 ký tự bị chặn, 8 ký tự hợp lệ (BVA); khoa đúng bệnh viện', async () => {
    const departmentId = randomUUID()
    mock.backend.departments.push({ id: departmentId, hospitalId: HOSPITAL.id, name: 'Khoa Than kinh', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' })
    await loginAs('hospital')
    const page = new AccountsManagementPage(driver, BASE_URL)
    await page.openCreateForm('hospital.doctors.add')
    const code = HOSPITAL.code
    assert.equal(await page.value('a-password'), code.charAt(0) + code.slice(1).toLowerCase() + '@123', 'Mật khẩu mặc định theo mã bệnh viện')
    await page.type('a-name', 'BS Kiem Thu E2E')
    await page.type('a-email', 'bs.kiemthu@test.local')
    await page.driver.wait(async () => (await page.driver.findElements(By.css('#a-department option'))).length > 1, 10000, 'Danh sách khoa chưa tải')
    await (await page.driver.findElement(By.css(`#a-department option[value="${departmentId}"]`))).click()
    await page.type('a-password', '1234567')
    await page.submitModal()
    await page.driver.wait(async () => (await page.modalAlerts()).some((a) => oneOf('admin.errors.weakPassword').includes(a)), 5000, 'Mật khẩu 7 ký tự phải báo lỗi')
    assert.equal(calls('POST', /^\/api\/v1\/auth\/users$/).length, 0)
    await page.type('a-password', '12345678')
    await page.submitModal()
    const dialog = await page.dialog()
    assert.match(dialog.text, /bs\.kiemthu@test\.local/)
    const posts = calls('POST', /^\/api\/v1\/auth\/users$/)
    assert.equal(posts.length, 1)
    assert.deepEqual(
      { role: posts[0].body.role, hospitalId: posts[0].body.hospitalId, email: posts[0].body.email, password: posts[0].body.password, departmentId: posts[0].body.departmentId },
      { role: 'doctor', hospitalId: HOSPITAL.id, email: 'bs.kiemthu@test.local', password: '12345678', departmentId },
    )
    await page.confirmDialog()
    await page.waitForRow('BS Kiem Thu E2E')
    await page.screenshot('admin_65_tao_bac_si')
  })

  test('E2E-66: quản lý bệnh viện tạm ngưng rồi mở lại tài khoản bác sĩ', async () => {
    await loginAs('hospital')
    const page = new AccountsManagementPage(driver, BASE_URL)
    await page.waitForRow(ACCOUNTS.doctor.fullName)
    await page.rowAction(ACCOUNTS.doctor.email, 'admin.accounts.suspend')
    await page.confirmDialog()
    await page.driver.wait(async () => includesAny(await page.rowText(ACCOUNTS.doctor.fullName), 'admin.accounts.suspended'), 10000, 'Không chuyển sang tạm ngưng')
    await page.rowAction(ACCOUNTS.doctor.email, 'admin.accounts.resume')
    const pending = await page.driver.findElements(page.alertDialog)
    if (pending.length) await page.confirmDialog()
    await page.driver.wait(async () => includesAny(await page.rowText(ACCOUNTS.doctor.fullName), 'admin.status.active'), 10000, 'Không trở lại hoạt động')
    assert.deepEqual(calls('PATCH', /\/status$/).map((c) => [c.path, c.body]), [
      [`/api/v1/auth/users/${ACCOUNTS.doctor.id}/status`, { isActive: false }],
      [`/api/v1/auth/users/${ACCOUNTS.doctor.id}/status`, { isActive: true }],
    ])
  })

  test('E2E-67: quản lý bệnh viện đặt lại mật khẩu bác sĩ -> mật khẩu mặc định "Mã@123"', async () => {
    await loginAs('hospital')
    const page = new AccountsManagementPage(driver, BASE_URL)
    await page.waitForRow(ACCOUNTS.doctor.fullName)
    await page.rowAction(ACCOUNTS.doctor.email, 'admin.accounts.resetPassword')
    await page.confirmDialog()
    const dialog = await page.dialog()
    const expected = HOSPITAL.code.charAt(0) + HOSPITAL.code.slice(1).toLowerCase() + '@123'
    assert.ok(dialog.text.includes(expected), `Mật khẩu mới phải là ${expected}`)
    assert.equal(calls('POST', /\/reset-password$/)[0].path, `/api/v1/auth/users/${ACCOUNTS.doctor.id}/reset-password`)
  })

  test('E2E-68: quản lý bệnh viện chỉ thấy bác sĩ của bệnh viện mình; bác sĩ không vào được trang quản lý', async () => {
    const otherHospital = randomUUID()
    mock.backend.hospitals.push({ id: otherHospital, code: 'BV-KHAC-E2E', name: 'Benh vien Khac', address: null, phone: null, email: null, isActive: true, createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' })
    mock.backend.users.push({ id: randomUUID(), email: 'bs.khac@test.local', fullName: 'BS Benh vien Khac', role: 'doctor', hospitalId: otherHospital, departmentId: null, specialty: null, employeeCode: null, phone: null, isActive: true, createdAt: '2026-02-01T00:00:00.000Z' })
    await loginAs('hospital')
    const page = new AccountsManagementPage(driver, BASE_URL)
    await page.waitForRow(ACCOUNTS.doctor.fullName)
    assert.equal((await driver.findElements(By.xpath('//td[contains(normalize-space(.), "BS Benh vien Khac")]'))).length, 0, 'Lộ bác sĩ bệnh viện khác')
    const lists = calls('GET', /^\/api\/v1\/auth\/users$/)
    assert.ok(lists.length > 0 && lists.every((c) => c.query.hospitalId === HOSPITAL.id && c.query.role === 'doctor'), `Tham số danh sách: ${JSON.stringify(lists.map((c) => c.query))}`)
    await driver.quit()

    driver = await createDriver()
    mark = mock.backend.calls.length
    await loginAs('doctor')
    const doctorPage = new AccountsManagementPage(driver, BASE_URL)
    for (const path of ['/hospital/doctors', '/hospital/departments', '/admin/hospitals', '/admin/accounts']) {
      await doctorPage.goto(path)
      await doctorPage.waitForSignedInShell()
      await doctorPage.waitForPath('/viewer')
    }
    const managementCalls = mock.backend.calls.slice(mark).filter((c) => c.role === 'doctor')
    assert.deepEqual(managementCalls, [], 'Bác sĩ không được gọi API quản trị')
  })
})
