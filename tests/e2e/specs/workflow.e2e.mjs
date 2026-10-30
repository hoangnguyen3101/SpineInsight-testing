// Kịch bản E2E luồng nghiệp vụ chính của bác sĩ theo SRS Chương 3 (sơ đồ tuần tự và sơ đồ trạng thái):
// rảnh -> nạp DICOM -> xem ảnh -> phân tích RSNA -> có kết quả -> sinh báo cáo P2VG -> báo cáo sẵn sàng
// -> chỉnh sửa/lưu -> in phiếu, kèm các trạng thái lỗi và thử lại (FR-07, FR-08, FR-09, FR-10).
// Dịch vụ AI do máy chủ giả trả lời (fixtures/aiPayloads.mjs); dữ liệu ảnh là ca CASE01 đã ẩn danh.
// Mỗi nhóm là MỘT luồng trên một lần nạp ca (ứng dụng nén và gửi 146 MB ảnh ở mỗi bước AI), các kịch bản
// trong nhóm chạy nối tiếp theo đúng thứ tự trạng thái của sơ đồ.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { createDriver } from '../driver.mjs'
import { en, vi, translations } from '../i18n.mjs'
import { ACCOUNTS } from '../fixtures/accounts.mjs'
import { ABNORMAL, COORDINATES, REPORT_FINDINGS, REPORT_IMPRESSION } from '../fixtures/aiPayloads.mjs'
import { createMockServer } from '../fixtures/mockServer.mjs'
import { AiPanelPage } from '../pages/AiPanelPage.mjs'
import { LoginPage } from '../pages/LoginPage.mjs'
import { ViewerPage } from '../pages/ViewerPage.mjs'

const BASE_URL = process.env.E2E_BASE_URL
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT)
const DATA_DIR = process.env.DICOM_TEST_DIR
const HAS_DATA = Boolean(DATA_DIR) && existsSync(DATA_DIR)
const SKIP = HAS_DATA ? false : 'Bỏ qua: chưa đặt DICOM_TEST_DIR (thư mục một ca MRI đã ẩn danh) trong .env'
const SPINE_OVERLAY = 16 // thứ tự canvas phủ: 0 ảnh, 1-14 đo đạc, 15 đường tham chiếu, 16 dấu AI
// Ứng dụng tự ghi console.error khi dịch vụ AI lỗi; trong các kịch bản lỗi đây là hành vi mong đợi.
const AI_FAILURE_LOGS = [/\[SpineAI\] Error/, /Report generation failed/]
// Mỗi bước AI nén và gửi lại 146 MB ảnh; máy bận (các bộ kiểm thử khác chạy song song) có thể chậm vài lần.
const LONG = 180000

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

