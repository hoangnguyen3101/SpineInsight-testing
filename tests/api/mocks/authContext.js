// Tài khoản giả cho kiểm thử API: token "<vai trò>-token" ánh xạ sang user Supabase và profile tương ứng.
const h1 = { id: 'h1', code: 'BVTEST01', name: 'BV Kiểm thử 1', is_active: true }
const h2 = { id: 'h2', code: 'BVTEST02', name: 'BV Kiểm thử 2', is_active: true }

const baseProfile = { status: 'active', is_active: true, department_id: null, department: null }

function createProfiles() {
  return new Map([
    ['admin-id', { ...baseProfile, id: 'admin-id', email: 'admin@test.local', full_name: 'Quản trị', role: 'admin', hospital_id: null, hospital: null }],
    ['hospital-id', { ...baseProfile, id: 'hospital-id', email: 'bvtest01@test.local', full_name: 'Quản lý BV1', role: 'hospital', hospital_id: 'h1', hospital: h1 }],
    ['doctor-id', { ...baseProfile, id: 'doctor-id', email: 'doctor@test.local', full_name: 'Bác sĩ BV1', role: 'doctor', hospital_id: 'h1', hospital: h1 }],
    ['doctor-h2-id', { ...baseProfile, id: 'doctor-h2-id', email: 'doctor2@test.local', full_name: 'Bác sĩ BV2', role: 'doctor', hospital_id: 'h2', hospital: h2 }],
    ['locked-id', { ...baseProfile, id: 'locked-id', email: 'locked@test.local', full_name: 'Bị khoá', role: 'doctor', hospital_id: 'h1', hospital: h1, is_active: false, status: 'inactive' }],
  ])
}

const TOKENS = {
  'admin-token': 'admin-id',
  'hospital-token': 'hospital-id',
  'doctor-token': 'doctor-id',
  'doctor-h2-token': 'doctor-h2-id',
  'locked-token': 'locked-id',
}

// Gắn giả lập xác thực: supabaseAdmin.auth.getUser theo token, AuthService.getProfileById theo id.
function installAuth({ supabaseAdmin, AuthService, createHttpError }) {
  const profiles = createProfiles()
  supabaseAdmin.auth.getUser.mockImplementation(async (token) => {
    const id = TOKENS[token]
    return id
      ? { data: { user: { id, email: profiles.get(id).email } }, error: null }
      : { data: { user: null }, error: { message: 'invalid JWT' } }
  })
  jest.spyOn(AuthService, 'getProfileById').mockImplementation(async (id) => {
    if (!profiles.has(id)) throw createHttpError('Khong tim thay profile', 404)
    return profiles.get(id)
  })
  return profiles
}

const bearer = (role) => ({ Authorization: `Bearer ${role}-token` })

module.exports = { installAuth, bearer, h1, h2 }
