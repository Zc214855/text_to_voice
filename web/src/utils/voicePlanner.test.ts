import { describe, expect, it } from 'vitest'
import { recommendUnifiedVoices } from './voicePlanner'
import type { EdgeVoice, PopularVoice } from '../composables/types'
import type { VoiceDescriptor } from './roleScript'

const volcVoices: PopularVoice[] = [
  { id: 'zh_female_xiaoxue_uranus_bigtts', name: '儿童绘本 2.0', scene: '语音合成2.0 / 有声阅读', language: '中文', model: '语音合成2.0', resourceIds: ['seed-tts-2.0'], emotions: [] },
  { id: 'zh_female_wenroumama_uranus_bigtts', name: '温柔妈妈 2.0', scene: '语音合成2.0 / 通用', language: '中文', model: '语音合成2.0', resourceIds: ['seed-tts-2.0'], emotions: [] },
  { id: 'zh_male_yizhipiannan_uranus_bigtts', name: '译制片男声 2.0', scene: '语音合成2.0 / 通用', language: '中文', model: '语音合成2.0', resourceIds: ['seed-tts-2.0'], emotions: [] },
]

const edgeVoices: EdgeVoice[] = [
  { id: 'zh-CN-XiaomengNeural', name: '晓梦（甜美）', locale: 'zh-CN', gender: 'Female' },
  { id: 'zh-CN-XiaoshuangNeural', name: '晓双（儿童）', locale: 'zh-CN', gender: 'Female' },
  { id: 'zh-CN-YunzeNeural', name: '云泽（稳重）', locale: 'zh-CN', gender: 'Male' },
]

const desc = (overrides: Partial<VoiceDescriptor>): VoiceDescriptor => ({
  gender: '',
  ageGroup: '',
  tone: '',
  speed: '',
  ...overrides,
})

describe('recommendUnifiedVoices', () => {
  it('returns both Volc and Edge candidates in one ranked list', () => {
    const candidates = recommendUnifiedVoices({
      role: '旁白',
      descriptor: desc({ gender: '女声', ageGroup: '成年', tone: '温柔朗读', speed: '偏慢' }),
      volcVoices,
      edgeVoices,
    })

    expect(candidates.some((candidate) => candidate.engine === 'volc')).toBe(true)
    expect(candidates.some((candidate) => candidate.engine === 'edge')).toBe(true)
    expect(candidates[0].speechRate).toBeLessThan(1)
  })

  it('pushes child voices up for child roles', () => {
    const candidates = recommendUnifiedVoices({
      role: '团团',
      descriptor: desc({ gender: '不限', ageGroup: '幼童', tone: '安静好奇', speed: '偏慢' }),
      volcVoices,
      edgeVoices,
    })

    const topNames = candidates.slice(0, 3).map((candidate) => candidate.voiceName)
    expect(topNames.some((name) => /儿童|晓双/.test(name))).toBe(true)
  })
})
