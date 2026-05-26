import { readonly, ref } from 'vue'
import edgeVoicesData from '../data/edge-voices.json'
import { defaultItemName, useSharedHistory } from './useSharedHistory'
import type { EdgeSynthesizeParams, EdgeVoice, HistoryItem } from './types'

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

  async function synthesize(params: Omit<EdgeSynthesizeParams, 'engine'>) {
    const text = params.text.trim()

    if (!text) {
      errorMsg.value = '请输入要合成的文本'
      return undefined
    }

    isGenerating.value = true
    errorMsg.value = ''
    statusText.value = '请求 Edge TTS'

    try {
      const body = {
        text,
        voice: params.voice,
        rate: params.rate,
        pitch: params.pitch,
        volume: params.volume,
      }

      const response = await fetch(EDGE_TTS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
        throw new Error(err.error || `HTTP ${response.status}`)
      }

      statusText.value = '接收音频'
      const blob = await response.blob()

      if (!blob.size) {
        throw new Error('Edge TTS 未返回音频数据')
      }

      const audioUrl = URL.createObjectURL(blob)
      const requestId = `edge-${Date.now()}-${Math.random().toString(16).slice(2)}`

      const item: HistoryItem = {
        id: requestId,
        engine: 'edge',
        name: defaultItemName(text),
        text,
        voice: params.voice,
        voiceName: params.voiceName,
        audioUrl,
        byteLength: blob.size,
        requestId,
        createdAt: new Date(),
        controls: {
          rate: params.rate,
          pitch: params.pitch,
          volume: params.volume,
        },
      }

      shared.addItem(item, blob)
      statusText.value = '完成'

      return item
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '合成失败'
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        errorMsg.value = 'Edge TTS 服务未启动，请先运行 node server/index.js'
      } else if (msg.includes('未返回音频数据') || msg.includes('超时')) {
        errorMsg.value = `${msg}，可能是网络不稳定，请再试一次`
      } else {
        errorMsg.value = msg
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
    synthesize,
    playAudio: shared.playAudio,
    stopAudio: shared.stopAudio,
    downloadAudio: shared.downloadAudio,
    renameItem: shared.renameItem,
    removeHistoryItem: shared.removeHistoryItem,
    clearHistory: shared.clearHistory,
  }
}
