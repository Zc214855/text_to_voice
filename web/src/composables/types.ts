export interface TTSConfig {
  apiKey?: string
  appId?: string
  accessToken?: string
  resourceId?: string
  cluster?: string
  endpoint?: string
}

export interface PopularVoice {
  id: string
  name: string
  scene: string
  language: string
  model: '2.0' | '1.0' | 'clone'
}

export interface TTSControls {
  speechRate: number
  pitch: number
  loudness: number
  emotion: string
  emotionScale: number
}

export interface SynthesizeParams extends TTSControls {
  text: string
  voice: string
  voiceName: string
}

export interface HistoryItem {
  id: string
  text: string
  voice: string
  voiceName: string
  audioUrl: string
  byteLength: number
  requestId: string
  createdAt: Date
  controls: TTSControls
}

export interface UsageInfo {
  text_words?: number
}
