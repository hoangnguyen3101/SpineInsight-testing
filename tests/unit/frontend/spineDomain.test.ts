// features/viewer/domain/spine.ts - logic miền của kết quả AI cột sống: chuẩn hoá tên series, mức, bên, điều kiện (EP),
// lọc tổn thương bất thường (bảng quyết định), ghép kết quả AI với series đang xem (EP + đối chiếu theo tên thư mục của ca CASE01).
// Kỳ vọng: mỗi toạ độ AI thuộc đúng một series (series_mapping là ánh xạ duy nhất pipeline -> series).
import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import type { SpineCoordinate, SpineResult, SpineSeverity } from '@/types'
import type { DicomSeries } from '@/features/viewer/types'
import {
  SPINE_CONDITION_API_KEYS,
  filterVisibleSpineCoordinates,
  findSeriesForPipelineTarget,
  findSpineCoordinateForFinding,
  getAbnormalSpineFindings,
  getAllAbnormalSpineFindings,
  getSpineCoordinateKey,
  getSpineFindingKey,
  getSpineSeverityKey,
  getSpineSideFromCondition,
  isAbnormalSpineSeverity,
  matchesPipelineSeries,
  normalizeSeriesName,
  normalizeSpineConditionKey,
  normalizeSpineLevel,
  normalizeSpineSide,
} from '@/features/viewer/domain/spine'

const severity = (overrides: Partial<SpineSeverity> = {}): SpineSeverity => ({
  condition: 'spinal_canal_stenosis', level: 'L4/L5', side: '', normalMild: 0.1, moderate: 0.2, severe: 0.7,
  predictedLabel: 'Severe', confidence: 0.7, ...overrides,
})
const coordinate = (overrides: Partial<SpineCoordinate> = {}): SpineCoordinate => ({
  studyId: 1, seriesId: 2, instanceNumber: 8, condition: 'Spinal Canal Stenosis', level: 'L4/L5', x: 100, y: 200, ...overrides,
})
const result = (items: SpineSeverity[]): SpineResult => ({ studyId: 1, coordinates: [], severity: items })

// Tên thư mục series giống ca MRI thật đã ẩn danh (CASE01): mỗi pipeline của AI phải khớp đúng một series.
const CASE_SERIES = ['S1_Ax_T2_FSE', 'S2_Cor_T2_FSE_STIR', 'S3_Sag_T1_FSE', 'S4_Sag_T2_frFSE']
const CASE_MAPPING = { 1: 'S3_Sag_T1_FSE', 2: 'S4_Sag_T2_frFSE', 3: 'S1_Ax_T2_FSE' } as Record<string, string>

describe('Chuẩn hoá tên series, mức, bên, điều kiện', () => {
  test.each([
    ['S4_Sag_T2_frFSE', 's4 sag t2 frfse'],
    ['  Ax--T2   FSE ', 'ax t2 fse'],
    ['Sag-STIR', 'sag stir'],
    ['', ''],
  ])('FE-UT-75: normalizeSeriesName(%o) -> %o', (input, expected) => {
    expect(normalizeSeriesName(input)).toBe(expected)
  })

  test.each([
    ['L4/L5', 'l4_l5'],
    ['L5 S1', 'l5_s1'],
    ['l1_l2', 'l1_l2'],
    ['L5/S1', 'l5_s1'],
    ['L5  S1', 'l5_s1'],
  ])('FE-UT-76: normalizeSpineLevel(%o) -> %o', (input, expected) => {
    expect(normalizeSpineLevel(input)).toBe(expected)
  })

  test.each([
    ['Left', 'left'],
    ['LEFT side', 'left'],
    ['right', 'right'],
    ['Right side', 'right'],
    [undefined, ''],
    ['', ''],
    ['Center', 'center'],
  ])('FE-UT-77: normalizeSpineSide(%o) -> %o', (input, expected) => {
    expect(normalizeSpineSide(input)).toBe(expected)
  })

  test.each([
    ['Left Neural Foraminal Narrowing', 'left'],
    ['Right Subarticular Stenosis', 'right'],
    ['Spinal Canal Stenosis', ''],
    ['left neural foraminal narrowing', ''],
  ])('FE-UT-78: getSpineSideFromCondition(%o) -> %o (phân biệt hoa/thường như toạ độ RSNA)', (input, expected) => {
    expect(getSpineSideFromCondition(input)).toBe(expected)
  })

  test.each([
    ['Spinal Canal Stenosis', 'spinal_canal_stenosis'],
    ['spinal_canal_stenosis', 'spinal_canal_stenosis'],
    ['Left Neural Foraminal Narrowing', 'neural_foraminal_narrowing'],
    ['right_neural_foraminal_narrowing', 'neural_foraminal_narrowing'],
    ['RIGHT Subarticular Stenosis', 'subarticular_stenosis'],
    ['subarticular stenosis at L4', 'subarticular_stenosis'],
    ['Disc Bulge', 'disc_bulge'],
    ['Disc  Bulge', 'disc_bulge'],
    ['Left Disc Bulge', 'disc_bulge'],
    ['Left  Disc Bulge', 'disc_bulge'],
    ['Disc Left Bulge', 'disc_left_bulge'],
    ['subarticular_stenosis_at_L4', 'subarticular_stenosis'],
  ])('FE-UT-79: normalizeSpineConditionKey(%o) -> %o', (input, expected) => {
    expect(normalizeSpineConditionKey(input)).toBe(expected)
  })

  test('FE-UT-80: getSpineFindingKey ghép điều kiện, mức, bên bằng "__"', () => {
    expect(getSpineFindingKey('Left Neural Foraminal Narrowing', 'L4/L5', 'Left')).toBe('neural_foraminal_narrowing__l4_l5__left')
    expect(getSpineFindingKey('spinal_canal_stenosis', 'L5/S1')).toBe('spinal_canal_stenosis__l5_s1__')
  })
})

