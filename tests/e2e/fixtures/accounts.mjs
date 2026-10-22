// Mục đích: Tài khoản giả cho kiểm thử E2E (không phải tài khoản thật của hệ thống).
export const ACCOUNTS = {
  admin: { id: 'e2e-admin', email: 'admin@test.local', password: 'Admin@12345', role: 'admin', fullName: 'E2E Admin' },
  hospital: { id: 'e2e-hospital', email: 'hospital@test.local', password: 'Hospital@12345', role: 'hospital', fullName: 'E2E Hospital Manager' },
  doctor: { id: 'e2e-doctor', email: 'doctor@test.local', password: 'Doctor@12345', role: 'doctor', fullName: 'E2E Doctor' },
  // Đăng nhập Supabase thành công nhưng backend trả 403 (tài khoản đã bị vô hiệu hoá).
  locked: { id: 'e2e-locked', email: 'locked@test.local', password: 'Locked@12345', role: 'doctor', fullName: 'E2E Locked', locked: true },
}

export const HOSPITAL = { id: 'e2e-hospital-1', code: 'E2EHOSP', name: 'Benh vien E2E' }
