import { readonly, ref } from 'vue'
import { defaultItemName, useSharedHistory } from './useSharedHistory'
import type { VoiceboxProfile, HistoryItem, VoiceboxControls } from './types'

const VOICEBOX_API = '/voicebox-api'

const errorMsg = ref('')
const statusText = ref('就绪')
const isGenerating = ref(false)
const serverAvailable = ref(false)
const profiles = ref<VoiceboxProfile[]>([])

export function useVoicebox() {
  const shared = useSharedHistory()

  async function checkServer() {
    try {
      const res = await fetch(`${VOICEBOX_API}/profiles`)
      if (res.ok) {
        serverAvailable.value = true
        const data = await res.json()
        profiles.value = Array.isArray(data) ? data : []
      } else {
        const health = await fetch(`${VOICEBOX_API}/health`)
        serverAvailable.value = health.ok
        profiles.value = []
      }
    } catch {
      serverAvailable.value = false
      profiles.value = []
    }
  }

  function waitForCompletion(generationId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Voicebox 生成超时'))
      }, 120_000)

      const evtSource = new EventSource(`${VOICEBOX_API}/generate/${generationId}/status`)

      evtSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.status === 'completed') {
            clearTimeout(timeout)
            evtSource.close()
            resolve()
          } else if (data.status === 'failed') {
            clearTimeout(timeout)
            evtSource.close()
            reject(new Error(data.error || 'Voicebox 生成失败'))
          }
        } catch {
          // ignore parse errors on SSE keepalive lines
        }
      }

      evtSource.onerror = () => {
        clearTimeout(timeout)
        evtSource.close()
        reject(new Error('Voicebox SSE 连接断开'))
      }
    })
  }

  async function synthesize(params: { text: string; voice: string; voiceName: string; profileId: string; language: string }) {
    const text = params.text.trim()

    if (!text) {
      errorMsg.value = '请输入要合成的文本'
      return undefined
    }

    isGenerating.value = true
    errorMsg.value = ''
    statusText.value = '提交生成任务'

    try {
      const profile = profiles.value.find(p => p.id === params.profileId)
      const engine = profile?.default_engine || profile?.preset_engine || null

      const body: Record<string, unknown> = {
        text,
        profile_id: params.profileId,
        language: params.language || 'zh',
      }
      if (engine) {
        body.engine = engine
      }

      // Step 1: Submit generation task
      const submitRes = await fetch(`${VOICEBOX_API}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!submitRes.ok) {
        const err = await submitRes.json().catch(() => ({ error: `HTTP ${submitRes.status}` }))
        throw new Error(err.error || err.detail || `HTTP ${submitRes.status}`)
      }

      const submitData = await submitRes.json() as { id: string; status: string }
      const generationId = submitData.id

      if (!generationId) {
        throw new Error('Voicebox 未返回任务 ID')
      }

      // Step 2: Wait for completion
      statusText.value = 'Voicebox 生成中'
      await waitForCompletion(generationId)

      // Step 3: Download audio
      statusText.value = '下载音频'
      const audioRes = await fetch(`${VOICEBOX_API}/audio/${generationId}`)

      if (!audioRes.ok) {
        throw new Error(`获取音频失败: HTTP ${audioRes.status}`)
      }

      const blob = await audioRes.blob()

      if (!blob.size) {
        throw new Error('Voicebox 未返回音频数据')
      }

      const audioUrl = URL.createObjectURL(blob)
      const requestId = `vb-${Date.now()}-${Math.random().toString(16).slice(2)}`

      const item: HistoryItem = {
        id: requestId,
        engine: 'voicebox',
        name: defaultItemName(text),
        text,
        voice: params.voice,
        voiceName: params.voiceName,
        audioUrl,
        byteLength: blob.size,
        requestId,
        createdAt: new Date(),
        controls: {
          profileId: params.profileId,
          language: params.language,
          engine: engine || '',
        },
      }

      shared.addItem(item, blob)
      statusText.value = '完成'

      return item
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '合成失败'
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        errorMsg.value = 'Voicebox 服务未启动，请先打开 Voicebox 桌面端'
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
    profiles: readonly(profiles),
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
