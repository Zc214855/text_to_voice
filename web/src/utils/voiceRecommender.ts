/**
 * 音色推荐引擎
 *
 * 根据角色名和角色类型，对所有可用音色打分排序，
 * 产出推荐列表 + 推荐理由，供 UI 展示和自动选择。
 */

import type { PopularVoice } from '../composables/types'
import type { VoiceDescriptor } from './roleScript'

// ============ 类型定义 ============

/** 角色期望特征 */
export interface VoiceProfile {
  /** 期望性别 */
  gender: 'female' | 'male' | 'any'
  /** 期望年龄段（用于关键词匹配） */
  ageGroup: 'child' | 'adult' | 'elder' | 'any'
  /** 期望语气 */
  tone: 'gentle' | 'bright' | 'cute' | 'mature' | 'cold' | 'any'
  /** 偏好的 scene 关键词 */
  scenePreference: string[]
  /** 偏好的音色名关键词（越靠前权重越高） */
  nameKeywords: string[]
}

export interface ScoredVoice {
  voice: PopularVoice
  score: number
  reasons: string[]
}

// ============ 角色识别 ============

export type RoleType =
  | 'narrator'      // 旁白
  | 'child_female'  // 女孩/女性小动物
  | 'child_male'    // 男孩/男性小动物
  | 'mother'        // 妈妈
  | 'elder_female'  // 奶奶/外婆
  | 'elder_male'    // 爷爷/外公
  | 'father'        // 爸爸
  | 'villain'       // 反派
  | 'default'       // 兜底

/** 根据角色名推断角色类型 */
export function classifyRole(role: string): RoleType {
  if (role === '旁白') return 'narrator'

  if (/狼|怪|魔|坏|反派|巫|妖/.test(role)) return 'villain'

  if (/奶奶|外婆/.test(role)) return 'elder_female'
  if (/爷爷|外公/.test(role)) return 'elder_male'
  if (/妈妈|母亲/.test(role)) return 'mother'
  if (/爸爸|父亲/.test(role)) return 'father'

  // 孩子角色：小 + 常见儿童角色名
  if (/小|兔|猫|狗|熊|鸟|鹿|鼠|松鼠|狐狸|孩子|宝宝|公主|团团|栗栗|豆豆/.test(role)) {
    // 推定性别：常见女性名 → child_female，否则根据角色名中的性别提示
    if (/公主|团团|栗栗|豆豆|小美|花花|云云/.test(role)) return 'child_female'
    if (/王子/.test(role)) return 'child_male'
    // 无法判断时默认 female（儿童故事女孩角色更常见）
    return 'child_female'
  }

  // 成年女性
  if (/阿姨|姐姐|老师/.test(role)) return 'mother'

  // 成年男性
  if (/叔叔|哥哥|弟弟|男孩/.test(role)) return 'father'

  return 'default'
}

// ============ 角色期望特征映射 ============

