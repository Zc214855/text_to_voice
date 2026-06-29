import { readonly, ref } from 'vue'
import edgeVoicesData from '../data/edge-voices.json'
import { defaultItemName, useSharedHistory } from './useSharedHistory'
import { concatBlobsWithSilence } from './useTTS'
import { countTextUnits } from '../utils/textCleanup'
import type { EdgeVoice, HistoryItem, RoleStoryControls } from './types'

export const EDGE_VOICES = edgeVoicesData as EdgeVoice[]

const EDGE_TTS_ENDPOINT = '/edge-api/synthesize'

const errorMsg = ref('')
const statusText = ref('就绪')
const isGenerating = ref(false)
const serverAvailable = ref(false)

export function useEdgeTTS() {
  const shared = useSharedHistory()

  async function checkServer() {
    try {
      const res = await fetch('/edge-api/health')
      serverAvailable.value = res.ok
    } catch {
      serverAvailable.value = false
    }
  }

  async function synthesizeAudioOnly(params: {
    text: string
    voice: string
    rate: number
    pitch: number
    volume: number
    storyMode?: boolean
    signal?: AbortSignal
  }): Promise<Blob> {
    const response = await fetch(EDGE_TTS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: params.text.trim(),
        voice: params.voice,
        rate: params.rate,
        pitch: params.pitch,
        volume: params.volume,
        storyMode: params.storyMode ?? true,
      }),
      signal: params.signal,
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
      throw new Error(err.error || `HTTP ${response.status}`)
    }

    const blob = await response.blob()
    if (!blob.size) throw new Error('Edge TTS 未返回音频数据')
    return blob
  }

  async function synthesizeRoleStory(params: {
    text: string
    name: string
    segments: { role: string; text: string }[]
    roleControls: { role: string; voice: string; voiceName: string; rate: number; pitch: number; volume: number }[]
  }) {
    const text = params.text.trim()

    if (!text || params.segments.length === 0) {
      errorMsg.value = '请输入角色故事文本'
      return undefined
    }

    const voiceMap = new Map(params.roleControls.map((c) => [c.role, c]))
    const missingRoles = params.segments.filter((s) => !voiceMap.has(s.role)).map((s) => s.role)
    if (missingRoles.length > 0) {
      const unique = [...new Set(missingRoles)]
      errorMsg.value = `角色音色配置不完整：缺少 ${unique.join('、')}`
      return undefined
    }

    isGenerating.value = true
    errorMsg.value = ''
    statusText.value = '请求 Edge TTS'

    const blobs: Blob[] = []
    try {

      for (let i = 0; i < params.segments.length; i += 1) {
        const segment = params.segments[i]
        const controls = voiceMap.get(segment.role)!
        statusText.value = `生成角色片段 ${i + 1} / ${params.segments.length}`

        const res = await fetch(EDGE_TTS_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: segment.text,
            voice: controls.voice,
            rate: controls.rate,
            pitch: controls.pitch,
            volume: controls.volume,
            storyMode: true,
          }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
          throw new Error(err.error || `Edge TTS 片段 ${i + 1} 失败`)
        }

        const blob = await res.blob()
        if (!blob.size) throw new Error(`Edge TTS 片段 ${i + 1} 未返回音频`)
        blobs.push(blob)
      }

      statusText.value = '合成角色故事'
      const blob = await concatBlobsWithSilence(blobs, 400)
      const requestId = `edge-role-${Date.now()}-${Math.random().toString(16).slice(2)}`
      const item: HistoryItem = {
        id: requestId,
        engine: 'edge',
        name: params.name || defaultItemName(text),
        text,
        voice: 'role-story',
        voiceName: `Edge 角色故事 · ${params.roleControls.length} 角色`,
        fileName: '',
        byteLength: blob.size,
        requestId,
        createdAt: new Date().toISOString(),
        controls: {
          mode: 'role-story',
          roles: params.roleControls as unknown as RoleStoryControls['roles'],
          segmentCount: params.segments.length,
          characterCount: params.segments.reduce((sum, s) => sum + countTextUnits(s.text), 0),
        } as RoleStoryControls,
      }

      statusText.value = '保存音频文件'
      const saved = await shared.addItem(item, blob, 'audio/wav')
      if (!saved) {
        throw new Error('音频已生成但保存失败，请检查本地服务或 output 目录权限')
      }
      Object.assign(item, saved)
      statusText.value = '完成'

      return item
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '合成失败'
      const prefix = blobs.length > 0 ? `已生成 ${blobs.length}/${params.segments.length} 段，` : ''
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        errorMsg.value = prefix + 'Edge TTS 服务未启动，请先运行 node server/index.js'
      } else {
        errorMsg.value = prefix + msg
      }
      statusText.value = '失败'
      return undefined
    } finally {
      isGenerating.value = false
    }
  }

  return {
    edgeVoices: EDGE_VOICES,
    history: shared.history,
    errorMsg: readonly(errorMsg),
    statusText: readonly(statusText),
    isGenerating: readonly(isGenerating),
    isPlaying: shared.isPlaying,
    currentPlayingId: shared.currentPlayingId,
    serverAvailable: readonly(serverAvailable),
    restoreHistory: shared.restoreHistory,
    checkServer,
    synthesizeRoleStory,
    synthesizeAudioOnly,
    playAudio: shared.playAudio,
    stopAudio: shared.stopAudio,
    downloadAudio: shared.downloadAudio,
    renameItem: shared.renameItem,
    removeHistoryItem: shared.removeHistoryItem,
    clearHistory: shared.clearHistory,
  }
}
