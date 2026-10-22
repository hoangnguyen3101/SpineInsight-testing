// features/auth/utils.ts - phân vùng tương đương (EP): vai trò × giá trị `from` (trong khu vực, đúng trang chủ,
// khu vực vai trò khác, rỗng, tiền tố giống khu vực). Đặc tả FR-04: chỉ quay lại `from` nếu thuộc khu vực của vai trò.
import { describe, expect, test } from 'vitest'
import { homePathFor, redirectPathAfterLogin } from '@/features/auth/utils'
import type { UserRole } from '@/features/auth/types'

const HOME: Record<UserRole, string> = { admin: '/admin', hospital: '/hospital', doctor: '/viewer' }
const ROLES = Object.keys(HOME) as UserRole[]

describe('homePathFor', () => {
  test.each(ROLES)('FE-UT-01: trang chủ của vai trò %s', (role) => {
    expect(homePathFor(role)).toBe(HOME[role])
  })
})

describe('redirectPathAfterLogin', () => {
  test.each([
    ['admin', '/admin/accounts'],
    ['hospital', '/hospital/departments'],
    ['doctor', '/viewer'],
  ] as const)('FE-UT-02: %s, from=%s thuộc khu vực -> quay lại from', (role, from) => {
    expect(redirectPathAfterLogin(role, from)).toBe(from)
  })

  test.each(ROLES)('FE-UT-03: %s, from đúng bằng trang chủ -> trang chủ', (role) => {
    expect(redirectPathAfterLogin(role, HOME[role])).toBe(HOME[role])
  })

  test.each(
    ROLES.flatMap((role) => ROLES.filter((other) => other !== role).map((other) => [role, `${HOME[other]}/x`] as const)),
  )('FE-UT-04: %s, from=%s thuộc khu vực vai trò khác -> trang chủ của mình', (role, from) => {
    expect(redirectPathAfterLogin(role, from)).toBe(HOME[role])
  })

  test.each([
    ['admin', undefined],
    ['hospital', ''],
    ['doctor', '/'],
  ] as const)('FE-UT-05: %s, from=%o rỗng hoặc trang công khai -> trang chủ', (role, from) => {
    expect(redirectPathAfterLogin(role, from)).toBe(HOME[role])
  })

  // BUG-11: so khớp bằng startsWith nên đường dẫn chỉ "giống tiền tố" cũng được coi là thuộc khu vực.
  test.fails.each([
    ['admin', '/administrator'],
    ['hospital', '/hospitals'],
    ['doctor', '/viewer-old'],
  ] as const)('FE-UT-06 (BUG-11): %s, from=%s chỉ trùng tiền tố -> phải về trang chủ', (role, from) => {
    expect(redirectPathAfterLogin(role, from)).toBe(HOME[role])
  })
})
