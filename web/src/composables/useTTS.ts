import { computed, readonly, ref } from 'vue'
import voices from '../data/voices.json'
import { countTextUnits } from '../utils/textCleanup'
import { defaultItemName, useSharedHistory } from './useSharedHistory'
import type {
  CloneVoice,
  HistoryItem,
  PopularVoice,
  RoleStorySynthesizeParams,
  RoleStoryVoiceControls,
  TTSConfig,
  UsageInfo,
  VolcSynthesizeParams,
} from './types'

export const MAX_TEXT_LENGTH = 5000

export const EMOTION_LABELS: Record<string, string> = {
  affectionate: '深情',
  angry: '生气',
  asmr: '低语',
  chat: '对话 / 闲聊',
  coldness: '冷漠',
  depressed: '沮丧',
  excited: '激动',
  fear: '恐惧',
  happy: '开心',
  hate: '厌恶',
  neutral: '中性',
  sad: '悲伤',
  surprised: '惊讶',
  warm: '温暖',
}

export const VOLC_VOICES = voices as PopularVoice[]

const DEFAULT_ENDPOINT = '/volc-api/api/v3/tts/unidirectional'
/** 声音复刻 2.0 的资源 ID */
export const CLONE_RESOURCE_ID = 'seed-icl-2.0'
type VolcRequestParams = Omit<VolcSynthesizeParams, 'engine'> & { signal?: AbortSignal }

const errorMsg = ref('')
const statusText = ref('就绪')
const isGenerating = ref(false)
const currentResourceId = ref('')
const availableResourceIds = ref<string[]>([])
const lastUsage = ref<UsageInfo | null>(null)
/** 用户自复刻的音色（从 config.json 读取） */
const cloneVoices = ref<CloneVoice[]>([])

/** 把复刻音色合并进官方音色列表，统一供 UI 使用 */
const allVoices = computed<PopularVoice[]>(() => {
  const cloned: PopularVoice[] = cloneVoices.value.map((item) => ({
    id: item.id,
    name: item.name,
    scene: '声音复刻 / 我的音色',
    language: '中文',
    model: '声音复刻2.0',
    resourceIds: [CLONE_RESOURCE_ID],
    emotions: [],
  }))
  return [...VOLC_VOICES, ...cloned]
})

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
  const resourceId = config.resourceId || config.resourceIds?.[0]
  const hasApiKeyAuth = Boolean(config.apiKey)
  const hasLegacyAuth = Boolean(config.appId && config.accessToken)

  if (!resourceId) {
    throw new Error('config.json 缺少 resourceId')
  }

  if (!hasApiKeyAuth && !hasLegacyAuth) {
    throw new Error('config.json 需要配置 apiKey，或同时配置 appId 与 accessToken')
  }

  return {
    ...config,
    resourceId,
    resourceIds: config.resourceIds?.length ? config.resourceIds : [resourceId],
    endpoint: config.endpoint || DEFAULT_ENDPOINT,
  }
}

function buildHeaders(config: TTSConfig, requestId: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Api-Resource-Id': config.resourceId || '',
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

function buildPayload(params: Omit<VolcSynthesizeParams, 'engine'>) {
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

  const additions: Record<string, unknown> = {}

  if (params.explicitLanguage) {
    additions.explicit_language = params.explicitLanguage
  }

  if (params.pitch !== 0) {
    additions.post_process = { pitch: clamp(Math.round(params.pitch), -12, 12) }
  }

  const reqParams: Record<string, unknown> = {
    text: params.text.trim(),
    speaker: params.voice,
    audio_params: audioParams,
  }

  if (Object.keys(additions).length > 0) {
    reqParams.additions = JSON.stringify(additions)
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

/** 将 AudioBuffer 编码为 16-bit PCM WAV Blob */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const length = buffer.length
  const bytesPerSample = 2
  const dataSize = length * numChannels * bytesPerSample

  const header = new ArrayBuffer(44)
  const view = new DataView(header)

  function writeStr(offset: number, str: string) {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true)
  view.setUint16(32, numChannels * bytesPerSample, true)
  view.setUint16(34, bytesPerSample * 8, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  const data = new Uint8Array(44 + dataSize)
  new Uint8Array(header).forEach((byte, i) => { data[i] = byte })

  let offset = 44
  for (let i = 0; i < length; i += 1) {
    for (let ch = 0; ch < numChannels; ch += 1) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]))
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF
      data[offset] = int16 & 0xFF
      data[offset + 1] = (int16 >> 8) & 0xFF
      offset += 2
    }
  }

  return new Blob([data], { type: 'audio/wav' })
}

