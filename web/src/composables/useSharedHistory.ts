import { ref, readonly } from 'vue'
import type { EdgeTTSControls, HistoryItem, TTSControls } from './types'
import { loadAll, clear } from '../utils/db'

const LIBRARY_API = '/api/library'
const AUDIO_API = '/api/library/audio'

// ========== 模块级单例状态（所有 useSharedHistory() 共享同一份） ==========
const history = ref<HistoryItem[]>([])
const isPlaying = ref(false)
const currentPlayingId = ref<string | null>(null)
let audioEl: HTMLAudioElement | null = null

/** Blob 转 base64 字符串（去掉 data: 前缀） */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function defaultItemName(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return '未命名作品'
  const firstLine = trimmed.split(/\r?\n/)[0]
  const firstSentence = firstLine.split(/[。！？!?.；;]/)[0]
  return firstSentence.slice(0, 30) || '未命名作品'
}

export function useSharedHistory() {
  let restoring = false

  /** 拉取后端列表，并执行一次性 IndexedDB 迁移 */
  async function restoreHistory() {
    if (restoring) return
    restoring = true

    // 1. 先拉后端现有数据
    try {
      const res = await fetch(LIBRARY_API)
      const data = await res.json()
      history.value = Array.isArray(data.items) ? data.items : []
    } catch {
      history.value = []
    }

    // 2. 一次性迁移：把 IndexedDB 里的旧数据搬到后端
    //    安全原则：全部上传成功后才清空 IndexedDB，任何一步失败保留源数据
    try {
      const legacy = await loadAll()
      if (legacy.length > 0) {
        const toMigrate = legacy.filter(s => (s.engine === 'volc' || s.engine === 'edge') && (s as { audioBlob?: Blob }).audioBlob)
        let allOk = true
        for (const s of toMigrate) {
          const blob = (s as { audioBlob?: Blob }).audioBlob!
          const audioBase64 = await blobToBase64(blob)
          const res = await fetch(LIBRARY_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: s.name || defaultItemName(s.text || ''),
              text: s.text || '',
              engine: s.engine,
              voice: s.voice || '',
              voiceName: s.voiceName || '',
              controls: s.controls,
              duration: 0,
              byteLength: s.byteLength || blob.size,
              createdAt: s.createdAt,
              audioBase64,
            }),
          })
          if (!res.ok) {
            allOk = false
            console.error(`迁移失败: ${s.name}, HTTP ${res.status}`)
          }
        }
        if (allOk) {
          await clear()
          const res2 = await fetch(LIBRARY_API)
          const data2 = await res2.json()
          history.value = Array.isArray(data2.items) ? data2.items : []
        } else {
          console.warn('部分记录迁移失败，IndexedDB 数据保留，下次打开页面会重试')
        }
      }
    } catch (err) {
      console.error('迁移过程异常，IndexedDB 数据保留：', err)
    }
    restoring = false
  }

  /** 新增：item 包含元数据，blob 是音频。内部转 base64 POST 给后端 */
  async function addItem(
    item: Omit<HistoryItem, 'fileName'> & { fileName?: string },
    blob: Blob,
    contentType?: string,
  ): Promise<HistoryItem | null> {
    try {
      const audioBase64 = await blobToBase64(blob)
      const body: Record<string, unknown> = {
        name: item.name,
        text: item.text,
        engine: item.engine,
        voice: item.voice,
        voiceName: item.voiceName,
        controls: item.controls,
        duration: item.duration || 0,
        byteLength: item.byteLength || blob.size,
        createdAt: item.createdAt,
        audioBase64,
      }
      if (contentType && contentType.trim()) {
        body.contentType = contentType
      }
      const res = await fetch(LIBRARY_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('保存失败')
      const saved: HistoryItem = await res.json()
      history.value = [saved, ...history.value]
      return saved
    } catch {
      return null
    }
  }

  async function renameItem(id: string, name: string) {
    let oldItem: HistoryItem | null = null
    try {
      const idx = history.value.findIndex((it) => it.id === id)
      if (idx === -1) return
      oldItem = { ...history.value[idx] }
      // 乐观更新
      history.value[idx] = { ...history.value[idx], name }
      const res = await fetch(`${LIBRARY_API}/${encodeURIComponent(id)}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        history.value[idx] = oldItem  // 回滚
        return
      }
      const updated: HistoryItem = await res.json()
      history.value[idx] = { ...history.value[idx], ...updated }
    } catch {
      // fetch 本身异常（网络不通等），用 oldItem 回滚
      const idx = history.value.findIndex((it) => it.id === id)
      if (idx !== -1 && oldItem) history.value[idx] = oldItem
    }
  }

  async function removeHistoryItem(id: string) {
    if (currentPlayingId.value === id) stopAudio()
    try {
      const res = await fetch(`${LIBRARY_API}/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) return
      history.value = history.value.filter((it) => it.id !== id)
    } catch {
      // ignore
    }
  }

  async function clearHistory() {
    stopAudio()
    try {
      const res = await fetch(LIBRARY_API, { method: 'DELETE' })
      if (!res.ok) return
      history.value = []
    } catch {
      // ignore
    }
  }

  /** 在 Windows 资源管理器中定位文件 */
  async function revealInFolder(item: HistoryItem) {
    try {
      await fetch(`${LIBRARY_API}/${encodeURIComponent(item.id)}/locate`, { method: 'POST' })
    } catch {
      // ignore
    }
  }

  function playAudio(item: HistoryItem | null) {
    if (!item) {
      stopAudio()
      return
    }
    if (currentPlayingId.value === item.id && isPlaying.value) {
      audioEl?.pause()
      isPlaying.value = false
      return
    }
    if (audioEl) {
      audioEl.pause()
    }
    audioEl = new Audio(`${AUDIO_API}/${encodeURIComponent(item.fileName)}`)
    audioEl.onplay = () => {
      currentPlayingId.value = item.id
      isPlaying.value = true
    }
    audioEl.onpause = () => {
      isPlaying.value = false
    }
    audioEl.onended = () => {
      currentPlayingId.value = null
      isPlaying.value = false
    }
    audioEl.play().catch(() => undefined)
  }

  function stopAudio() {
    if (audioEl) {
      audioEl.pause()
      audioEl.src = ''
      audioEl = null
    }
    isPlaying.value = false
    currentPlayingId.value = null
  }

  /** 旧版下载接口已废弃，保留空函数避免调用点报错 */
  function downloadAudio(_item: HistoryItem) {
    // no-op
  }

  return {
    history,
    isPlaying: readonly(isPlaying),
    currentPlayingId: readonly(currentPlayingId),
    restoreHistory,
    addItem,
    renameItem,
    playAudio,
    stopAudio,
    downloadAudio,
    removeHistoryItem,
    clearHistory,
    revealInFolder,
  }
}