const ROLE_PROFILES: Record<RoleType, VoiceProfile> = {
  narrator: {
    gender: 'female',
    ageGroup: 'adult',
    tone: 'gentle',
    scenePreference: ['有声阅读', '通用场景'],
    nameKeywords: ['儿童绘本', '温柔淑女', '流畅女声', '知性灿灿', '电台主播'],
  },
  child_female: {
    gender: 'female',
    ageGroup: 'child',
    tone: 'cute',
    scenePreference: ['角色扮演', '通用场景'],
    nameKeywords: ['可爱女生', '调皮公主', '甜心小美', '爽朗少年', '开朗佳欣'],
  },
  child_male: {
    gender: 'male',
    ageGroup: 'child',
    tone: 'bright',
    scenePreference: ['角色扮演', '通用场景'],
    nameKeywords: ['爽朗少年', '天才同桌', '小天', '云舟'],
  },
  mother: {
    gender: 'female',
    ageGroup: 'adult',
    tone: 'gentle',
    scenePreference: ['通用场景', '视频配音'],
    nameKeywords: ['温柔淑女', '知性灿灿', '流畅女声', '开朗佳欣', '古风少御'],
  },
  elder_female: {
    gender: 'female',
    ageGroup: 'elder',
    tone: 'gentle',
    scenePreference: ['通用场景', '角色扮演'],
    nameKeywords: ['温柔淑女', '知性灿灿', '邻居阿姨', '儿童绘本'],
  },
  elder_male: {
    gender: 'male',
    ageGroup: 'elder',
    tone: 'mature',
    scenePreference: ['通用场景', '有声阅读'],
    nameKeywords: ['儒雅逸辰', '大壹', '云舟'],
  },
  father: {
    gender: 'male',
    ageGroup: 'adult',
    tone: 'gentle',
    scenePreference: ['通用场景', '有声阅读'],
    nameKeywords: ['儒雅逸辰', '大壹', '云舟', '阳光青年'],
  },
  villain: {
    gender: 'any',
    ageGroup: 'any',
    tone: 'cold',
    scenePreference: ['多情感', '角色扮演'],
    nameKeywords: ['冷酷哥哥', '高冷御姐', '爽快思思'],
  },
  default: {
    gender: 'any',
    ageGroup: 'any',
    tone: 'any',
    scenePreference: [],
    nameKeywords: ['儿童绘本', '温柔淑女', '流畅女声'],
  },
}

// ============ 音色性别推断 ============

/** 根据音色 ID 和名称推断性别 */
function inferVoiceGender(voice: PopularVoice): 'female' | 'male' | 'unknown' {
  // 火山引擎音色 ID 中包含 gender 标识
  if (voice.id.includes('_female_')) return 'female'
  if (voice.id.includes('_male_')) return 'male'

  // 名称关键词
  const femaleKeys = ['女', '姐', '妹', '妈', '婆', '姨', '公主', '妮', '灿', '欣', '思']
  const maleKeys = ['男', '哥', '弟', '爸', '爷', '叔', '公子', '少年', '同桌', '主播', '辰']

  for (const key of femaleKeys) {
    if (voice.name.includes(key)) return 'female'
  }
  for (const key of maleKeys) {
    if (voice.name.includes(key)) return 'male'
  }

  return 'unknown'
}

// ============ 评分引擎 ============

/** 场景匹配得分 */
function scoreScene(voice: PopularVoice, profile: VoiceProfile): { score: number; reasons: string[] } {
  const reasons: string[] = []

  for (let i = 0; i < profile.scenePreference.length; i += 1) {
    const scene = profile.scenePreference[i]
    if (voice.scene.includes(scene)) {
      // 越靠前的偏好，得分越高
      const score = 30 - i * 8
      reasons.push(`${scene}`)
      return { score: Math.max(score, 10), reasons }
    }
  }

  return { score: 0, reasons }
}

/** 名称关键词匹配得分 */
function scoreNameKeywords(voice: PopularVoice, profile: VoiceProfile): { score: number; reasons: string[] } {
  const reasons: string[] = []

  for (let i = 0; i < profile.nameKeywords.length; i += 1) {
    if (voice.name === profile.nameKeywords[i]) {
      const rank = i + 1
      if (rank === 1) return { score: 30, reasons: ['首选推荐'] }
      if (rank <= 3) return { score: 20, reasons: ['优选推荐'] }
      return { score: 10, reasons: ['备选推荐'] }
    }
    // 部分匹配（如 "温柔淑女 2.0" 匹配关键词 "温柔淑女"）
    if (voice.name.includes(profile.nameKeywords[i]) || profile.nameKeywords[i].includes(voice.name)) {
      const rank = i + 1
      if (rank <= 2) return { score: 15, reasons: ['名称匹配'] }
      return { score: 8, reasons: ['部分匹配'] }
    }
  }

  return { score: 0, reasons }
}

