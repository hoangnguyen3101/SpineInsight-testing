// Mục đích: Phản hồi giả của dịch vụ AI cho kịch bản E2E, đúng hình dạng mà frontend đọc
// (spineService.normalizeSpineResult, p2vgService.normalizeReportResult, impressionService).
// Toạ độ đặt trên đúng số instance của ca CASE01 (S3 Sag T1, S4 Sag T2: 15 lát; S1 Ax T2: 24 lát; ảnh 1024×1024)
// để dấu đánh dấu rơi vào ảnh thật. Đây là dữ liệu giả, không phải kết quả chẩn đoán.

const LEVELS = ['l1_l2', 'l2_l3', 'l3_l4', 'l4_l5', 'l5_s1']
const CONDITIONS = [
  ['spinal_canal_stenosis', ''],
  ['neural_foraminal_narrowing', 'left'],
  ['neural_foraminal_narrowing', 'right'],
  ['subarticular_stenosis', 'left'],
  ['subarticular_stenosis', 'right'],
]

/** Mức bất thường đã chọn cho ca giả: 1 Severe và 2 Moderate, còn lại Normal/Mild. */
export const ABNORMAL = [
  { condition: 'spinal_canal_stenosis', side: '', level: 'l4_l5', label: 'Severe', probs: [0.07, 0.12, 0.81] },
  { condition: 'neural_foraminal_narrowing', side: 'left', level: 'l5_s1', label: 'Moderate', probs: [0.26, 0.62, 0.12] },
  { condition: 'subarticular_stenosis', side: 'left', level: 'l4_l5', label: 'Moderate', probs: [0.33, 0.55, 0.12] },
]

/** Toạ độ (pixel trong ảnh 1024×1024) theo series của pipeline: 1 = Sag T1, 2 = Sag T2, 3 = Ax T2. */
export const COORDINATES = [
  { seriesId: 2, instanceNumber: 8, condition: 'Spinal Canal Stenosis', level: 'L4/L5', x: 520, y: 610 },
  { seriesId: 1, instanceNumber: 8, condition: 'Left Neural Foraminal Narrowing', level: 'L5/S1', x: 505, y: 700 },
  { seriesId: 3, instanceNumber: 12, condition: 'Left Subarticular Stenosis', level: 'L4/L5', x: 470, y: 560 },
]

/** Kết quả RSNA sau khi backend chuyển sang camelCase (toSpineResultDto). */
export function rsnaResult() {
  const severity = []
  for (const level of LEVELS) {
    for (const [condition, side] of CONDITIONS) {
      const abnormal = ABNORMAL.find((a) => a.condition === condition && a.side === side && a.level === level)
      const [normalMild, moderate, severe] = abnormal ? abnormal.probs : [0.91, 0.07, 0.02]
      const predictedLabel = abnormal ? abnormal.label : 'Normal/Mild'
      severity.push({ condition, level, side, normalMild, moderate, severe, predictedLabel, confidence: Math.max(normalMild, moderate, severe) })
    }
  }
  return {
    studyId: 1001,
    seriesMapping: { 1: 'Sag T1 FSE', 2: 'Sag T2 frFSE', 3: 'Ax T2 FSE' },
    coordinates: COORDINATES.map((c) => ({ studyId: 1001, ...c })),
    severity,
    modelVersion: 'rsna2024-e2e-mock',
    processingTimeMs: 4200,
  }
}

export const REPORT_FINDINGS = [
  'L1-L2, L2-L3: Disc height and signal preserved. No canal or foraminal stenosis.',
  'L3-L4: Mild disc bulge without significant stenosis.',
  'L4-L5: Diffuse disc bulge with ligamentum flavum thickening causing severe central canal stenosis and moderate left subarticular narrowing.',
  'L5-S1: Left foraminal disc protrusion with moderate left neural foraminal narrowing.',
].join('\n')

export const REPORT_IMPRESSION = 'Severe spinal canal stenosis at L4-L5. Moderate left neural foraminal narrowing at L5-S1.'

/** Phản hồi của dịch vụ sinh báo cáo P2VG (/api/v1/report/upload-dicom-zip). */
export function p2vgReport() {
  return {
    finding: REPORT_FINDINGS,
    impression: REPORT_IMPRESSION,
    impression_grounded: REPORT_IMPRESSION,
    grounding_used: false,
    grounding_sources: [],
    prompt_used: '',
    generation_time_seconds: 38.5,
    model_name: 'p2vg-e2e-mock',
    patient_id: 'CASE01',
    series_converted: ['Sag T1 FSE', 'Sag T2 frFSE', 'Ax T2 FSE', 'Cor T2 FSE STIR'],
    series_skipped: [],
    preprocessing_errors: [],
  }
}

export function impressionResponse() {
  return { status: 'ok', impression: REPORT_IMPRESSION, raw_output: REPORT_IMPRESSION }
}
