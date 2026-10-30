import { describe, expect, it } from 'vitest'
import { formatBuildVersion } from '../../src/core/version.ts'

describe('formatBuildVersion', () => {
  it('formats Kyiv time with the commit', () => {
    expect(formatBuildVersion(new Date('2026-10-30T10:05:00Z'), 'abc1234')).toBe('30.10.2026 12:05 · abc1234')
  })
  it('omits a missing commit', () => {
    expect(formatBuildVersion(new Date('2026-10-30T10:05:00Z'), null)).toBe('30.10.2026 12:05')
  })
})
