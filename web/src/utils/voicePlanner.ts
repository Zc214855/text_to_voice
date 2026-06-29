import type { EdgeVoice, PopularVoice, TTSEngine } from '../composables/types'
import type { VoiceDescriptor } from './roleScript'
import {
  classifyRole,
  descriptorToSpeechParams,
  getRoleSpeechParams,
  recommendVoices,
  recommendVoicesByDescriptor,
} from './voiceRecommender'

export type CandidateEngine = Extract<TTSEngine, 'volc' | 'edge'>

export interface UnifiedVoiceCandidate {
  key: string
  engine: CandidateEngine
  voice: string
  voiceName: string
  resourceId: string
  detail: string
  score: number
  reasons: string[]
  speechRate: number
  pitch: number
  loudness: number
  emotion: string
  emotionScale: number
  explicitLanguage: string
}

function speedToRate(speed: string): number {
  const map: Record<string, number> = {
    很慢: 0.75,
    慢: 0.8,
    偏慢: 0.85,
    中等: 0.92,
    偏快: 0.98,
    很快: 1.05,
    快: 1.05,
  }
  return map[speed] ?? 0.9
}

function edgePitchFromTone(tone: string): number {
  if (/活泼|俏皮|调皮|明亮|欢快|兴奋/.test(tone)) return 10
  if (/低沉|沉稳|慈祥|稳重|威严/.test(tone)) return -8
  return 0
}

function edgeBaseParams(role: string, descriptor?: VoiceDescriptor) {
  if (descriptor) {
    return {
      speechRate: speedToRate(descriptor.speed),
      pitch: edgePitchFromTone(descriptor.tone),
      loudness: 1,
    }
  }

  const params = getRoleSpeechParams(role)
  return {
    speechRate: params.speechRate,
    pitch: Math.round(params.pitch * 6),
    loudness: params.loudness,
  }
}

function expectedGender(role: string, descriptor?: VoiceDescriptor): 'Female' | 'Male' | 'Any' {
  if (descriptor?.gender.includes('女')) return 'Female'
  if (descriptor?.gender.includes('男')) return 'Male'
  if (descriptor?.gender === '不限') return 'Any'

  const roleType = classifyRole(role)
  if (roleType === 'father' || roleType === 'elder_male' || roleType === 'child_male') return 'Male'
  if (roleType !== 'default' && roleType !== 'villain') return 'Female'
  return 'Any'
}

function expectedAge(role: string, descriptor?: VoiceDescriptor): 'child' | 'adult' | 'elder' | 'any' {
  if (descriptor?.ageGroup === '幼童' || descriptor?.ageGroup === '少年') return 'child'
  if (descriptor?.ageGroup === '成年') return 'adult'
  if (descriptor?.ageGroup === '老年') return 'elder'

  const roleType = classifyRole(role)
  if (roleType === 'child_female' || roleType === 'child_male') return 'child'
  if (roleType === 'elder_female' || roleType === 'elder_male') return 'elder'
  if (roleType === 'narrator' || roleType === 'mother' || roleType === 'father') return 'adult'
  return 'any'
}