/** 模型质量得分 */
function scoreModel(voice: PopularVoice, tone: VoiceProfile['tone']): { score: number; reasons: string[] } {
  // 精品克隆音质最高
  if (voice.model === '精品克隆') return { score: 20, reasons: ['精品音质'] }
  // 2.0 模型也不错
  if (voice.model === '语音合成2.0') return { score: 12, reasons: ['2.0模型'] }
  // 1.0 多情感模型在某些场景有用
  if (tone === 'cold' && voice.emotions.length > 0) {
    return { score: 10, reasons: ['多情感支持'] }
  }
  if (voice.emotions.length > 0) return { score: 8, reasons: ['支持情感'] }
  // 基础1.0
  return { score: 3, reasons: ['基础模型'] }
}

/** 性别匹配得分 */
function scoreGender(voice: PopularVoice, profile: VoiceProfile): { score: number; reasons: string[] } {
  const inferred = inferVoiceGender(voice)
  if (profile.gender === 'any' || inferred === 'unknown') return { score: 0, reasons: [] }
  if (profile.gender === inferred) return { score: 15, reasons: ['性别匹配'] }
  // 性别不匹配扣分
  return { score: -10, reasons: [] }
}

/** 语气/年龄关键词匹配 */
function scoreTone(voice: PopularVoice, profile: VoiceProfile): { score: number; reasons: string[] } {
  const reasons: string[] = []
  const name = voice.name

  const toneMap: Record<string, string[]> = {
    gentle: ['温柔', '淑女', '知性', '柔和', '流畅', '绘本', '主播'],
    bright: ['爽朗', '开朗', '阳光', '轻快'],
    cute: ['可爱', '调皮', '甜心', '小美', '公主'],
    mature: ['知性', '儒雅', '逸辰', '大壹', '灿灿', '主播', '阿姨'],
    cold: ['冷酷', '高冷', '爽快'],
  }

  const keywords = toneMap[profile.tone] || []
  for (const kw of keywords) {
    if (name.includes(kw)) {
      reasons.push(`语气匹配`)
      return { score: 10, reasons }
    }
  }

  // 年龄段匹配（辅助）
  const ageMap: Record<string, string[]> = {
    child: ['儿童', '可爱', '调皮', '少年', '同桌', '天才', '公主', '小', '甜心'],
    elder: ['阿姨', '灿灿', '知性', '儒雅', '主播'],
    adult: ['淑女', '知性', '儒雅', '逸辰', '柔和', '开朗', '流畅'],
  }
  const ageKw = ageMap[profile.ageGroup] || []
  for (const kw of ageKw) {
    if (name.includes(kw)) {
      reasons.push(`年龄匹配`)
      return { score: 5, reasons }
    }
  }

  return { score: 0, reasons }
}

// ============ 主入口 ============

/** 为指定角色对全部音色打分排序，返回推荐列表 */
export function recommendVoices(role: string, voices: PopularVoice[]): ScoredVoice[] {
  if (voices.length === 0) return []
  const roleType = classifyRole(role)
  const profile = ROLE_PROFILES[roleType]

  function scoreOne(voice: PopularVoice): ScoredVoice {
    const reasons: string[] = []
    let total = 0

    const sceneResult = scoreScene(voice, profile)
    total += sceneResult.score
    reasons.push(...sceneResult.reasons)

    const nameResult = scoreNameKeywords(voice, profile)
    total += nameResult.score
    reasons.push(...nameResult.reasons)

    const modelResult = scoreModel(voice, profile.tone)
    total += modelResult.score
    reasons.push(...modelResult.reasons)

    const genderResult = scoreGender(voice, profile)
    total += genderResult.score
    if (genderResult.score < 0) reasons.push('性别不匹配')

    const toneResult = scoreTone(voice, profile)
    total += toneResult.score
    reasons.push(...toneResult.reasons)

    // 去重并过滤空字符串
    const uniqueReasons = [...new Set(reasons)].filter(Boolean)

    return { voice, score: total, reasons: uniqueReasons }
  }

  return voices
    .map(scoreOne)
    .sort((a, b) => b.score - a.score)
}

