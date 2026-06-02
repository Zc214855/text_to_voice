export type TTSEngine = 'volc' | 'edge' | 'voicebox'

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

export interface VoiceboxProfile {
  id: string
  name: string
  engine?: string
  language?: string
  default_engine?: string
  preset_engine?: string
  preset_voice_id?: string
  voice_type?: string
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

export interface VoiceboxControls {
  profileId: string
  language: string
  engine: string
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

export interface VoiceboxSynthesizeParams extends VoiceboxControls {
  engine: 'voicebox'
  text: string
  voice: string
  voiceName: string
}

export type SynthesizeParams = VolcSynthesizeParams | EdgeSynthesizeParams | VoiceboxSynthesizeParams

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
  controls: TTSControls | EdgeTTSControls | VoiceboxControls
}

export interface UsageInfo {
  text_words?: number
}
