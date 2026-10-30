// features/viewer/data/localDicomSession.ts và utils/dicomUpload.ts - nạp thư mục DICOM ở trình duyệt.
// Phân vùng tương đương (EP) theo đuôi tệp và dạng đường dẫn, giá trị biên (BVA) theo số tệp/độ sâu thư mục, property-based.
// Theo DICOM PS3.10, tệp DICOM nhận biết bằng tiền tố 128 byte + "DICM", không bắt buộc đuôi .dcm (tệp trên đĩa DICOMDIR
// thường không có đuôi); một series là tập ảnh cùng SeriesInstanceUID (0020,000E), không phụ thuộc tên thư mục.
import { beforeEach, describe, expect, test } from 'vitest'
import fc from 'fast-check'
import {
  clearLocalDicomSession,
  getAllLocalDicomFiles,
  getLocalDicomFile,
  getLocalDicomSeries,
  hasLocalDicomSession,
  setLocalDicomSession,
} from '@/features/viewer/data/localDicomSession'
import { getDicomFilesFromList, getPatientFolderFromFiles } from '@/features/viewer/utils/dicomUpload'

// Tệp DICOM tối thiểu: preamble 128 byte, "DICM", phần tử SeriesInstanceUID (0020,000E) VR UI, Explicit VR Little Endian.
function dicomBytes(seriesUid = '1.2.3.4'): Uint8Array {
  const uid = seriesUid.length % 2 ? `${seriesUid}\0` : seriesUid
  const element = new Uint8Array(8 + uid.length)
  element.set([0x20, 0x00, 0x0e, 0x00, 0x55, 0x49, uid.length & 0xff, uid.length >> 8])
  element.set(new TextEncoder().encode(uid), 8)
  const out = new Uint8Array(132 + element.length)
  out.set(new TextEncoder().encode('DICM'), 128)
  out.set(element, 132)
  return out
}

function dicomFile(relativePath: string, seriesUid?: string): File {
  const name = relativePath.split(/[\\/]/).pop()!
  const file = new File([dicomBytes(seriesUid)], name, { type: 'application/dicom' })
  if (relativePath !== name) Object.defineProperty(file, 'webkitRelativePath', { value: relativePath })
  return file
}

const asFileList = (files: File[]) => Object.assign([...files], { item: (i: number) => files[i] }) as unknown as FileList

beforeEach(() => clearLocalDicomSession())