/** 将多个音频 Blob 用静音间隔拼接为单个 WAV Blob */
export async function concatBlobsWithSilence(blobs: Blob[], silenceMs: number): Promise<Blob> {
  const audioCtx = new AudioContext()
  const buffers: AudioBuffer[] = []

  try {
    for (const blob of blobs) {
      const arrayBuffer = await blob.arrayBuffer()
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
      buffers.push(audioBuffer)
    }

    if (buffers.length === 0) {
      throw new Error('没有可拼接的音频片段')
    }

    const sampleRate = buffers[0].sampleRate
    const silenceLength = Math.ceil(sampleRate * silenceMs / 1000)
    const channels = Math.max(...buffers.map((b) => b.numberOfChannels))

    let totalLength = 0
    for (const buffer of buffers) {
      totalLength += buffer.length + silenceLength
    }
    totalLength -= silenceLength

    const offlineCtx = new OfflineAudioContext(channels, totalLength, sampleRate)
    let timeOffset = 0

    for (const buffer of buffers) {
      const source = offlineCtx.createBufferSource()
      // 如果声道数不匹配，创建一个临时 buffer
      if (buffer.numberOfChannels === channels) {
        source.buffer = buffer
      } else {
        const converted = offlineCtx.createBuffer(channels, buffer.length, sampleRate)
        for (let ch = 0; ch < channels; ch += 1) {
          const srcCh = Math.min(ch, buffer.numberOfChannels - 1)
          converted.copyToChannel(buffer.getChannelData(srcCh), ch)
        }
        source.buffer = converted
      }
      source.connect(offlineCtx.destination)
      source.start(timeOffset / sampleRate)
      timeOffset += buffer.length + silenceLength
    }

    const rendered = await offlineCtx.startRendering()
    return audioBufferToWav(rendered)
  } finally {
    audioCtx.close()
  }
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
  // 如果消息已包含角色名前缀（来自 synthesizeRoleStory 的循环），保留原始细节不转换
  if (message.startsWith('角色「')) {
    return message
  }
  if (message.includes('requested resource not granted')) {
    return '服务实例处于暂停或未授权状态，请在火山引擎控制台恢复实例或检查 Resource ID'
  }
  if (message.includes('speaker permission denied')) {
    return '当前 Resource ID 未授权该音色，请切换音色或检查实例权限'
  }
  if (message.includes('resource ID is mismatched') || message.includes('mismatched with speaker')) {
    return '音色与资源 ID 不匹配：该音色不属于当前选中的服务资源，请在角色面板切换到该音色对应的资源'
  }
  if (message.includes('TTSExceededTextLimit')) {
    return `文本超过 ${MAX_TEXT_LENGTH} 字限制`
  }
  return message
}

