import { readonly, ref } from 'vue'
import voices from '../data/voices.json'
import type { HistoryItem, PopularVoice, SynthesizeParams, TTSConfig, UsageInfo } from './types'

export const MAX_TEXT_LENGTH = 2000

export const EMOTION_LABELS: Record<string, string> = {
  affectionate: '深情',
  angry: '生气',
  asmr: '低语',
  chat: '对话 / 闲聊',
  coldness: '冷漠',
  comfort: '安慰鼓励',
  depressed: '沮丧',
  excited: '激动',
  fear: '恐惧',
  happy: '开心',
  hate: '厌恶',
  neutral: '中性',
  radio: '情感电台',
  sad: '悲伤',
  storytelling: '讲故事',
  surprised: '惊讶',
  tender: '温柔',
  warm: '温暖',
}

export const VOLC_VOICES = voices as PopularVoice[]

const DEFAULT_ENDPOINT = '/volc-api/api/v3/tts/unidirectional'

const history = ref<HistoryItem[]>([])
const errorMsg = ref('')
const statusText = ref('就绪')
const isGenerating = ref(false)
const isPlaying = ref(false)
const currentPlayingId = ref<string | null>(null)
const lastUsage = ref<UsageInfo | null>(null)

let audioInstance: HTMLAudioElement | null = null

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function createRequestId() {
  return crypto.randomUUID ? crypto.randomUUID() : `tts-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function loadConfig(): Promise<Required<Pick<TTSConfig, 'endpoint'>> & TTSConfig> {
  const response = await fetch(`/config.json?t=${Date.now()}`)
  if (!response.ok) {
    throw new Error('无法读取 public/config.json')
  }

  const config = await response.json() as TTSConfig
  const resourceId = config.resourceId || config.cluster
  const hasApiKeyAuth = Boolean(config.apiKey)
  const hasLegacyAuth = Boolean(config.appId && config.accessToken)

  if (!resourceId) {
    throw new Error('config.json 缺少 resourceId 或 cluster')
  }

  if (!hasApiKeyAuth && !hasLegacyAuth) {
    throw new Error('config.json 需要配置 apiKey，或同时配置 appId 与 accessToken')
  }

  return {
    ...config,
    resourceId,
    endpoint: config.endpoint || DEFAULT_ENDPOINT,
  }
}

function buildHeaders(config: TTSConfig, requestId: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Api-Resource-Id': config.resourceId || config.cluster || '',
    'X-Api-Request-Id': requestId,
    'X-Control-Require-Usage-Tokens-Return': 'text_words',
  }

  if (config.apiKey) {
    headers['X-Api-Key'] = config.apiKey
    return headers
  }

  headers['X-Api-App-Id'] = config.appId || ''
  headers['X-Api-Access-Key'] = config.accessToken || ''
  return headers
}

function buildPayload(params: SynthesizeParams) {
  const audioParams: Record<string, string | number> = {
    format: 'mp3',
    sample_rate: 24000,
    speech_rate: clamp(Math.round((params.speechRate - 1) * 100), -50, 100),
    loudness_rate: clamp(Math.round((params.loudness - 1) * 100), -50, 100),
  }

  if (params.emotion) {
    audioParams.emotion = params.emotion
    audioParams.emotion_scale = clamp(Math.round(params.emotionScale), 1, 5)
  }

  const reqParams: Record<string, unknown> = {
    text: params.text.trim(),
    speaker: params.voice,
    audio_params: audioParams,
  }

  if (params.pitch !== 0) {
    reqParams.additions = {
      post_process: {
        pitch: clamp(Math.round(params.pitch), -12, 12),
      },
    }
  }

  return {
    user: {
      uid: 'local_user',
    },
    req_params: reqParams,
  }
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], { type: mimeType })
}

function parseResponseObject(rawLine: string) {
  const line = rawLine.trim()
  if (!line) return null

  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    const parts = line.split(/(?<=})\s*(?={)/g)
    if (parts.length <= 1) {
      throw new Error(`无法解析接口返回片段：${line.slice(0, 120)}`)
    }
    return parts.map((part) => JSON.parse(part) as Record<string, unknown>)
  }
}

function normalizeErrorMessage(message: string) {
  if (message.includes('requested resource not granted')) {
    return '服务实例处于暂停或未授权状态，请在火山引擎控制台恢复实例或检查 Resource ID'
  }
  if (message.includes('speaker permission denied')) {
    return '当前 Resource ID 未授权该音色，请切换音色或检查实例权限'
  }
  if (message.includes('TTSExceededTextLimit')) {
    return `文本超过 ${MAX_TEXT_LENGTH} 字限制`
  }
  return message
}

async function collectAudioBase64(response: Response) {
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let buffer = ''
  let usage: UsageInfo | null = null
  let parsedChunks = 0

  const consumeObject = (payload: Record<string, unknown>) => {
    const header = payload.header as { code?: number; message?: string } | undefined
    if (header?.code && header.code !== 0 && header.code !== 20000000) {
      throw new Error(header.message || `接口错误：${header.code}`)
    }

    const code = typeof payload.code === 'number' ? payload.code : 0
    if (code !== 0 && code !== 20000000) {
      throw new Error(String(payload.message || `接口错误：${code}`))
    }

    if (typeof payload.data === 'string' && payload.data.length > 0) {
      chunks.push(payload.data)
      parsedChunks += 1
      statusText.value = `接收音频片段 ${parsedChunks}`
    }

    if (payload.usage && typeof payload.usage === 'object') {
      usage = payload.usage as UsageInfo
    }
  }

  const consumeLine = (line: string) => {
    const parsed = parseResponseObject(line)
    if (!parsed) return
    if (Array.isArray(parsed)) {
      parsed.forEach(consumeObject)
      return
    }
    consumeObject(parsed)
  }

  const consumeText = (text: string, final = false) => {
    buffer += text
    const lines = buffer.split(/\r?\n/)
    buffer = final ? '' : lines.pop() || ''
    lines.forEach(consumeLine)

    if (final && buffer.trim()) {
      consumeLine(buffer)
      buffer = ''
    }
  }

  if (!response.body) {
    consumeText(await response.text(), true)
    return { audioBase64: chunks.join(''), usage }
  }

  const reader = response.body.getReader()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    consumeText(decoder.decode(value, { stream: true }))
  }

  consumeText(decoder.decode(), true)
  return { audioBase64: chunks.join(''), usage }
}

export function useTTS() {
  async function synthesize(params: SynthesizeParams) {
    const text = params.text.trim()

    if (!text) {
      errorMsg.value = '请输入要合成的文本'
      return undefined
    }

    if (text.length > MAX_TEXT_LENGTH) {
      errorMsg.value = `文本不能超过 ${MAX_TEXT_LENGTH} 字`
      return undefined
    }

    isGenerating.value = true
    errorMsg.value = ''
    lastUsage.value = null
    statusText.value = '读取配置'

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 60_000)

    try {
      const requestId = createRequestId()
      const config = await loadConfig()
      const headers = buildHeaders(config, requestId)
      const payload = buildPayload({ ...params, text })

      statusText.value = '请求火山引擎'
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status}${body ? `：${body}` : ''}`)
      }

      const { audioBase64, usage } = await collectAudioBase64(response)

      if (!audioBase64) {
        throw new Error('接口未返回有效音频数据')
      }

      statusText.value = '生成音频文件'
      const blob = base64ToBlob(audioBase64, 'audio/mpeg')
      const audioUrl = URL.createObjectURL(blob)
      const item: HistoryItem = {
        id: requestId,
        text,
        voice: params.voice,
        voiceName: params.voiceName,
        audioUrl,
        byteLength: blob.size,
        requestId,
        createdAt: new Date(),
        controls: {
          speechRate: params.speechRate,
          pitch: params.pitch,
          loudness: params.loudness,
          emotion: params.emotion,
          emotionScale: params.emotionScale,
        },
      }

      history.value.unshift(item)
      lastUsage.value = usage
      statusText.value = '完成'

      while (history.value.length > 30) {
        const removed = history.value.pop()
        if (removed) URL.revokeObjectURL(removed.audioUrl)
      }

      return item
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        errorMsg.value = '请求超时'
      } else {
        errorMsg.value = normalizeErrorMessage(error instanceof Error ? error.message : '合成失败')
      }
      statusText.value = '失败'
      return undefined
    } finally {
      window.clearTimeout(timeoutId)
      isGenerating.value = false
    }
  }

  async function playAudio(item: HistoryItem | null) {
    if (!item) {
      stopAudio()
      return
    }

    if (currentPlayingId.value === item.id && isPlaying.value) {
      stopAudio()
      return
    }

    stopAudio()
    audioInstance = new Audio(item.audioUrl)
    audioInstance.onended = stopAudio
    audioInstance.onerror = () => {
      errorMsg.value = '音频播放失败'
      stopAudio()
    }

    try {
      await audioInstance.play()
      isPlaying.value = true
      currentPlayingId.value = item.id
    } catch {
      errorMsg.value = '浏览器阻止了音频播放'
      stopAudio()
    }
  }

  function stopAudio() {
    if (audioInstance) {
      audioInstance.pause()
      audioInstance.currentTime = 0
      audioInstance = null
    }
    isPlaying.value = false
    currentPlayingId.value = null
  }

  function downloadAudio(item: HistoryItem) {
    const anchor = document.createElement('a')
    anchor.href = item.audioUrl
    anchor.download = `${item.voiceName}_${item.createdAt.getTime()}.mp3`
    anchor.click()
  }

  function removeHistoryItem(id: string) {
    const index = history.value.findIndex((item) => item.id === id)
    if (index < 0) return

    URL.revokeObjectURL(history.value[index].audioUrl)
    history.value.splice(index, 1)
    if (currentPlayingId.value === id) stopAudio()
  }

  function clearHistory() {
    stopAudio()
    history.value.forEach((item) => URL.revokeObjectURL(item.audioUrl))
    history.value = []
  }

  return {
    volcVoices: VOLC_VOICES,
    history,
    errorMsg: readonly(errorMsg),
    statusText: readonly(statusText),
    isGenerating: readonly(isGenerating),
    isPlaying: readonly(isPlaying),
    currentPlayingId: readonly(currentPlayingId),
    lastUsage: readonly(lastUsage),
    synthesize,
    playAudio,
    stopAudio,
    downloadAudio,
    removeHistoryItem,
    clearHistory,
  }
}
