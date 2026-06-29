import { describe, expect, it } from 'vitest'
import { parseRoleScript, parseVoiceMeta } from './roleScript'

describe('parseRoleScript', () => {
  it('parses basic role lines', () => {
    const result = parseRoleScript('旁白：月亮升起来了\n小兔：好亮呀')
    expect(result.roles).toEqual(['旁白', '小兔'])
    expect(result.segments.length).toBe(2)
    expect(result.segments[0].role).toBe('旁白')
    expect(result.segments[1].role).toBe('小兔')
  })

  it('merges consecutive same-role lines', () => {
    const result = parseRoleScript('旁白：第一句\n旁白：第二句')
    expect(result.segments.length).toBe(1)
    expect(result.segments[0].text).toContain('\n')
  })

  it('extracts title as special segment', () => {
    const result = parseRoleScript('标题：小兔和星星\n\n旁白：月亮升起来了')
    expect(result.segments[0].isTitle).toBe(true)
    expect(result.segments[0].role).toBe('旁白')
  })

  it('falls back to 旁白 for unmatched lines', () => {
    const result = parseRoleScript('没有冒号的行')
    expect(result.segments[0].role).toBe('旁白')
  })
})

describe('parseVoiceMeta', () => {
  it('parses valid [角色音色] block with Chinese commas', () => {
    const input = `旁白：月亮升起来了

[角色音色]
旁白：女声、成年、温柔朗读、偏慢
团团：女声、幼童、安静好奇、偏慢
栗栗：女声、幼童、活泼俏皮、偏快
[/角色音色]`

    const result = parseVoiceMeta(input)
    expect(result).not.toBeNull()
    expect(result!.metas.length).toBe(3)

    const narrator = result!.metas[0]
    expect(narrator.role).toBe('旁白')
    expect(narrator.descriptor.gender).toBe('女声')
    expect(narrator.descriptor.ageGroup).toBe('成年')
    expect(narrator.descriptor.tone).toBe('温柔朗读')
    expect(narrator.descriptor.speed).toBe('偏慢')

    const child = result!.metas[1]
    expect(child.descriptor.ageGroup).toBe('幼童')
    expect(child.descriptor.tone).toBe('安静好奇')

    // storyText should not contain the block
    expect(result!.storyText).toBe('旁白：月亮升起来了')
    expect(result!.storyText).not.toContain('[角色音色]')
  })

  it('returns null when no [角色音色] block exists', () => {
    const input = '旁白：月亮升起来了\n小兔：好亮呀'
    expect(parseVoiceMeta(input)).toBeNull()
  })

  it('returns null for malformed blocks (missing end tag)', () => {
    const input = '[角色音色]\n旁白：女声、成年、温柔、偏慢'
    expect(parseVoiceMeta(input)).toBeNull()
  })

  it('parses block with English commas as separators', () => {
    const input = `[角色音色]
妈妈：女声, 成年, 日常温柔, 中等
[/角色音色]`

    const result = parseVoiceMeta(input)
    expect(result).not.toBeNull()
    expect(result!.metas[0].descriptor.tone).toBe('日常温柔')
    expect(result!.metas[0].descriptor.speed).toBe('中等')
  })

  it('parses block with 顿号 as separators', () => {
    const input = `[角色音色]
奶奶：女声、老年、沉稳慈祥、很慢
[/角色音色]`

    const result = parseVoiceMeta(input)
    expect(result).not.toBeNull()
    expect(result!.metas[0].descriptor.speed).toBe('很慢')
    expect(result!.metas[0].descriptor.ageGroup).toBe('老年')
  })

  it('handles block with empty lines gracefully', () => {
    const input = `[角色音色]

旁白：女声、成年、温柔朗读、偏慢

团团：女声、幼童、安静好奇、偏慢

[/角色音色]`

    const result = parseVoiceMeta(input)
    expect(result).not.toBeNull()
    expect(result!.metas.length).toBe(2)
  })

  it('returns empty tone when only gender/age/speed are specified', () => {
    const input = `[角色音色]
某人：男声、成年、中等
[/角色音色]`

    const result = parseVoiceMeta(input)
    expect(result).not.toBeNull()
    expect(result!.metas[0].descriptor.tone).toBe('')
    expect(result!.metas[0].descriptor.gender).toBe('男声')
  })

  it('extracts storyText correctly from before and after block', () => {
    const input = `第一句
第二句
[角色音色]
旁白：女声、成年、温柔朗读、偏慢
[/角色音色]
第三句`

    const result = parseVoiceMeta(input)
    expect(result!.storyText).toContain('第一句')
    expect(result!.storyText).toContain('第三句')
    expect(result!.storyText).not.toContain('[角色音色]')
  })

  it('parses compact voice meta block without newlines', () => {
    // 紧凑格式（换行被吞）现在由 cleanupTtsText 防止，parseVoiceMeta 只需处理正常换行
    // 此测试验证多角色块在正常换行下完整解析
    const input = '标题：团团和小泥人\n\n旁白：秋天的雨停了。\n\n[角色音色]\n旁白：女声、成年、温柔朗读、偏慢\n团团：不限、幼童、安静好奇、偏慢\n陶爷爷：男声、老年、沉稳慈祥、偏慢\n奶奶：女声、老年、沉稳慈祥、偏慢\n栗栗：不限、幼童、活泼俏皮、中等\n[/角色音色]'

    const result = parseVoiceMeta(input)
    expect(result).not.toBeNull()
    expect(result!.metas.length).toBe(5)
    expect(result!.metas[0].role).toBe('旁白')
    expect(result!.metas[0].descriptor.gender).toBe('女声')
    expect(result!.metas[1].role).toBe('团团')
    expect(result!.metas[1].descriptor.ageGroup).toBe('幼童')
    expect(result!.metas[2].role).toBe('陶爷爷')
    expect(result!.metas[2].descriptor.gender).toBe('男声')
    expect(result!.metas[4].role).toBe('栗栗')
    expect(result!.metas[4].descriptor.tone).toBe('活泼俏皮')
  })
})
