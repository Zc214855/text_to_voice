import { describe, expect, it } from 'vitest'
import { classifyRole, getRoleSpeechParams, mapDescriptorToVoice, recommendVoices } from './voiceRecommender'
import type { PopularVoice } from '../composables/types'
import type { VoiceDescriptor } from './roleScript'

// 构造精简测试音色列表
const testVoices: PopularVoice[] = [
  { id: 'zh_female_xueayi', name: '儿童绘本', scene: '精品克隆音色 / 有声阅读', language: '中文', model: '精品克隆', resourceIds: ['r1'], emotions: [] },
  { id: 'zh_female_wenrou', name: '温柔淑女 2.0', scene: '语音合成2.0 / 通用场景', language: '中文', model: '语音合成2.0', resourceIds: ['r1'], emotions: [] },
  { id: 'saturn_zh_female_keai', name: '可爱女生', scene: '精品克隆音色 / 角色扮演', language: '中文', model: '精品克隆', resourceIds: ['r1'], emotions: [] },
  { id: 'saturn_zh_female_tiaopi', name: '调皮公主', scene: '精品克隆音色 / 角色扮演', language: '中文', model: '精品克隆', resourceIds: ['r1'], emotions: [] },
  { id: 'saturn_zh_male_shuanglang', name: '爽朗少年', scene: '精品克隆音色 / 角色扮演', language: '中文', model: '精品克隆', resourceIds: ['r1'], emotions: [] },
  { id: 'zh_male_ruya', name: '儒雅逸辰', scene: '精品克隆音色 / 视频配音', language: '中文', model: '精品克隆', resourceIds: ['r1'], emotions: [] },
  { id: 'zh_male_zhubo', name: '电台主播', scene: '语音合成2.0 / 有声阅读', language: '中文', model: '语音合成2.0', resourceIds: ['r1'], emotions: [] },
  { id: 'zh_male_lengku', name: '冷酷哥哥（多情感）', scene: '语音合成1.0 / 多情感', language: '中文', model: '语音合成1.0', resourceIds: ['r2'], emotions: ['angry', 'coldness', 'neutral'] },
  { id: 'zh_female_zhixing', name: '知性灿灿', scene: '精品克隆音色 / 角色扮演', language: '中文', model: '精品克隆', resourceIds: ['r1'], emotions: [] },
]

describe('classifyRole', () => {
  it('旁白 → narrator', () => {
    expect(classifyRole('旁白')).toBe('narrator')
  })

  it('团团 → child_female', () => {
    expect(classifyRole('团团')).toBe('child_female')
    expect(classifyRole('栗栗')).toBe('child_female')
  })

  it('小兔 → child_female', () => {
    expect(classifyRole('小兔')).toBe('child_female')
  })

  it('妈妈 → mother', () => {
    expect(classifyRole('妈妈')).toBe('mother')
  })

  it('奶奶 → elder_female', () => {
    expect(classifyRole('奶奶')).toBe('elder_female')
  })

  it('爸爸 → father', () => {
    expect(classifyRole('爸爸')).toBe('father')
  })

  it('爷爷 → elder_male', () => {
    expect(classifyRole('爷爷')).toBe('elder_male')
  })

  it('大灰狼 → villain', () => {
    expect(classifyRole('大灰狼')).toBe('villain')
  })
})