function scoreEdgeVoice(role: string, voice: EdgeVoice, descriptor?: VoiceDescriptor) {
  let score = 18
  const reasons: string[] = ['本地可用']
  const gender = expectedGender(role, descriptor)
  const age = expectedAge(role, descriptor)
  const tone = descriptor?.tone || ''
  const roleType = classifyRole(role)

  if (voice.locale === 'zh-CN') {
    score += 12
    reasons.push('普通话')
  } else {
    score -= 12
  }

  if (gender !== 'Any') {
    if (voice.gender === gender) {
      score += 18
      reasons.push('性别匹配')
    } else {
      score -= 18
    }
  }

  const name = voice.name
  if (age === 'child') {
    if (/晓双|云夏/.test(name)) {
      score += 34
      reasons.push('儿童感')
    } else if (/云希|晓梦/.test(name)) {
      score += 12
      reasons.push('年轻明亮')
    }
  }
  if (age === 'elder') {
    if (/晓秋|晓墨|云泽|云健/.test(name)) {
      score += 30
      reasons.push('沉稳')
    }
  }
  if (age === 'adult') {
    if (/晓梦|晓晓|晓萱|晓涵|云泽|云健/.test(name)) {
      score += 18
      reasons.push('成人叙述')
    }
  }

  if (roleType === 'narrator' && /晓梦|晓晓|晓涵/.test(name)) {
    score += 30
    reasons.push('睡前旁白')
  }
  if (roleType === 'mother' && /晓萱|晓梦|晓晓/.test(name)) {
    score += 20
    reasons.push('温柔家人')
  }
  if (roleType === 'elder_male' && /云泽|云健/.test(name)) {
    score += 20
    reasons.push('长辈男声')
  }
  if (roleType === 'elder_female' && /晓秋|晓墨/.test(name)) {
    score += 20
    reasons.push('长辈女声')
  }

  if (/温柔|安静|朗读/.test(tone) && /晓梦|晓晓|晓涵/.test(name)) {
    score += 18
    reasons.push('语气匹配')
  }
  if (/活泼|俏皮|好奇/.test(tone) && /晓双|云夏|云希/.test(name)) {
    score += 18
    reasons.push('语气匹配')
  }
  if (/沉稳|慈祥/.test(tone) && /晓秋|云泽|云健|晓墨/.test(name)) {
    score += 18
    reasons.push('语气匹配')
  }

  return { score, reasons: [...new Set(reasons)] }
}

function toVolcCandidate(role: string, voice: PopularVoice, score: number, reasons: string[], descriptor?: VoiceDescriptor): UnifiedVoiceCandidate {
  const params = descriptor ? descriptorToSpeechParams(descriptor, voice) : getRoleSpeechParams(role)
  const detail = voice.scene.includes(voice.model) ? voice.scene : `${voice.model} / ${voice.scene}`
  return {
    key: `volc:${voice.id}`,
    engine: 'volc',
    voice: voice.id,
    voiceName: voice.name,
    resourceId: voice.resourceIds[0] || '',
    detail,
    score: score + 28,
    reasons: [...new Set(['云端质感', ...reasons])],
    speechRate: params.speechRate,
    pitch: params.pitch,
    loudness: params.loudness,
    emotion: params.emotion,
    emotionScale: params.emotionScale,
    explicitLanguage: 'zh-cn',
  }
}

function toEdgeCandidate(role: string, voice: EdgeVoice, descriptor?: VoiceDescriptor): UnifiedVoiceCandidate {
  const scored = scoreEdgeVoice(role, voice, descriptor)
  const params = edgeBaseParams(role, descriptor)
  return {
    key: `edge:${voice.id}`,
    engine: 'edge',
    voice: voice.id,
    voiceName: voice.name,
    resourceId: '',
    detail: `Edge Neural / ${voice.locale} / ${voice.gender}`,
    score: scored.score,
    reasons: scored.reasons,
    speechRate: params.speechRate,
    pitch: params.pitch,
    loudness: params.loudness,
    emotion: '',
    emotionScale: 4,
    explicitLanguage: 'zh-cn',
  }
}

export function recommendUnifiedVoices(params: {
  role: string
  descriptor?: VoiceDescriptor
  volcVoices: PopularVoice[]
  edgeVoices: EdgeVoice[]
}): UnifiedVoiceCandidate[] {
  const { role, descriptor, volcVoices, edgeVoices } = params
  const volcRanked = descriptor
    ? recommendVoicesByDescriptor(descriptor, volcVoices)
    : recommendVoices(role, volcVoices)

  const volcCandidates = volcRanked.map((item) => toVolcCandidate(role, item.voice, item.score, item.reasons, descriptor))
  const edgeCandidates = edgeVoices.map((voice) => toEdgeCandidate(role, voice, descriptor))

  return [...volcCandidates, ...edgeCandidates]
    .sort((a, b) => b.score - a.score)
}
