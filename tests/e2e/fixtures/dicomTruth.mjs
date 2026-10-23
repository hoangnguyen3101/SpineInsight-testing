// Mục đích: Đọc trực tiếp tệp DICOM (đã ẩn danh, đường dẫn từ DICOM_TEST_DIR) ở phía Node để có "đáp án"
// độc lập với ứng dụng: kích thước điểm ảnh, cửa sổ mặc định và giá trị xám chuẩn theo DICOM PS3.3 C.11.2.1.2.1.
// Không in hay lưu bất kỳ trường định danh nào.
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { frontendDir } = require('../../../sut.config.cjs')
const dicomParser = createRequire(path.join(frontendDir, 'package.json'))('dicom-parser')

const naturalSort = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

export function seriesFolders(dataDir) {
  return readdirSync(dataDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(naturalSort)
}

export function seriesFiles(dataDir, folder) {
  return readdirSync(path.join(dataDir, folder)).filter((f) => f.toLowerCase().endsWith('.dcm')).sort(naturalSort)
}

/** Thông tin kỹ thuật và mảng giá trị đã rescale của một lát (không gồm trường định danh). */
export function readSlice(dataDir, folder, index = 0) {
  const file = path.join(dataDir, folder, seriesFiles(dataDir, folder)[index])
  const bytes = new Uint8Array(readFileSync(file))
  const ds = dicomParser.parseDicom(bytes)
  const rows = ds.uint16('x00280010')
  const columns = ds.uint16('x00280011')
  const signed = ds.uint16('x00280103') === 1
  const slope = Number(ds.string('x00281053') || 1) || 1
  const intercept = Number(ds.string('x00281052') || 0) || 0
  const pixel = ds.elements.x7fe00010
  const view = new DataView(bytes.buffer, bytes.byteOffset + pixel.dataOffset, pixel.length)
  const values = new Float64Array(rows * columns)
  for (let i = 0; i < values.length; i++) {
    const raw = signed ? view.getInt16(i * 2, true) : view.getUint16(i * 2, true)
    values[i] = raw * slope + intercept
  }
  const firstNumber = (tag) => Number(String(ds.string(tag) || '').split('\\')[0])
  return {
    rows,
    columns,
    pixelSpacing: String(ds.string('x00280030')).split('\\').map(Number),
    windowCenter: firstNumber('x00281050'),
    windowWidth: firstNumber('x00281051'),
    seriesDescription: ds.string('x0008103e'),
    values,
  }
}

/** Hàm VOI LUT tuyến tính của DICOM (PS3.3 C.11.2.1.2.1), đầu ra 8 bit. */
export function voiLinear(x, center, width) {
  const c = center - 0.5
  const w = width - 1
  if (x <= c - w / 2) return 0
  if (x > c + w / 2) return 255
  return ((x - c) / w + 0.5) * 255
}