describe('Ghép mức độ tổn thương với toạ độ', () => {
  const leftNfn = coordinate({ condition: 'Left Neural Foraminal Narrowing', level: 'L4/L5', x: 1 })
  const rightNfn = coordinate({ condition: 'Right Neural Foraminal Narrowing', level: 'L4/L5', x: 2 })
  const scs = coordinate({ condition: 'Spinal Canal Stenosis', level: 'L4/L5', x: 3 })

  test('FE-UT-81: khoá của mức độ và toạ độ trùng nhau khi cùng điều kiện, mức, bên; tìm đúng toạ độ', () => {
    const finding = severity({ condition: 'neural_foraminal_narrowing', side: 'left' })
    expect(getSpineSeverityKey(finding)).toBe(getSpineCoordinateKey(leftNfn))
    expect(findSpineCoordinateForFinding([scs, rightNfn, leftNfn], 'neural_foraminal_narrowing', 'L4/L5', 'left')).toBe(leftNfn)
    expect(findSpineCoordinateForFinding([scs, rightNfn, leftNfn], 'neural_foraminal_narrowing', 'L4/L5', 'right')).toBe(rightNfn)
    expect(findSpineCoordinateForFinding([scs, rightNfn], 'neural_foraminal_narrowing', 'L5/S1', 'left')).toBeUndefined()
    expect(findSpineCoordinateForFinding([], 'spinal_canal_stenosis', 'L4/L5', '')).toBeUndefined()
  })

  test.each([
    ['Severe', true],
    ['Moderate', true],
    ['Normal/Mild', false],
    ['', false],
  ])('FE-UT-82: isAbnormalSpineSeverity(nhãn %o) -> %o', (label, expected) => {
    expect(isAbnormalSpineSeverity(severity({ predictedLabel: label }))).toBe(expected)
  })

  test('FE-UT-83: getAllAbnormalSpineFindings chỉ giữ Moderate/Severe; kết quả null -> []', () => {
    const items = [severity({ predictedLabel: 'Severe' }), severity({ predictedLabel: 'Normal/Mild' }), severity({ predictedLabel: 'Moderate' })]
    expect(getAllAbnormalSpineFindings(result(items))).toEqual([items[0], items[2]])
    expect(getAllAbnormalSpineFindings(null)).toEqual([])
  })

  test('FE-UT-84: getAbnormalSpineFindings lọc theo từng nhóm điều kiện scs/nfn/ss (bảng quyết định điều kiện × nhãn)', () => {
    const items = [
      severity({ condition: SPINE_CONDITION_API_KEYS.scs, predictedLabel: 'Severe' }),
      severity({ condition: SPINE_CONDITION_API_KEYS.nfn, side: 'left', predictedLabel: 'Moderate' }),
      severity({ condition: SPINE_CONDITION_API_KEYS.nfn, side: 'right', predictedLabel: 'Normal/Mild' }),
      severity({ condition: SPINE_CONDITION_API_KEYS.ss, side: 'left', predictedLabel: 'Severe' }),
    ]
    expect(getAbnormalSpineFindings(result(items), 'scs')).toEqual([items[0]])
    expect(getAbnormalSpineFindings(result(items), 'nfn')).toEqual([items[1]])
    expect(getAbnormalSpineFindings(result(items), 'ss')).toEqual([items[3]])
    expect(getAbnormalSpineFindings(null, 'scs')).toEqual([])
  })

  // BUG-30: cùng mô-đun coi 'Spinal Canal Stenosis' và 'spinal_canal_stenosis' là một (normalizeSpineConditionKey),
  // nhưng bộ lọc tổn thương bất thường so sánh nguyên văn nên bỏ sót tổn thương nặng.
  test.fails.each([
    ['điều kiện dạng hiển thị', severity({ condition: 'Spinal Canal Stenosis', predictedLabel: 'Severe' })],
    ['nhãn viết thường', severity({ condition: 'spinal_canal_stenosis', predictedLabel: 'severe' })],
  ])('FE-UT-85 (BUG-30): %s -> vẫn được tính là tổn thương bất thường của nhóm scs', (_name, item) => {
    expect(getAbnormalSpineFindings(result([item]), 'scs')).toEqual([item])
  })

  test('FE-UT-86: filterVisibleSpineCoordinates theo nhóm điều kiện đang chọn và bỏ toạ độ đã xác nhận', () => {
    const all = [leftNfn, rightNfn, scs, coordinate({ condition: 'Left Subarticular Stenosis', x: 4 })]
    expect(filterVisibleSpineCoordinates(all, null, new Set())).toEqual(all)
    expect(filterVisibleSpineCoordinates(all, 'nfn', new Set())).toEqual([leftNfn, rightNfn])
    expect(filterVisibleSpineCoordinates(all, 'scs', new Set())).toEqual([scs])
    expect(filterVisibleSpineCoordinates(all, 'ss', new Set())).toEqual([all[3]])
    expect(filterVisibleSpineCoordinates(all, 'nfn', new Set([getSpineCoordinateKey(leftNfn)]))).toEqual([rightNfn])
    expect(filterVisibleSpineCoordinates(all, null, new Set(all.map(getSpineCoordinateKey)))).toEqual([])
  })
})