describe('setLocalDicomSession', () => {
  test('FE-UT-91: danh sách rỗng (biên) -> 0 series, 0 tệp; các hàm đọc trả rỗng/null', () => {
    expect(getLocalDicomFile('S1', 'IM1.dcm')).toBeNull()
    expect(getAllLocalDicomFiles()).toEqual([])
    expect(setLocalDicomSession([])).toEqual({ seriesCount: 0, totalFiles: 0 })
    expect(hasLocalDicomSession()).toBe(false)
    expect(getLocalDicomSeries()).toEqual([])
    expect(getAllLocalDicomFiles()).toEqual([])
    expect(getLocalDicomFile('S1', 'IM1.dcm')).toBeNull()
  })

  test('FE-UT-92: gom theo thư mục series, sắp xếp tự nhiên cả series lẫn tệp, nhận đuôi .DCM viết hoa', () => {
    const files = [
      dicomFile('CASE/S10/IM1.dcm'), dicomFile('CASE/S2/IM10.dcm'), dicomFile('CASE/S2/IM2.dcm'),
      dicomFile('CASE/S2/IM1.DCM'),
    ]
    expect(setLocalDicomSession(files)).toEqual({ seriesCount: 2, totalFiles: 4 })
    expect(hasLocalDicomSession()).toBe(true)
    expect(getLocalDicomSeries()).toEqual([
      { id: 'S2', name: 'S2', files: ['IM1.DCM', 'IM2.dcm', 'IM10.dcm'], totalFiles: 3 },
      { id: 'S10', name: 'S10', files: ['IM1.dcm'], totalFiles: 1 },
    ])
  })

  test.each([
    ['2 cấp S1/a.dcm', 'S1/a.dcm', 'S1', 'a.dcm'],
    ['nhiều cấp, lấy thư mục cuối', 'A/B/C/S4/x.dcm', 'S4', 'x.dcm'],
    ['dấu \\ của Windows', 'C\\S3\\x.dcm', 'S3', 'x.dcm'],
    ['có "//" thừa', 'CASE//S1//x.dcm', 'S1', 'x.dcm'],
    ['không có đường dẫn tương đối', 'loose.dcm', 'default', 'loose.dcm'],
  ])('FE-UT-93: đường dẫn %s -> series %s, tệp %s', (_name, rel, seriesId, fileName) => {
    const file = dicomFile(rel)
    setLocalDicomSession([file])
    expect(getLocalDicomSeries().map((s) => s.id)).toEqual([seriesId])
    expect(getLocalDicomFile(seriesId, fileName)).toBe(file)
  })

  test('FE-UT-94: bỏ qua tệp không phải ảnh DICOM (ghi chú, DICOMDIR, bản sao .bak)', () => {
    const files = [
      dicomFile('CASE/S1/IM1.dcm'),
      new File(['ghi chu'], 'notes.txt'),
      new File(['dir'], 'DICOMDIR'),
      new File(['x'], 'IM1.dcm.bak'),
    ]
    expect(setLocalDicomSession(files)).toEqual({ seriesCount: 1, totalFiles: 1 })
  })

  // BUG-27: tệp DICOM hợp lệ (có "DICM") nhưng không có đuôi .dcm - kiểu tệp IM000001 của đĩa CD/DICOMDIR - bị bỏ qua,
  // nên mở thư mục xuất từ PACS/đĩa CD báo "không có tệp DICOM".
  test.fails('FE-UT-95 (BUG-27): tệp DICOM không có đuôi (IM000001) vẫn được nạp', () => {
    const files = [dicomFile('CD/SE000001/IM000001'), dicomFile('CD/SE000001/IM000002')]
    expect(getDicomFilesFromList(asFileList(files))).toHaveLength(2)
    expect(setLocalDicomSession(files)).toEqual({ seriesCount: 1, totalFiles: 2 })
  })

  test('FE-UT-96: getLocalDicomFile và getAllLocalDicomFiles trả đúng tệp và đường dẫn tương đối gốc', () => {
    const a = dicomFile('CASE/S1/IM1.dcm')
    const b = dicomFile('CASE/S1/IM2.dcm')
    const loose = dicomFile('loose.dcm')
    setLocalDicomSession([b, loose, a])
    expect(getLocalDicomFile('S1', 'IM2.dcm')).toBe(b)
    expect(getLocalDicomFile('S1', 'IM9.dcm')).toBeNull()
    expect(getLocalDicomFile('S9', 'IM1.dcm')).toBeNull()
    expect(getAllLocalDicomFiles()).toEqual([
      { file: loose, relativePath: 'loose.dcm' },
      { file: a, relativePath: 'CASE/S1/IM1.dcm' },
      { file: b, relativePath: 'CASE/S1/IM2.dcm' },
    ])
  })

  test('FE-UT-97: clear xoá phiên; nạp thư mục mới thay hẳn phiên cũ', () => {
    setLocalDicomSession([dicomFile('A/S1/IM1.dcm')])
    clearLocalDicomSession()
    expect(hasLocalDicomSession()).toBe(false)
    expect(getLocalDicomSeries()).toEqual([])
    setLocalDicomSession([dicomFile('A/S1/IM1.dcm')])
    setLocalDicomSession([dicomFile('B/S7/IM5.dcm')])
    expect(getLocalDicomSeries().map((s) => s.id)).toEqual(['S7'])
    expect(getLocalDicomFile('S1', 'IM1.dcm')).toBeNull()
  })

  // BUG-29: series được xác định theo tên thư mục chứa tệp thay vì SeriesInstanceUID (gap G10 trong README của SUT).
  test.fails('FE-UT-98 (BUG-29): hai ca chụp có thư mục con cùng tên (StudyA/T2, StudyB/T2) không bị trộn, không mất tệp', () => {
    const a = dicomFile('StudyA/T2/IM1.dcm', '1.2.3.1')
    const b = dicomFile('StudyB/T2/IM1.dcm', '1.2.3.2')
    setLocalDicomSession([a, b])
    expect(getLocalDicomSeries()).toHaveLength(2)
    expect(new Set(getAllLocalDicomFiles().map((entry) => entry.file))).toEqual(new Set([a, b]))
  })
  test.fails('FE-UT-99 (BUG-29): hai series khác SeriesInstanceUID trong cùng một thư mục -> 2 series', () => {
    setLocalDicomSession([dicomFile('FLAT/IM1.dcm', '1.2.3.1'), dicomFile('FLAT/IM2.dcm', '1.2.3.2')])
    expect(getLocalDicomSeries()).toHaveLength(2)
  })
})

