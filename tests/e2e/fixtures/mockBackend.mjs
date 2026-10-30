// Mục đích: Giả lập trong bộ nhớ các API quản trị của backend (/api/v1/hospitals, /auth/users, /departments)
// theo đúng hình dạng phản hồi ({ data }) và quy tắc của controller/service/mapper backend, để kịch bản E2E
// kiểm tra luồng quản trị và request frontend gửi đi. Dữ liệu là tài khoản giả.
import { randomUUID } from 'node:crypto'
import { ACCOUNTS, HOSPITAL } from './accounts.mjs'

const NOW = '2026-01-01T00:00:00.000Z'
const HOSPITAL_CODE_PATTERN = /^[A-Za-z0-9_-]{6,30}$/

export function createBackendState() {
  const hospitals = [{ ...HOSPITAL, address: null, phone: null, email: null, isActive: true, createdAt: NOW, updatedAt: NOW }]
  const users = Object.values(ACCOUNTS).map((a) => ({
    id: a.id, email: a.email, fullName: a.fullName, role: a.role,
    hospitalId: a.role === 'admin' ? null : HOSPITAL.id, departmentId: null, specialty: null,
    employeeCode: null, phone: null, isActive: !a.locked, createdAt: NOW,
  }))
  return { hospitals, users, departments: [], calls: [] }
}

const fail = (status, error) => ({ status, body: { error } })
const ok = (data, status = 200) => ({ status, body: { data } })

function hospitalDto(state, h) {
  return { ...h, accountCount: state.users.filter((u) => u.hospitalId === h.id).length }
}

function departmentDto(state, d) {
  return { ...d, doctorCount: state.users.filter((u) => u.departmentId === d.id).length }
}

function profileDto(state, u) {
  const hospital = state.hospitals.find((h) => h.id === u.hospitalId)
  const department = state.departments.find((d) => d.id === u.departmentId)
  return {
    id: u.id, hospitalId: u.hospitalId, hospital: hospital ? { id: hospital.id, code: hospital.code, name: hospital.name } : null,
    departmentId: u.departmentId, department: department ? { id: department.id, name: department.name } : null,
    specialty: u.specialty, employeeCode: u.employeeCode, fullName: u.fullName, email: u.email, phone: u.phone,
    role: u.role, status: u.isActive ? 'active' : 'inactive', isActive: u.isActive, avatarUrl: null, lastLoginAt: null, createdAt: u.createdAt,
  }
}

function paginate(items, query) {
  const page = Number.parseInt(query.get('page'), 10) || 1
  const perPage = Math.min(Number.parseInt(query.get('perPage'), 10) || 20, 100)
  return { data: items.slice((page - 1) * perPage, page * perPage), total: items.length, page, perPage }
}

function normalizeName(name) {
  const value = String(name || '').trim().replace(/\s+/g, ' ')
  if (!value) return { error: 'Ten khoa la bat buoc' }
  if (value.length > 150) return { error: 'Ten khoa toi da 150 ky tu' }
  return { value }
}

function defaultPasswordFor(state, user) {
  const code = state.hospitals.find((h) => h.id === user.hospitalId)?.code
  if (!code) return null
  return user.role === 'hospital' ? code : code.charAt(0).toUpperCase() + code.slice(1).toLowerCase() + '@123'
}

/** Kiểm tra quyền quản lý tài khoản đích như AuthService.getManageableUser. */
function manageable(actor, target, { allowAdminTarget = true } = {}) {
  if (!target) return fail(404, 'Khong tim thay profile')
  if (actor.role === 'hospital') {
    if (target.role !== 'doctor' || target.hospitalId !== actor.hospitalId) return fail(403, 'Ban chi quan ly duoc bac si thuoc benh vien cua minh')
  } else if (actor.role !== 'admin') {
    return fail(403, 'Ban khong co quyen thuc hien hanh dong nay')
  } else if (!allowAdminTarget && target.role === 'admin') {
    return fail(403, 'Khong the thao tac voi tai khoan admin')
  }
  return null
}

/**
 * Xử lý request quản trị. `actor` là hồ sơ người gọi (đã xác thực) hoặc undefined.
 * Trả { status, body } hoặc null nếu không phải endpoint quản trị.
 */
