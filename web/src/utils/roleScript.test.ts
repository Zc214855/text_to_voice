import { describe, expect, it } from 'vitest'
import { parseRoleScript } from './roleScript'

describe('roleScript', () => {
  it('parses Chinese colon role lines', () => {
    const parsed = parseRoleScript('旁白：月亮升起来。\n小兔：妈妈，星星为什么会眨眼睛？')

    expect(parsed.roles).toEqual(['旁白', '小兔'])
    expect(parsed.segments).toMatchObject([
      { role: '旁白', text: '月亮升起来。' },
      { role: '小兔', text: '妈妈，星星为什么会眨眼睛？' },
    ])
  })

  it('parses half-width colon role lines', () => {
    const parsed = parseRoleScript('妈妈: 因为它们在祝你做个好梦。')

    expect(parsed.roles).toEqual(['妈妈'])
    expect(parsed.segments[0]).toMatchObject({
      role: '妈妈',
      text: '因为它们在祝你做个好梦。',
    })
  })

  it('assigns unmarked lines to narration', () => {
    const parsed = parseRoleScript('森林变得安静。\n小兔：我听见风声了。')

    expect(parsed.roles).toEqual(['旁白', '小兔'])
    expect(parsed.segments[0]).toMatchObject({
      role: '旁白',
      text: '森林变得安静。',
    })
  })

  it('merges adjacent segments with the same role', () => {
    const parsed = parseRoleScript('旁白：第一句。\n旁白：第二句。\n小兔：第三句。')

    expect(parsed.segments).toHaveLength(2)
    expect(parsed.segments[0]).toMatchObject({
      role: '旁白',
      text: '第一句。\n第二句。',
    })
  })

  it('ignores blank lines and empty role lines', () => {
    const parsed = parseRoleScript('\n旁白：\n\n小兔：你好。\n')

    expect(parsed.roles).toEqual(['小兔'])
    expect(parsed.segments).toHaveLength(1)
    expect(parsed.segments[0].text).toBe('你好。')
  })

  it('reads title as narration with a pause and excludes it from roles', () => {
    const parsed = parseRoleScript('标题：团团和会变圆的月亮\n\n旁白：云竹山谷安静下来。')

    expect(parsed.roles).toEqual(['旁白'])
    expect(parsed.segments).toHaveLength(2)
    expect(parsed.segments[0]).toMatchObject({
      role: '旁白',
      text: '团团和会变圆的月亮\n\n',
      isTitle: true,
    })
    expect(parsed.segments[1]).toMatchObject({
      role: '旁白',
      text: '云竹山谷安静下来。',
    })
  })
})
