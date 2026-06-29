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

  it('does not merge lines inside [角色音色] block', () => {
    const input = '标题：团团\n\n[角色音色]\n旁白：女声、成年、温柔朗读、偏慢\n团团：不限、幼童、安静好奇、偏慢\n[/角色音色]'

    const result = cleanupTtsText(input)

    // 角色音色块内的两行不应该被合并成一行
    expect(result.text).toContain('旁白：女声、成年、温柔朗读、偏慢')
    expect(result.text).toContain('团团：不限、幼童、安静好奇、偏慢')
    // 确认两行仍然独立存在（没有被 join 成一行）
    const metaBlock = result.text.slice(result.text.indexOf('[角色音色]'), result.text.indexOf('[/角色音色]'))
    expect(metaBlock.split('\n').length).toBeGreaterThanOrEqual(3)
  })
})