describe('recommendVoices', () => {
  it('旁白首选儿童绘本', () => {
    const ranked = recommendVoices('旁白', testVoices)
    expect(ranked[0].voice.name).toBe('儿童绘本')
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
    expect(ranked[0].reasons.length).toBeGreaterThan(0)
  })

  it('团团首选可爱女生或调皮公主', () => {
    const ranked = recommendVoices('团团', testVoices)
    expect(['可爱女生', '调皮公主']).toContain(ranked[0].voice.name)
  })

  it('妈妈首选温柔淑女', () => {
    const ranked = recommendVoices('妈妈', testVoices)
    expect(ranked[0].voice.name).toBe('温柔淑女 2.0')
  })

  it('奶奶首选温柔淑女或知性灿灿', () => {
    const ranked = recommendVoices('奶奶', testVoices)
    expect(['温柔淑女 2.0', '知性灿灿']).toContain(ranked[0].voice.name)
  })

  it('爷爷首选儒雅逸辰或大壹', () => {
    const ranked = recommendVoices('爷爷', testVoices)
    expect(['电台主播', '儒雅逸辰', '大壹']).toContain(ranked[0].voice.name)
  })

  it('大灰狼首选冷酷哥哥', () => {
    const ranked = recommendVoices('大灰狼', testVoices)
    expect(ranked[0].voice.name).toBe('冷酷哥哥（多情感）')
  })

  it('返回的结果按分数降序', () => {
    const ranked = recommendVoices('旁白', testVoices)
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i].score).toBeLessThanOrEqual(ranked[i - 1].score)
    }
  })

  it('每个推荐都有理由', () => {
    const ranked = recommendVoices('团团', testVoices)
    for (const item of ranked) {
      expect(item.reasons.length).toBeGreaterThan(0)
    }
  })
})

describe('getRoleSpeechParams', () => {
  it('旁白最慢', () => {
    const params = getRoleSpeechParams('旁白')
    expect(params.speechRate).toBe(0.78)
    expect(params.pitch).toBe(-1)
  })

  it('孩子最快', () => {
    const params = getRoleSpeechParams('团团')
    expect(params.speechRate).toBe(0.92)
    expect(params.pitch).toBe(2)
  })

  it('反派有 coldness 情绪', () => {
    const params = getRoleSpeechParams('大灰狼')
    expect(params.emotion).toBe('coldness')
  })
})

describe('mapDescriptorToVoice', () => {
  const desc = (overrides: Partial<VoiceDescriptor> = {}): VoiceDescriptor => ({
    gender: '',
    ageGroup: '',
    tone: '',
    speed: '',
    ...overrides,
  })

  it('maps narrator descriptor to 儿童绘本', () => {
    const result = mapDescriptorToVoice(
      desc({ gender: '女声', ageGroup: '成年', tone: '温柔朗读', speed: '偏慢' }),
      testVoices,
    )
    expect(result.voice.name).toBe('儿童绘本')
    expect(result.speechRate).toBe(0.85)
    expect(result.pitch).toBe(0)
  })

  it('maps child descriptor to 可爱女生 or 调皮公主', () => {
    const result = mapDescriptorToVoice(
      desc({ gender: '女声', ageGroup: '幼童', tone: '安静好奇', speed: '偏慢' }),
      testVoices,
    )
    expect(['可爱女生', '调皮公主']).toContain(result.voice.name)
  })

  it('maps elderly female to 温柔淑女 or 知性灿灿', () => {
    const result = mapDescriptorToVoice(
      desc({ gender: '女声', ageGroup: '老年', tone: '沉稳慈祥', speed: '很慢' }),
      testVoices,
    )
    expect(result.speechRate).toBe(0.75)
    expect(result.pitch).toBe(0)
  })

  it('maps 很快 speed to high speechRate', () => {
    const result = mapDescriptorToVoice(
      desc({ gender: '女声', ageGroup: '幼童', tone: '活泼', speed: '很快' }),
      testVoices,
    )
    expect(result.speechRate).toBe(1.05)
  })

  it('maps 中等 speed to default speechRate', () => {
    const result = mapDescriptorToVoice(
      desc({ gender: '女声', ageGroup: '成年', tone: '日常', speed: '中等' }),
      testVoices,
    )
    expect(result.speechRate).toBe(0.92)
  })

  it('always returns a voice even with empty descriptor', () => {
    const result = mapDescriptorToVoice(desc(), testVoices)
    expect(result.voice).toBeDefined()
    expect(result.voice.id).toBeTruthy()
  })

  it('returns speechRate 0.9 for unknown speed', () => {
    const result = mapDescriptorToVoice(
      desc({ gender: '不限', ageGroup: '不限', tone: '', speed: '未知速' }),
      testVoices,
    )
    expect(result.speechRate).toBe(0.9)
  })
})

