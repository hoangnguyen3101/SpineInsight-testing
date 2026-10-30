// Mục đích: Dữ liệu giả dùng chung cho máy chủ giả Supabase (tài khoản, bệnh viện, khoa, ca chụp).
// Không có dữ liệu bệnh nhân thật; mọi email đều thuộc miền perf.local.
// Mọi id đều có dạng UUID như Supabase thật (auth-js ném lỗi nếu id người dùng không phải UUID).
const uuid = (group, n) => `00000000-0000-4000-${group}-${String(n).padStart(12, '0')}`

export const IDS = {
  admin: uuid('8001', 1),
  manager: uuid('8001', 2),
  doctor: uuid('8001', 3),
  hospital1: uuid('8002', 1),
  hospital2: uuid('8002', 2),
  department1: uuid('8003', 1),
  department2: uuid('8003', 2),
  study: (n) => uuid('8004', n),
  rsna: (n) => uuid('8005', n),
  report: (n) => uuid('8006', n),
}

export const ACCOUNTS = {
  admin: { id: IDS.admin, email: 'admin@perf.local', password: 'Admin@12345', role: 'admin', hospital_id: null, department_id: null, full_name: 'Perf Admin' },
  manager: { id: IDS.manager, email: 'manager@perf.local', password: 'Manager@12345', role: 'hospital', hospital_id: IDS.hospital1, department_id: null, full_name: 'Perf Manager' },
  doctor: { id: IDS.doctor, email: 'doctor@perf.local', password: 'Doctor@12345', role: 'doctor', hospital_id: IDS.hospital1, department_id: IDS.department1, full_name: 'Perf Doctor' },
}

const created = '2026-01-01T00:00:00.000Z'

export function seedTables() {
  const hospitals = [
    { id: IDS.hospital1, code: 'BVTEST01', name: 'Benh vien thu nghiem 1', address: 'Ha Noi', phone: null, email: null, is_active: true, created_by: IDS.admin, created_at: created, updated_at: created },
    { id: IDS.hospital2, code: 'BVTEST02', name: 'Benh vien thu nghiem 2', address: 'Ha Noi', phone: null, email: null, is_active: true, created_by: IDS.admin, created_at: created, updated_at: created },
  ]
  const departments = [
    { id: IDS.department1, hospital_id: IDS.hospital1, name: 'Chan doan hinh anh', created_by: IDS.manager, created_at: created, updated_at: created },
    { id: IDS.department2, hospital_id: IDS.hospital1, name: 'Than kinh', created_by: IDS.manager, created_at: created, updated_at: created },
  ]
  const profiles = Object.values(ACCOUNTS).map((a) => ({
    id: a.id,
    email: a.email,
    full_name: a.full_name,
    employee_code: null,
    phone: null,
    gender: null,
    date_of_birth: null,
    avatar_url: null,
    role: a.role,
    hospital_id: a.hospital_id,
    department_id: a.department_id,
    specialty: null,
    status: 'active',
    is_active: true,
    created_by: IDS.admin,
    last_login_at: null,
    notes: null,
    created_at: created,
    updated_at: created,
  }))
  const studies = Array.from({ length: 150 }, (_, i) => ({
    id: IDS.study(i + 1),
    patient_id: `CASE${String(i + 1).padStart(3, '0')}`,
    patient_name: null,
    study_date: '2025-01-01',
    modality: 'MR',
    body_part: 'LSPINE',
    description: null,
    dicom_path: null,
    file_count: 73,
    uploaded_by: IDS.doctor,
    hospital_id: IDS.hospital1,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    updated_at: created,
  }))
  const rsna_results = studies.slice(0, 20).map((s, i) => ({
    id: IDS.rsna(i + 1),
    study_id: s.id,
    severity: [{ level: 'L4/L5', condition: 'spinal_canal_stenosis', normal_mild: 0.7, moderate: 0.2, severe: 0.1, predicted_label: 'normal_mild' }],
    coordinates: [{ level: 'L4/L5', x: 512, y: 480, instance_number: 8, series_id: 'S3' }],
    series_mapping: { sagittal_t1: 'S3', sagittal_t2: 'S4', axial_t2: 'S1' },
    processing_time_ms: 1200,
    raw_response: null,
    created_at: created,
  }))
  const p2vg_reports = studies.slice(0, 10).map((s, i) => ({
    id: IDS.report(i + 1),
    study_id: s.id,
    rsna_result_id: IDS.rsna(i + 1),
    report: 'FINDINGS: mock report. IMPRESSION: mock.',
    prompt_used: null,
    rsna_findings: [],
    series_detected: ['S3', 'S4'],
    processing_time_ms: 900,
    edited_report: null,
    edited_by: null,
    edited_at: null,
    created_at: created,
  }))
  return { hospitals, departments, profiles, studies, rsna_results, p2vg_reports }
}
