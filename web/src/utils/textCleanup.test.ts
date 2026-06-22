import { describe, expect, it } from 'vitest'
import { cleanupTtsText, countTextUnits, normalizeLineBreaks } from './textCleanup'

describe('textCleanup', () => {
  it('normalizes Windows and legacy Mac line endings', () => {
    expect(normalizeLineBreaks('甲\r\n乙\r丙')).toBe('甲\n乙\n丙')
  })

  it('counts Unicode code points instead of UTF-16 units', () => {
    expect(countTextUnits('甲😀乙')).toBe(3)
  })

  it('trims lines, removes list markers, and merges broken sentences', () => {
    const result = cleanupTtsText('  - 从前有一只兔子  \r\n住在森林边缘。\r\n\r\n\r\n第二段。')

    expect(result.text).toBe('从前有一只兔子住在森林边缘。\n\n第二段。')
    expect(result.changed).toBe(true)
    expect(result.mergedLines).toBe(1)
    expect(result.removedBlankLines).toBe(1)
  })

  it('keeps title lines separate from preceding text', () => {
    expect(cleanupTtsText('序言\n第一章 星光').text).toBe('序言\n第一章 星光')
  })
})