describe('Ghép series với pipeline của AI', () => {
  test.each([
    [1, 'S3_Sag_T1_FSE', true],
    [1, 'S4_Sag_T2_frFSE', false],
    [2, 'S4_Sag_T2_frFSE', true],
    [2, 'Sag_STIR', true],
    [2, 'S3_Sag_T1_FSE', false],
    [3, 'S1_Ax_T2_FSE', true],
    [3, 'S3_Sag_T1_FSE', false],
    [1, 'S2_Cor_T2_FSE_STIR', false],
    [2, 'S2_Cor_T2_FSE_STIR', false],
    [3, 'S2_Cor_T2_FSE_STIR', false],
    [1, 'Cor_T1', false],
    [3, 'Ax_T1', false],
    [0, 'S1_Ax_T2_FSE', false],
    [4, 'S1_Ax_T2_FSE', false],
  ])('FE-UT-87: không có series_mapping, pipeline %i với series %s -> %o (heuristic theo tên)', (pipeline, name, expected) => {
    expect(matchesPipelineSeries(name, pipeline, undefined)).toBe(expected)
  })

  test.each([
    ['trùng khớp', 'S1_Ax_T2_FSE', 'S1_Ax_T2_FSE'],
    ['chứa nhau', 'Patient1 S1 Ax T2 FSE', 'S1_Ax_T2_FSE'],
    ['khác ký tự phân cách và hoa/thường', 's1-ax-t2-fse', 'S1_Ax_T2_FSE'],
  ])('FE-UT-88: series_mapping %s -> khớp', (_name, seriesId, mapped) => {
    expect(matchesPipelineSeries(seriesId, 3, { 3: mapped })).toBe(true)
  })

  // Pipeline 7 không có heuristic dự phòng, nên kết quả chỉ do series_mapping quyết định.
  test.each([
    ['trùng sau chuẩn hoá', 'se7', { 7: 'SE7' }, true],
    ['tên series chứa tên ánh xạ (1 từ)', 'Study SE7', { 7: 'SE7' }, true],
    ['không liên quan', 'Other', { 7: 'SE7' }, false],
    ['trùng 2 từ có nghĩa', 'Localizer Sag', { 7: 'Sag T1 Spine Localizer' }, true],
    ['chỉ trùng 1 từ', 'Sag Other', { 7: 'Sag T1 Spine Localizer' }, false],
    ['chỉ trùng các từ 1 ký tự', 'a b x', { 7: 'a b c sag' }, false],
  ])('FE-UT-88c: pipeline 7, series_mapping %s -> %o', (_name, seriesId, mapping, expected) => {
    expect(matchesPipelineSeries(seriesId, 7, mapping as Record<string, string>)).toBe(expected)
  })

  test('FE-UT-88b: ánh xạ ở pipeline khác không làm khớp pipeline đang xét', () => {
    expect(matchesPipelineSeries('S3_Sag_T1_FSE', 3, { 1: 'S3_Sag_T1_FSE' })).toBe(false)
  })

  // BUG-28: một kết quả AI chỉ thuộc một series, nhưng heuristic "trùng ≥ 2 từ" và heuristic dự phòng theo tên
  // vẫn chạy khi đã có series_mapping, nên toạ độ của ảnh Ax T2 bị vẽ lên cả series Cor T2 STIR (SpineOverlay).
  test.fails('FE-UT-89 (BUG-28): với series_mapping của ca CASE01, mỗi pipeline khớp đúng một series', () => {
    for (const pipeline of [1, 2, 3]) {
      const matches = CASE_SERIES.filter((name) => matchesPipelineSeries(name, pipeline, CASE_MAPPING))
      expect(matches).toEqual([CASE_MAPPING[pipeline]])
    }
  })
  test.fails('FE-UT-89b (BUG-28): đã có series_mapping thì series sagittal khác (Sag STIR) không nhận toạ độ của pipeline 2', () => {
    expect(matchesPipelineSeries('S5_Sag_STIR', 2, CASE_MAPPING)).toBe(false)
  })

  test('FE-UT-90: findSeriesForPipelineTarget trả series khớp đầu tiên, không có -> undefined', () => {
    const series: DicomSeries[] = CASE_SERIES.map((id) => ({ id, name: id, files: ['IM0001.dcm'], totalFiles: 1 }))
    expect(findSeriesForPipelineTarget(series, 1)?.id).toBe('S3_Sag_T1_FSE')
    expect(findSeriesForPipelineTarget(series, 3, CASE_MAPPING)?.id).toBe('S1_Ax_T2_FSE')
    expect(findSeriesForPipelineTarget(series, 9)).toBeUndefined()
    expect(findSeriesForPipelineTarget([], 1)).toBeUndefined()
  })
})