/** 获取推荐的语音控制参数（speechRate, pitch 等） */
export function getRoleSpeechParams(role: string): {
  speechRate: number
  pitch: number
  loudness: number
  emotion: string
  emotionScale: number
} {
  const roleType = classifyRole(role)

  const params: Record<RoleType, { speechRate: number; pitch: number; loudness: number; emotion: string; emotionScale: number }> = {
    narrator:     { speechRate: 0.78, pitch: -1, loudness: 0.95, emotion: '', emotionScale: 4 },
    child_female: { speechRate: 0.92, pitch: 2,  loudness: 1,    emotion: '', emotionScale: 4 },
    child_male:   { speechRate: 0.92, pitch: 0,  loudness: 1,    emotion: '', emotionScale: 4 },
    mother:       { speechRate: 0.88, pitch: -1, loudness: 1,    emotion: '', emotionScale: 4 },
    elder_female: { speechRate: 0.85, pitch: -1, loudness: 0.95, emotion: '', emotionScale: 4 },
    elder_male:   { speechRate: 0.85, pitch: -2, loudness: 0.95, emotion: '', emotionScale: 4 },
    father:       { speechRate: 0.9,  pitch: -1, loudness: 1,    emotion: '', emotionScale: 4 },
    villain:      { speechRate: 0.95, pitch: -1, loudness: 1,    emotion: 'coldness', emotionScale: 2 },
    default:      { speechRate: 0.9,  pitch: 0,  loudness: 1,    emotion: '', emotionScale: 4 },
  }

  const result = params[roleType] || params.default

  return result
}

// ============ 特征描述 → 音色映射 ============

/** 从 speed 文本映射到 speechRate 数值 */
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

/** 从 tone 文本推断推荐的 pitch 偏移 */
function toneToPitch(tone: string): number {
  if (/活泼|俏皮|调皮|明亮|欢快|兴奋/.test(tone)) return 2
  if (/温柔|沉稳|安静|柔和|慈祥|好奇/.test(tone)) return 0
  if (/低沉|冷静|威严/.test(tone)) return -1
  return 0
}

/** 从 tone 文本推断是否启用情绪 */
function toneToEmotion(tone: string, voice: PopularVoice): { emotion: string; emotionScale: number } {
  if (/活泼|欢快|兴奋/.test(tone) && voice.emotions.includes('happy')) return { emotion: 'happy', emotionScale: 2 }
  if (/冷静|威严/.test(tone) && voice.emotions.includes('coldness')) return { emotion: 'coldness', emotionScale: 2 }
  return { emotion: '', emotionScale: 4 }
}

/** 将角色描述映射为可直接传给火山 TTS 的控制参数。 */
export function descriptorToSpeechParams(descriptor: VoiceDescriptor, voice: PopularVoice) {
  const emotion = toneToEmotion(descriptor.tone, voice)
  return {
    speechRate: speedToRate(descriptor.speed),
    pitch: toneToPitch(descriptor.tone),
    loudness: 1,
    emotion: emotion.emotion,
    emotionScale: emotion.emotionScale,
  }
}