function assertVoiceResource(voiceList: PopularVoice[], voiceId: string, resourceId: string) {
  const voice = voiceList.find((item) => item.id === voiceId)
  if (!voice) {
    throw new Error(`音色 ID「${voiceId}」无效或不在列表中，请重新选择音色`)
  }
  if (!voice.resourceIds.includes(resourceId)) {
    throw new Error(
      `音色「${voice.name}」属于资源 ${voice.resourceIds.join('/')}，但当前使用的是「${resourceId}」。请在「服务资源」下拉框切换到 ${voice.resourceIds.join(' 或 ')}，或为该角色换一个属于 ${resourceId} 的音色`
    )
  }
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
  const shared = useSharedHistory()

  async function refreshConfig() {
    const config = await loadConfig()
    currentResourceId.value = config.resourceId || ''
    availableResourceIds.value = config.resourceIds || []
    cloneVoices.value = config.cloneVoices || []
    return config
  }

  async function synthesizeAudioBlob(
    params: VolcRequestParams,
    config: Required<Pick<TTSConfig, 'endpoint'>> & TTSConfig,
  ): Promise<{ requestId: string; usage: UsageInfo | null; blob: Blob }> {
    const requestId = createRequestId()
    const requestConfig = {
      ...config,
      resourceId: params.resourceId || config.resourceId,
    }
    const resourceId = requestConfig.resourceId || ''
    assertVoiceResource(allVoices.value, params.voice, resourceId)

    const headers = buildHeaders(requestConfig, requestId)
    const payload = buildPayload(params)

    const response = await fetch(requestConfig.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: params.signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status}${body ? `：${body}` : ''}`)
    }

    const { audioBase64, usage } = await collectAudioBase64(response)
    if (!audioBase64) {
      throw new Error('接口未返回有效音频数据')
    }

    return {
      requestId,
      usage,
      blob: base64ToBlob(audioBase64, 'audio/mpeg'),
    }
  }

  async function synthesize(params: Omit<VolcSynthesizeParams, 'engine'>) {
    const text = params.text.trim()

    if (!text) {
      errorMsg.value = '请输入要合成的文本'
      return undefined
    }

    if (countTextUnits(text) > MAX_TEXT_LENGTH) {
      errorMsg.value = `估算计费字符不能超过 ${MAX_TEXT_LENGTH} 字`
      return undefined
    }

    isGenerating.value = true
    errorMsg.value = ''
    lastUsage.value = null
    statusText.value = '读取配置'

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 180_000)

    try {
      const config = await refreshConfig()
      statusText.value = '请求火山引擎'
      const { blob, requestId, usage } = await synthesizeAudioBlob({ ...params, text, signal: controller.signal }, config)
      currentResourceId.value = params.resourceId || config.resourceId || ''
      statusText.value = '生成音频文件'
      const item: HistoryItem = {
        id: requestId,
        engine: 'volc',
        name: defaultItemName(text),
        text,
        voice: params.voice,
        voiceName: params.voiceName,
        fileName: '',
        byteLength: blob.size,
        requestId,
        createdAt: new Date().toISOString(),
        controls: {
          speechRate: params.speechRate,
          pitch: params.pitch,
          loudness: params.loudness,
          emotion: params.emotion,
          emotionScale: params.emotionScale,
          explicitLanguage: params.explicitLanguage,
        },
      }

      statusText.value = '保存音频文件'
      const saved = await shared.addItem(item, blob)
      if (!saved) {
        throw new Error('音频已生成但保存失败，请检查本地服务或 output 目录权限')
      }
      Object.assign(item, saved)
      lastUsage.value = usage
      statusText.value = '完成'

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

  async function synthesizeRoleStory(params: Omit<RoleStorySynthesizeParams, 'engine'>) {
    const text = params.text.trim()

    if (!text || params.segments.length === 0) {
      errorMsg.value = '请输入角色故事文本'
      return undefined
    }

    if (countTextUnits(text) > MAX_TEXT_LENGTH) {
      errorMsg.value = `估算计费字符不能超过 ${MAX_TEXT_LENGTH} 字`
      return undefined
    }

    const roleControlMap = new Map(params.roleControls.map((item) => [item.role, item]))
    const missingRoles = params.segments.filter((segment) => !roleControlMap.has(segment.role)).map((s) => s.role)
    if (missingRoles.length > 0) {
      const unique = [...new Set(missingRoles)]
      errorMsg.value = `角色音色配置不完整：缺少 ${unique.join('、')}`
      return undefined
    }

    isGenerating.value = true
    errorMsg.value = ''
    lastUsage.value = null
    statusText.value = '读取配置'

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 180_000)

    try {
      const config = await refreshConfig()
      const blobs: Blob[] = []
      let usageWords = 0

      for (let index = 0; index < params.segments.length; index += 1) {
        const segment = params.segments[index]
        const controls = roleControlMap.get(segment.role) as RoleStoryVoiceControls
        statusText.value = `生成角色片段 ${index + 1} / ${params.segments.length}`
        try {
          const result = await synthesizeAudioBlob({
            text: segment.text,
            voice: controls.voice,
            voiceName: controls.voiceName,
            resourceId: controls.resourceId,
            speechRate: controls.speechRate,
            pitch: controls.pitch,
            loudness: controls.loudness,
            emotion: controls.emotion,
            emotionScale: controls.emotionScale,
            explicitLanguage: controls.explicitLanguage,
            signal: controller.signal,
          }, config)
          blobs.push(result.blob)
          usageWords += result.usage?.text_words ?? segment.characterCount
        } catch (error) {
          const reason = error instanceof Error ? error.message : '合成失败'
          // 如果错误已经包含角色/音色细节（来自 assertVoiceResource），直接抛出
          // 否则补充角色名、音色名、资源 ID，方便定位是哪个角色配置错了
          if (reason.includes('音色') || reason.includes('Resource')) {
            throw new Error(`角色「${segment.role}」：${reason}`)
          }
          throw new Error(
            `角色「${segment.role}」合成失败（音色：${controls.voiceName || controls.voice}，资源：${controls.resourceId || config.resourceId}）：${reason}`
          )
        }
      }

      statusText.value = '合成角色故事'
      const blob = await concatBlobsWithSilence(blobs, 400)
      const requestId = createRequestId()
      const item: HistoryItem = {
        id: requestId,
        engine: 'volc',
        name: params.name || defaultItemName(text),
        text,
        voice: 'role-story',
        voiceName: `角色故事 · ${params.roleControls.length} 角色`,
        fileName: '',
        byteLength: blob.size,
        requestId,
        createdAt: new Date().toISOString(),
        controls: {
          mode: 'role-story',
          roles: params.roleControls,
          segmentCount: params.segments.length,
          characterCount: countTextUnits(text),
        },
      }

      statusText.value = '保存音频文件'
      const saved = await shared.addItem(item, blob, 'audio/wav')
      if (!saved) {
        throw new Error('音频已生成但保存失败，请检查本地服务或 output 目录权限')
      }
      Object.assign(item, saved)
      lastUsage.value = { text_words: usageWords }
      statusText.value = '完成'

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

  return {
    volcVoices: allVoices,
    cloneVoices,
    history: shared.history,
    errorMsg: readonly(errorMsg),
    statusText: readonly(statusText),
    isGenerating: readonly(isGenerating),
    isPlaying: shared.isPlaying,
    currentPlayingId: shared.currentPlayingId,
    currentResourceId: readonly(currentResourceId),
    availableResourceIds: readonly(availableResourceIds),
    lastUsage: readonly(lastUsage),
    refreshConfig,
    restoreHistory: shared.restoreHistory,
    synthesize,
    synthesizeRoleStory,
    playAudio: shared.playAudio,
    stopAudio: shared.stopAudio,
    downloadAudio: shared.downloadAudio,
    renameItem: shared.renameItem,
    removeHistoryItem: shared.removeHistoryItem,
    clearHistory: shared.clearHistory,
    revealInFolder: shared.revealInFolder,
  }
}
