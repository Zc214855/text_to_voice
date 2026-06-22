export type TTSEngine = 'volc' | 'edge'

export interface TTSConfig {
  apiKey?: string
  appId?: string
  accessToken?: string
  resourceId?: string
  resourceIds?: string[]
  endpoint?: string
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
}

export interface VolcSynthesizeParams extends TTSControls {
  engine: 'volc'
  text: string
  voice: string
  voiceName: string
  resourceId: string
}

export interface EdgeSynthesizeParams extends EdgeTTSControls {
  engine: 'edge'
  text: string
  voice: string
  voiceName: string
}

export type SynthesizeParams = VolcSynthesizeParams | EdgeSynthesizeParams

export interface HistoryItem {
  id: string
  engine: TTSEngine
  name: string
  text: string
  voice: string
  voiceName: string
  audioUrl: string
  byteLength: number
  requestId: string
  createdAt: Date
  controls: TTSControls | EdgeTTSControls
}

export interface UsageInfo {
  text_words?: number
}