describe('Tính chất (fast-check)', () => {
  const variant = (text: string, upper: boolean[], sep: string) =>
    text.split(' ').map((w, i) => (upper[i % upper.length] ? w.toUpperCase() : w)).join(sep)

  test('FE-PBT-08: khoá tổn thương không đổi theo hoa/thường, dấu phân cách và tiền tố bên; normalizeSeriesName lũy đẳng', () => {
    const conditions = ['spinal canal stenosis', 'neural foraminal narrowing', 'subarticular stenosis']
    fc.assert(fc.property(
      fc.constantFrom(...conditions),
      fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }),
      fc.constantFrom(' ', '_'),
      fc.constantFrom('', 'left', 'Right'),
      fc.integer({ min: 1, max: 4 }),
      (condition, upper, sep, side, n) => {
        const level = `L${n}/L${n + 1}`
        const prefixed = side ? `${side}${sep}${variant(condition, upper, sep)}` : variant(condition, upper, sep)
        expect(getSpineFindingKey(prefixed, level, side)).toBe(getSpineFindingKey(condition.replace(/ /g, '_'), level.toLowerCase(), side.toLowerCase()))
      },
    ), { numRuns: 300 })
    fc.assert(fc.property(fc.string(), (s) => {
      expect(normalizeSeriesName(normalizeSeriesName(s))).toBe(normalizeSeriesName(s))
    }), { numRuns: 300 })
  })
})