describe('dicomUpload', () => {
  test('FE-UT-100: lọc tệp .dcm không phân biệt hoa/thường; lấy thư mục bệnh nhân là cấp đầu của đường dẫn', () => {
    const files = [dicomFile('CASE01/S1/IM1.dcm'), dicomFile('CASE01/S1/IM2.DCM'), new File(['x'], 'readme.txt')]
    expect(getDicomFilesFromList(asFileList(files)).map((f) => f.name)).toEqual(['IM1.dcm', 'IM2.DCM'])
    expect(getDicomFilesFromList(asFileList([]))).toEqual([])
    expect(getPatientFolderFromFiles(files)).toBe('CASE01')
    expect(getPatientFolderFromFiles([dicomFile('C\\S1\\IM1.dcm')])).toBe('C')
    expect(getPatientFolderFromFiles([dicomFile('IM1.dcm')])).toBeUndefined()
    expect(getPatientFolderFromFiles([])).toBeUndefined()
    expect(getPatientFolderFromFiles([dicomFile('CASE01/x.dcm')])).toBe('CASE01')
    expect(getPatientFolderFromFiles([dicomFile('/CASE01/S1/x.dcm')])).toBe('CASE01')
    const single = new File(['DICM'], 'IM1.dcm')
    Object.defineProperty(single, 'webkitRelativePath', { value: 'IM1.dcm' })
    expect(getPatientFolderFromFiles([single])).toBeUndefined()
  })
})

describe('Tính chất (fast-check)', () => {
  test('FE-PBT-09: mọi tệp .dcm có đường dẫn duy nhất đều được nạp, lấy lại đúng tệp, series sắp xếp tự nhiên', () => {
    const folders = ['S1', 'S2', 'S10', 'Ax T2', 'sag_t1']
    fc.assert(fc.property(
      fc.uniqueArray(fc.tuple(fc.constantFrom(...folders), fc.integer({ min: 1, max: 300 })), {
        minLength: 1, maxLength: 40, selector: ([folder, n]) => `${folder}/${n}`,
      }),
      (pairs) => {
        const files = pairs.map(([folder, n]) => dicomFile(`CASE/${folder}/IM${n}.dcm`))
        const summary = setLocalDicomSession(files)
        expect(summary.totalFiles).toBe(files.length)
        const series = getLocalDicomSeries()
        expect(series.reduce((sum, s) => sum + s.totalFiles, 0)).toBe(files.length)
        pairs.forEach(([folder, n], i) => expect(getLocalDicomFile(folder, `IM${n}.dcm`)).toBe(files[i]))
        const ids = series.map((s) => s.id)
        expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })))
      },
    ), { numRuns: 200 })
  })
})