export function handleBackend(state, { method, path, query, body, actorAccount }) {
  const routes = [
    [/^\/api\/v1\/hospitals$/, true],
    [/^\/api\/v1\/hospitals\/[^/]+(\/status|\/reset-password)?$/, true],
    [/^\/api\/v1\/auth\/users(\/[^/]+(\/status|\/reset-password)?)?$/, true],
    [/^\/api\/v1\/departments(\/[^/]+)?$/, true],
  ]
  if (!routes.some(([re]) => re.test(path))) return null
  state.calls.push({ method, path, query: Object.fromEntries(query), body, role: actorAccount?.role ?? null })
  if (!actorAccount) return fail(401, 'Token xac thuc la bat buoc')
  const actor = state.users.find((u) => u.id === actorAccount.id)
  const isAdmin = actor.role === 'admin'
  const canManage = isAdmin || actor.role === 'hospital'
  const parts = path.split('/').slice(3)
  const findHospital = (id) => state.hospitals.find((h) => h.id === decodeURIComponent(id))
  const findUser = (id) => state.users.find((u) => u.id === decodeURIComponent(id))

  // ----- /hospitals -----
  if (parts[0] === 'hospitals') {
    const [, id, action] = parts
    if (!id && method === 'GET') {
      if (!isAdmin) return fail(403, 'Ban khong co quyen thuc hien hanh dong nay')
      return ok(paginate([...state.hospitals].reverse().map((h) => hospitalDto(state, h)), query))
    }
    if (!id && method === 'POST') {
      if (!isAdmin) return fail(403, 'Ban khong co quyen thuc hien hanh dong nay')
      if (!body.code || !body.name) return fail(400, 'Ma va ten benh vien la bat buoc')
      if (!HOSPITAL_CODE_PATTERN.test(body.code)) return fail(400, 'Ma benh vien chi gom chu, so, - hoac _, dai 6-30 ky tu')
      if (state.hospitals.some((h) => h.code === body.code)) return fail(400, 'Ma benh vien da ton tai')
      const hospital = {
        id: randomUUID(), code: body.code, name: body.name, address: body.address || null, phone: body.phone || null,
        email: body.email || null, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }
      state.hospitals.push(hospital)
      const email = `${body.code.toLowerCase()}@spineinsight.vn`
      state.users.push({ id: randomUUID(), email, fullName: body.name, role: 'hospital', hospitalId: hospital.id, departmentId: null, specialty: null, employeeCode: null, phone: body.phone || null, isActive: true, createdAt: hospital.createdAt })
      return ok({ ...hospitalDto(state, hospital), managerAccount: { email, password: body.code } }, 201)
    }
    const hospital = findHospital(id)
    if (method === 'GET' && !action) {
      if (!isAdmin && hospital?.id !== actor.hospitalId) return fail(403, 'Ban khong co quyen xem benh vien nay')
      return hospital ? ok(hospitalDto(state, hospital)) : fail(404, 'Khong tim thay benh vien')
    }
    if (!isAdmin) return fail(403, 'Ban khong co quyen thuc hien hanh dong nay')
    if (!hospital) return fail(404, 'Khong tim thay benh vien')
    if (method === 'PATCH' && action === 'status') {
      if (typeof body.isActive !== 'boolean') return fail(400, 'isActive phai la true hoac false')
      hospital.isActive = body.isActive
      return ok(hospitalDto(state, hospital))
    }
    if (method === 'POST' && action === 'reset-password') {
      const managers = state.users.filter((u) => u.hospitalId === hospital.id && u.role === 'hospital')
      if (managers.length === 0) return fail(404, 'Benh vien chua co tai khoan quan ly')
      return ok({ password: hospital.code, emails: managers.map((m) => m.email) })
    }
    if (method === 'DELETE' && !action) {
      const accounts = state.users.filter((u) => u.hospitalId === hospital.id)
      state.users = state.users.filter((u) => u.hospitalId !== hospital.id)
      state.departments = state.departments.filter((d) => d.hospitalId !== hospital.id)
      state.hospitals = state.hospitals.filter((h) => h.id !== hospital.id)
      return ok({ deletedAccounts: accounts.length, deletedStudies: 0 })
    }
  }

  // ----- /auth/users -----
  if (parts[0] === 'auth') {
    const [, , id, action] = parts
    if (!canManage) return fail(403, 'Ban khong co quyen thuc hien hanh dong nay')
    if (!id && method === 'GET') {
      let items = state.users
      if (actor.role === 'hospital') items = items.filter((u) => u.hospitalId === actor.hospitalId)
      else if (query.get('hospitalId')) items = items.filter((u) => u.hospitalId === query.get('hospitalId'))
      if (query.get('role')) items = items.filter((u) => u.role === query.get('role'))
      if (query.get('departmentId')) items = items.filter((u) => u.departmentId === query.get('departmentId'))
      const q = (query.get('q') || '').toLowerCase()
      if (q) items = items.filter((u) => [u.fullName, u.email, u.employeeCode, u.phone].some((v) => v && v.toLowerCase().includes(q)))
      return ok(paginate([...items].reverse().map((u) => profileDto(state, u)), query))
    }
    if (!id && method === 'POST') {
      if (!body.email || !body.password || !body.fullName) return fail(400, 'Email, mat khau va ho ten la bat buoc')
      if (body.password.length < 8) return fail(400, 'Mat khau phai co it nhat 8 ky tu')
      const role = body.role || 'doctor'
      let hospitalId
      if (isAdmin) {
        if (!['hospital', 'doctor'].includes(role)) return fail(400, 'Role khong hop le. Chi tao duoc hospital hoac doctor')
        if (!body.hospitalId) return fail(400, 'Phai chon benh vien cho tai khoan')
        hospitalId = body.hospitalId
      } else {
        if (role !== 'doctor') return fail(403, 'Tai khoan benh vien chi tao duoc bac si')
        hospitalId = actor.hospitalId
      }
      const hospital = state.hospitals.find((h) => h.id === hospitalId)
      if (!hospital) return fail(404, 'Khong tim thay benh vien')
      if (!hospital.isActive) return fail(400, 'Benh vien da bi vo hieu hoa')
      const departmentId = role === 'doctor' && body.departmentId ? body.departmentId : null
      if (departmentId && !state.departments.some((d) => d.id === departmentId && d.hospitalId === hospitalId)) return fail(400, 'Khoa khong thuoc benh vien nay')
      if (state.users.some((u) => u.email === body.email)) return fail(400, 'A user with this email address has already been registered')
      const user = {
        id: randomUUID(), email: body.email, fullName: body.fullName, role, hospitalId, departmentId,
        specialty: role === 'doctor' ? String(body.specialty || '').trim().slice(0, 150) || null : null,
        employeeCode: body.employeeCode || null, phone: body.phone || null, isActive: true, createdAt: new Date().toISOString(),
      }
      state.users.push(user)
      return ok({ profile: profileDto(state, user) }, 201)
    }
    const target = findUser(id)
    if (target && target.id === actor.id && method !== 'GET') return fail(400, 'Khong the thao tac tren tai khoan cua minh')
    if (method === 'PATCH' && action === 'status') {
      if (typeof body.isActive !== 'boolean') return fail(400, 'isActive phai la true hoac false')
      const denied = manageable(actor, target)
      if (denied) return denied
      target.isActive = body.isActive
      return ok(profileDto(state, target))
    }
    if (method === 'POST' && action === 'reset-password') {
      const denied = manageable(actor, target, { allowAdminTarget: false })
      if (denied) return denied
      const password = defaultPasswordFor(state, target)
      if (!password) return fail(400, 'Tai khoan khong thuoc benh vien nao')
      return ok({ email: target.email, password })
    }
    if (method === 'DELETE' && !action) {
      const denied = manageable(actor, target, { allowAdminTarget: false })
      if (denied) return denied
      state.users = state.users.filter((u) => u.id !== target.id)
      return { status: 204 }
    }
  }

  // ----- /departments -----
  if (parts[0] === 'departments') {
    const [, id] = parts
    const resolveHospital = (requested) => (isAdmin ? requested : actor.hospitalId)
    if (!id && method === 'GET') {
      const hospitalId = resolveHospital(query.get('hospitalId'))
      if (!hospitalId) return fail(400, 'Phai chon benh vien')
      return ok(state.departments.filter((d) => d.hospitalId === hospitalId).sort((a, b) => a.name.localeCompare(b.name)).map((d) => departmentDto(state, d)))
    }
    if (!canManage) return fail(403, 'Ban khong co quyen thuc hien hanh dong nay')
    if (!id && method === 'POST') {
      const hospitalId = resolveHospital(body.hospitalId)
      if (!hospitalId) return fail(400, 'Phai chon benh vien')
      const name = normalizeName(body.name)
      if (name.error) return fail(400, name.error)
      if (state.departments.some((d) => d.hospitalId === hospitalId && d.name === name.value)) return fail(400, 'Ten khoa da ton tai trong benh vien')
      const department = { id: randomUUID(), hospitalId, name: name.value, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      state.departments.push(department)
      return ok(departmentDto(state, department), 201)
    }
    const department = state.departments.find((d) => d.id === decodeURIComponent(id))
    if (!department || (!isAdmin && department.hospitalId !== actor.hospitalId)) return fail(404, 'Khong tim thay khoa')
    if (method === 'PATCH') {
      const name = normalizeName(body.name)
      if (name.error) return fail(400, name.error)
      department.name = name.value
      return ok(departmentDto(state, department))
    }
    if (method === 'DELETE') {
      state.departments = state.departments.filter((d) => d.id !== department.id)
      state.users.forEach((u) => { if (u.departmentId === department.id) u.departmentId = null })
      return { status: 204 }
    }
  }
  return fail(404, `Mock khong ho tro ${method} ${path}`)
}
