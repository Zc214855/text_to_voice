export type TTSEngine = 'volc' | 'edge' | 'mixed'

export interface TTSConfig {
  apiKey?: string
  appId?: string
  accessToken?: string
  resourceId?: string
  resourceIds?: string[]
  endpoint?: string
  /** 用户自复刻的音色列表（声音复刻 2.0） */
  cloneVoices?: CloneVoice[]
}

/** 用户自复刻的音色（对应火山引擎声音复刻 2.0 / seed-icl-2.0） */
export interface CloneVoice {
  /** 控制台训练后得到的音色 ID，例如 S_xxxxxxxxxxxxxxxx */
  id: string
  /** 音色显示名称，例如「我的声音」 */
  name: string
  /** 备注说明，例如录制人、适用场景（可选） */
  description?: string
}

export interface PopularVoice {
  id: string
  name: string
  scene: string
  language: string
  model: string
  resourceIds: string[]
  emotions: string[]
}

export interface EdgeVoice {
  id: string
  name: string
  locale: string
  gender: string
}

export interface TTSControls {
  speechRate: number
  pitch: number
  loudness: number
  emotion: string
  emotionScale: number
  explicitLanguage: string
}

export interface EdgeTTSControls {
  rate: number
  pitch: number
  volume: number
  storyMode?: boolean
}

export interface RoleStoryVoiceControls extends TTSControls {
  role: string
  engine?: TTSEngine
  voice: string
  voiceName: string
  resourceId: string
}

export interface RoleStoryControls {
  mode: 'role-story'
  roles: RoleStoryVoiceControls[]
  segmentCount: number
  characterCount: number
}

export interface RoleStorySegmentInput {
  role: string
  text: string
  characterCount: number
}

export interface VolcSynthesizeParams extends TTSControls {
  engine: 'volc'
  text: string
  voice: string
  voiceName: string
  resourceId: string
}

export interface RoleStorySynthesizeParams {
  engine: 'volc'
  name: string
  text: string
  segments: RoleStorySegmentInput[]
  roleControls: RoleStoryVoiceControls[]
}

export interface HistoryItem {
  id: string
  engine: TTSEngine
  name: string
  text: string
  voice: string
  voiceName: string
  /** 后端 output 目录下的文件名 */
  fileName: string
  byteLength: number
  duration?: number
  requestId?: string
  createdAt: string
  controls: TTSControls | EdgeTTSControls | RoleStoryControls
}

export interface UsageInfo {
  text_words?: number
}