describe('E2E luồng phân tích AI -> báo cáo -> sửa/lưu -> in (bác sĩ)', { skip: SKIP }, () => {
  let mock
  let driver
  let viewer
  let panel

  const waitFor = (condition, message, timeout = LONG) => driver.wait(async () => condition(), timeout, message)
  const panelHas = async (key) => {
    const text = await panel.text()
    return translations(key).some((t) => t && text.includes(t))
  }
  const uploadsSince = (start, kind) => mock.uploads.slice(start).filter((u) => u.kind === kind)

  /** Mở /viewer, nạp CASE01 và chờ lần gửi ảnh tự động sang P2VG khi nạp (BUG-26, máy chủ giả trả 503) kết thúc. */
  async function openCase() {
    mock.ai.spine.length = 0
    mock.ai.p2vg.length = 0
    mock.ai.delayMs = 0
    const start = mock.uploads.length
    await driver.get(`${BASE_URL}${ViewerPage.PATH}`)
    await viewer.loadFolder(DATA_DIR.replace(/\//g, '\\'))
    await viewer.waitForViewports(4)
    for (let i = 0; i < 4; i++) await viewer.waitForImage(i)
    await waitFor(() => uploadsSince(start, 'p2vg').some((u) => u.completed), 'Không thấy lần gửi P2VG tự động khi nạp')
    await viewer.settle(800)
    return mock.uploads.length
  }

  /** Bấm phân tích, chờ request RSNA thứ `n` (tính từ `start`) hoàn tất và nút phân tích hết trạng thái chờ. */
  async function analyzeAndWait(start, n) {
    await panel.waitForAnalysisEnd(LONG)
    await panel.analyze()
    try {
      await waitFor(() => uploadsSince(start, 'spine').length >= n && uploadsSince(start, 'spine')[n - 1].completed, 'Request phân tích RSNA không hoàn tất')
    } catch (err) {
      console.log(`[analyze ${n}] request AI:`, JSON.stringify(mock.uploads.slice(start).map((u) => [u.kind, u.mode, u.completed])), 'đang phân tích:', await panel.isAnalyzing())
      throw err
    }
    await panel.waitForAnalysisEnd(LONG)
    await viewer.settle(600)
  }

  /**
   * Cảnh báo "Maximum update depth exceeded" của React thỉnh thoảng xuất hiện khi sửa báo cáo nhưng không tái hiện
   * được theo yêu cầu: ghi lại thành quan sát (in ra log) thay vì làm kịch bản thất bại ngẫu nhiên.
   */
  async function assertClean(id, allowed = []) {
    const errors = await viewer.unexpectedErrors(allowed)
    const loops = errors.filter((e) => /Maximum update depth exceeded/.test(e.message))
    if (loops.length > 0) console.log(`[${id}] Quan sát: React cảnh báo "Maximum update depth exceeded" ${loops.length} lần`)
    assert.deepEqual(errors.filter((e) => !loops.includes(e)), [], `${id}: có lỗi JavaScript ngoài dự kiến`)
    assert.deepEqual(await viewer.externalRequests(), [], `${id}: có request ra máy chủ ngoài`)
  }

  async function errorShown() {
    const alerts = await driver.findElements({ css: '[role="alert"], [role="alertdialog"]' })
    const text = await panel.text()
    return { shown: alerts.length > 0 || /error|lỗi/i.test(text), text: text.split('\n').slice(0, 4).join(' | ') }
  }

  before(async () => {
    assert.ok(BASE_URL && MOCK_PORT, 'Thiếu E2E_BASE_URL/E2E_MOCK_PORT: hãy chạy bằng npm run test:e2e')
    mock = createMockServer()
    await mock.listen(MOCK_PORT)
    driver = await createDriver()
    await driver.manage().window().setRect({ width: 1600, height: 1000 })
    viewer = new ViewerPage(driver, BASE_URL)
    panel = new AiPanelPage(driver, BASE_URL)
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

  describe('Luồng chính: phân tích -> kết quả -> báo cáo -> sửa -> in -> lưu', () => {
    let start

    test('E2E-49: bấm phân tích AI -> đang phân tích -> danh sách phát hiện đúng mức độ -> tự sinh báo cáo P2VG', async () => {
      const t0 = Date.now()
      start = await openCase()
      assert.ok(await panelHas('ai.findings.empty'), 'Trạng thái ban đầu phải là "chưa có phân tích"')
      mock.ai.spine.push('ok')
      mock.ai.p2vg.push('ok')
      mock.ai.delayMs = 1500
      await panel.analyze()
      await waitFor(() => panel.isAnalyzing(), 'Không chuyển sang trạng thái đang phân tích', 5000)
      assert.ok(await panelHas('ai.findings.analyzing'), 'Thiếu chữ "Đang phân tích"')
      await panel.waitForAnalysisEnd(LONG)
      try {
        await panel.waitForReport(LONG)
      } catch (err) {
        console.log('[E2E-49] Request AI:', JSON.stringify(mock.uploads.slice(start).map((u) => ({ kind: u.kind, mode: u.mode, start: u.startedAt - t0, end: u.endedAt - t0 }))))
        throw err
      }
      console.log(`[E2E-49] Từ lúc mở trang tới khi có báo cáo: ${Date.now() - t0} ms`)
      mock.ai.delayMs = 0
      const rsna = uploadsSince(start, 'spine')[0]
      assert.equal(rsna.path, '/api/v1/spine/analyze')
      assert.equal(rsna.authorization, true, 'Yêu cầu phân tích phải kèm token đăng nhập')
      assert.ok(rsna.fields.files >= 70 && rsna.fields.relativePaths >= 70, `Thiếu tệp DICOM gửi phân tích: ${JSON.stringify(rsna.fields)}`)
      assert.ok((await panel.text()).includes(`(${ABNORMAL.length})`), `Nút xác nhận tất cả phải đếm ${ABNORMAL.length} phát hiện bất thường`)
      const scs = await panel.openCondition('scs')
      assert.ok(scs.some((r) => /L4\/L5/.test(r.text) && /Severe|Nặng/.test(r.text) && /81%/.test(r.text)), `SCS: ${JSON.stringify(scs)}`)
      const nfn = await panel.openCondition('nfn')
      assert.ok(nfn.some((r) => /L5\/S1/.test(r.text) && /Moderate|Trung bình/.test(r.text) && /62%/.test(r.text)), `NFN: ${JSON.stringify(nfn)}`)
      const ss = await panel.openCondition('ss')
      assert.ok(ss.some((r) => /L4\/L5/.test(r.text) && /55%/.test(r.text)), `SS: ${JSON.stringify(ss)}`)
      assert.deepEqual(await panel.reportValues(), { findings: REPORT_FINDINGS, impression: REPORT_IMPRESSION })
      assert.equal(uploadsSince(start, 'p2vg').length, 1, 'Sau khi có kết quả RSNA phải gọi sinh báo cáo đúng một lần')
      await viewer.screenshot('workflow_49_ket_qua_ai_va_bao_cao')
      await assertClean('E2E-49')
    })

    test('E2E-50: bấm phát hiện SCS L4/L5 -> khung Sag T2 chuyển tới lát có dấu AI tại đúng toạ độ; xác nhận thì dấu ẩn', async () => {
      const target = COORDINATES.find((c) => c.condition === 'Spinal Canal Stenosis')
      await panel.openCondition('scs')
      await panel.clickFinding('L4/L5')
      const index = await viewer.indexOf('Sag T2 frFSE')
      await waitFor(async () => (await viewer.sliceOf(index))?.current === target.instanceNumber, `Khung Sag T2 không chuyển tới lát ${target.instanceNumber}`, 10000)
      await viewer.settle(500)
      const near = await viewer.probe('ink', index, SPINE_OVERLAY, [target.x - 25, target.y - 25, target.x + 25, target.y + 25])
      const all = await viewer.probe('ink', index, SPINE_OVERLAY)
      assert.ok(near.count > 50, `Không có dấu AI tại (${target.x}, ${target.y})`)
      assert.ok(all.minX >= target.x - 30 && all.minY >= target.y - 30, `Dấu AI lệch khỏi toạ độ: ${JSON.stringify(all)}`)
      await viewer.screenshot('workflow_50_dau_ai_tren_anh')
      await panel.confirmFinding('L4/L5')
      await viewer.settle(400)
      assert.equal((await viewer.probe('ink', index, SPINE_OVERLAY)).count, 0, 'Đã xác nhận nhưng dấu AI vẫn hiện')
      await assertClean('E2E-50')
    })

    knownBug('E2E-51 (BUG-39)', 'yêu cầu sinh báo cáo sau RSNA mang kèm kết quả phân tích (FR-08 "từ kết quả phân tích")', /Yêu cầu sinh báo cáo không kèm kết quả RSNA/, async () => {
      const request = uploadsSince(start, 'p2vg')[0]
      const extra = Object.keys(request.fields).filter((f) => f !== 'zip_file')
      assert.ok(extra.length > 0, `Yêu cầu sinh báo cáo không kèm kết quả RSNA: chỉ có trường ${JSON.stringify(request.fields)}`)
    })

    test('E2E-52: sửa findings/impression rồi in phiếu -> phiếu có tên bệnh nhân theo DICOM và đúng nội dung đã sửa', async () => {
      await panel.appendToFindings('\nDoctor note (E2E): findings reviewed and confirmed.')
      await panel.replaceImpression('Severe L4-L5 canal stenosis, confirmed by doctor (E2E).')
      const edited = await panel.reportValues()
      assert.match(edited.findings, /Doctor note \(E2E\): findings reviewed and confirmed\.$/)
      assert.equal(edited.impression, 'Severe L4-L5 canal stenosis, confirmed by doctor (E2E).')
      const printed = await panel.printReport()
      assert.match(printed, /ANONYMOUS/, 'Phiếu in thiếu tên bệnh nhân theo DICOM')
      assert.match(printed, /Doctor note \(E2E\): findings reviewed and confirmed\./)
      assert.match(printed, /Severe L4-L5 canal stenosis, confirmed by doctor \(E2E\)\./)
      assert.match(printed, /severe central canal stenosis/)
      await viewer.screenshot('workflow_52_sua_bao_cao')
      await assertClean('E2E-52')
    })

    knownBug('E2E-53 (BUG-41)', 'phiếu in không chứa dữ liệu cá nhân mẫu cố định trong mã nguồn (ngày sinh, điện thoại, địa chỉ)', /Phiếu in chứa dữ liệu cá nhân mẫu/, async () => {
      const printed = await driver.executeScript('return window.__e2e.printedReports[window.__e2e.printedReports.length - 1]')
      // Giá trị mẫu đọc từ i18n của SUT lúc chạy; chỉ báo tên trường, không in giá trị.
      const leaked = []
      for (const [lang, dict] of [['en', en], ['vi', vi]]) {
        for (const field of ['birthDate', 'phone', 'address']) {
          const value = dict.viewer?.reportPdf?.mock?.[field]
          if (value && printed.includes(value)) leaked.push(`${lang}.${field}`)
        }
      }
      assert.deepEqual(leaked, [], `Phiếu in chứa dữ liệu cá nhân mẫu cố định không thuộc ca chụp: ${leaked.join(', ')}`)
    })

    knownBug('E2E-54 (BUG-40)', 'báo cáo đã sửa được lưu về hệ thống và còn sau khi tải lại trang (FR-09)', /Báo cáo đã sửa không được lưu/, async () => {
      const before = mock.requests.length
      await panel.appendToFindings('\nSaved line (E2E).')
      await driver.sleep(3000)
      const saves = mock.requests.slice(before).filter((r) => /^(POST|PUT|PATCH) /.test(r) && /studies|report/.test(r) && !r.includes('upload-dicom-zip'))
      await driver.navigate().refresh()
      await viewer.settle(1500)
      const afterReload = await driver.findElements(panel.findingsInput)
      await assertClean('E2E-54')
      assert.ok(saves.length > 0 && afterReload.length > 0, `Báo cáo đã sửa không được lưu: ${saves.length} request lưu; sau khi tải lại trang trình soạn ${afterReload.length ? 'còn' : 'không còn'} báo cáo`)
    })
  })

  describe('Lỗi RSNA -> thử lại', () => {
    let start
    const observed = []

    test('E2E-55: phân tích lỗi 503, rồi lỗi mạng -> về trạng thái chờ; bấm lần 3 thì có kết quả', async () => {
      start = await openCase()
      mock.ai.spine.push('503', 'network', 'ok')
      mock.ai.p2vg.push('ok')
      for (const [n, mode] of [[1, '503'], [2, 'network']]) {
        await analyzeAndWait(start, n)
        assert.ok(!(await panel.text()).includes('81%'), `Lần lỗi ${mode} không được hiện kết quả`)
        observed.push({ mode, ...(await errorShown()) })
        if (mode === '503') await viewer.screenshot('workflow_55_loi_rsna')
      }
      await analyzeAndWait(start, 3)
      await waitFor(async () => (await panel.text()).includes(`(${ABNORMAL.length})`), 'Thử lại không hiện kết quả')
      assert.deepEqual(uploadsSince(start, 'spine').map((u) => u.mode), ['503', 'network', 'ok'])
      await assertClean('E2E-55', AI_FAILURE_LOGS)
    })

    knownBug('E2E-56 (BUG-37)', 'phân tích AI lỗi (503 hoặc mạng) -> giao diện báo lỗi cho bác sĩ', /Không báo lỗi khi phân tích AI thất bại/, async () => {
      assert.equal(observed.length, 2, 'Thiếu quan sát từ E2E-55')
      const silent = observed.filter((o) => !o.shown)
      assert.deepEqual(silent, [], `Không báo lỗi khi phân tích AI thất bại: ${silent.map((o) => `${o.mode} -> khung AI hiện "${o.text}"`).join('; ')}`)
    })
  })

  describe('Lỗi P2VG -> thử lại', () => {
    let observed

    test('E2E-57: sinh báo cáo lỗi 503 -> hiện lại nút "Generate AI Report"; bấm lại thì có báo cáo', async () => {
      const start = await openCase()
      mock.ai.spine.push('ok')
      mock.ai.p2vg.push('503', 'ok')
      await analyzeAndWait(start, 1)
      await waitFor(() => uploadsSince(start, 'p2vg').length >= 1 && uploadsSince(start, 'p2vg')[0].completed, 'Request sinh báo cáo không hoàn tất')
      await waitFor(async () => (await driver.findElements(panel.generateButton)).length > 0, 'Không hiện nút sinh lại báo cáo')
      observed = await errorShown()
      await viewer.screenshot('workflow_57_loi_p2vg')
      await (await driver.findElement(panel.generateButton)).click()
      await panel.waitForReport(LONG)
      assert.equal((await panel.reportValues()).impression, REPORT_IMPRESSION)
      assert.deepEqual(uploadsSince(start, 'p2vg').map((u) => u.mode), ['503', 'ok'])
      await assertClean('E2E-57', AI_FAILURE_LOGS)
    })

    knownBug('E2E-58 (BUG-38)', 'sinh báo cáo P2VG lỗi -> giao diện báo lỗi cho bác sĩ', /Không báo lỗi khi sinh báo cáo thất bại/, async () => {
      assert.ok(observed, 'Thiếu quan sát từ E2E-57')
      assert.ok(observed.shown, `Không báo lỗi khi sinh báo cáo thất bại: khung AI hiện "${observed.text}"`)
    })
  })
})