/** 按角色描述对火山音色完整排序，供跨引擎推荐器展示所有候选。 */
export function recommendVoicesByDescriptor(descriptor: VoiceDescriptor, voices: PopularVoice[]): ScoredVoice[] {
  if (voices.length === 0) return []

  const scores = voices.map((voice) => {
    const reasons: string[] = []
    let score = 0

    // 性别匹配
    if (descriptor.gender) {
      if (descriptor.gender.includes('女') && voice.id.includes('_female_')) {
        score += 30
        reasons.push('性别匹配')
      } else if (descriptor.gender.includes('男') && voice.id.includes('_male_')) {
        score += 30
        reasons.push('性别匹配')
      } else if (descriptor.gender === '不限') {
        score += 15
        reasons.push('性别不限')
      } else {
        score -= 8
      }
    }

    // 年龄段匹配
    if (descriptor.ageGroup) {
      const ageKeyMap: Record<string, string[]> = {
        幼童: ['儿童', '绘本', '可爱', '调皮', '甜心', '小', '萌娃', '公主', '少年', '同桌', '天才'],
        少年: ['少年', '爽朗', '调皮', '同桌', '天才', '小'],
        成年: ['淑女', '知性', '开朗', '儒雅', '流畅', '主播', '逸辰', '灿灿', '绘本', '妈妈'],
        老年: ['阿姨', '奶奶', '婆婆', '灿灿', '知性', '主播', '慈祥'],
      }
      const ageKeys = ageKeyMap[descriptor.ageGroup] || []
      for (const kw of ageKeys) {
        if (voice.name.includes(kw)) {
          score += 25
          reasons.push('年龄匹配')
          break
        }
      }
    }

    // 语气匹配：对描述词中的每个特征词分别匹配，累加得分。
    if (descriptor.tone) {
      const toneMap: Record<string, string[]> = {
        温柔: ['温柔', '淑女', '柔和', '流畅', '妈妈', '绘本'],
        活泼: ['调皮', '爽朗', '开朗', '甜心', '俏皮'],
        沉稳: ['知性', '儒雅', '逸辰', '主播', '大壹', '稳重'],
        朗读: ['绘本', '主播', '流畅'],
        可爱: ['可爱', '甜心', '公主', '萌娃'],
        冷静: ['冷酷', '高冷'],
        慈祥: ['阿姨', '奶奶', '婆婆', '灿灿', '知性', '绘本'],
        日常: ['温柔', '开朗', '流畅', '淑女', '妈妈'],
        好奇: ['可爱', '调皮', '小', '萌娃'],
        俏皮: ['调皮', '公主', '可爱', '俏皮'],
        安静: ['温柔', '绘本', '柔和', '晓梦'],
      }
      let toneScore = 0
      const toneParts = descriptor.tone.split(/[，,、\s]+/).filter(Boolean)
      for (const part of toneParts) {
        let matched = false
        for (const [toneKey, keywords] of Object.entries(toneMap)) {
          if (part === toneKey || toneKey.includes(part) || part.includes(toneKey)) {
            for (const kw of keywords) {
              if (voice.name.includes(kw)) {
                toneScore += 12
                matched = true
                break
              }
            }
            if (matched) break
          }
        }
        if (!matched && part.length >= 2 && voice.name.includes(part)) {
          toneScore += 6
        }
      }
      if (toneScore > 0) reasons.push('语气匹配')
      score += Math.min(toneScore, 30)
    }

    // 模型质量与睡前故事偏好
    if (voice.model === '精品克隆') {
      score += 15
      reasons.push('精品音质')
    } else if (voice.model === '语音合成2.0') {
      score += 12
      reasons.push('2.0模型')
    } else if (voice.emotions.length > 0) {
      score += 5
      reasons.push('支持情感')
    }

    if (descriptor.tone.includes('朗读') && voice.scene.includes('有声阅读')) {
      score += 12
      reasons.push('有声阅读')
    }
    if ((descriptor.ageGroup === '幼童' || descriptor.ageGroup === '少年') && voice.scene.includes('角色扮演')) {
      score += 10
      reasons.push('角色扮演')
    }

    return { voice, score, reasons: [...new Set(reasons)] }
  })

  return scores.sort((a, b) => b.score - a.score)
}

/**
 * 根据 LLM 产出的角色特征描述，从音色库中匹配最佳音色和参数。
 *
 * 输入示例：{ gender: "女声", ageGroup: "幼童", tone: "安静好奇", speed: "偏慢" }
 * 输出：{ voice: PopularVoice, speechRate: 0.85, pitch: 0, loudness: 1, ... }
 */
export function mapDescriptorToVoice(
  descriptor: VoiceDescriptor,
  voices: PopularVoice[],
): {
  voice: PopularVoice
  speechRate: number
  pitch: number
  loudness: number
  emotion: string
  emotionScale: number
} {
  if (voices.length === 0) {
    throw new Error('音色列表为空，无法匹配')
  }

  const best = recommendVoicesByDescriptor(descriptor, voices)[0]!
  const params = descriptorToSpeechParams(descriptor, best.voice)

  return {
    voice: best.voice,
    ...params,
  }
}
