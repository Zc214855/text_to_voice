import { readonly, ref } from 'vue'
import { clear as dbClear, loadAll, remove as dbRemove, save, updateName as dbUpdateName, type StoredItem } from '../utils/db'
import type { EdgeTTSControls, HistoryItem, TTSEngine, TTSControls } from './types'

const history = ref<HistoryItem[]>([])
const isPlaying = ref(false)
const currentPlayingId = ref<string | null>(null)

let audioInstance: HTMLAudioElement | null = null
let loaded = false

export function defaultItemName(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length > 16 ? trimmed.slice(0, 16) + '...' : trimmed
}

export function useSharedHistory() {
  async function restoreHistory() {
    if (loaded) return
    loaded = true
    try {
      const stored = await loadAll()
      const items: HistoryItem[] = stored
        .filter((s) => {
          if (s.engine === 'voicebox') {
            dbRemove(s.id).catch(() => undefined)
            return false
          }
          return true
        })
        .map((s) => ({
          id: s.id,
          engine: (s.engine as TTSEngine) || 'volc',
          name: s.name || defaultItemName(s.text),
          text: s.text,
          voice: s.voice,
          voiceName: s.voiceName,
          audioUrl: URL.createObjectURL(s.audioBlob),
          byteLength: s.byteLength,
          requestId: s.requestId,
          createdAt: new Date(s.createdAt),
          controls: s.controls as TTSControls | EdgeTTSControls,
        }))
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      history.value = items
    } catch { /* IndexedDB unavailable */ }
  }

  function addItem(item: HistoryItem, blob: Blob) {
    history.value.unshift(item)

    save({
      id: item.id,
      engine: item.engine,
      name: item.name,
      text: item.text,
      voice: item.voice,
      voiceName: item.voiceName,
      audioBlob: blob,
      byteLength: blob.size,
      requestId: item.requestId,
      createdAt: item.createdAt.toISOString(),
      controls: item.controls as StoredItem['controls'],
    }).catch(() => undefined)

    while (history.value.length > 100) {
      const removed = history.value.pop()
      if (removed) {
        URL.revokeObjectURL(removed.audioUrl)
        dbRemove(removed.id).catch(() => undefined)
      }
    }
  }

  function renameItem(id: string, name: string) {
    const item = history.value.find((i) => i.id === id)
    if (!item) return
    item.name = name
    dbUpdateName(id, name).catch(() => undefined)
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
    audioInstance.onerror = () => { stopAudio() }

    try {
      await audioInstance.play()
      isPlaying.value = true
      currentPlayingId.value = item.id
    } catch {
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
    dbRemove(id).catch(() => undefined)
  }

  function clearHistory() {
    stopAudio()
    history.value.forEach((item) => URL.revokeObjectURL(item.audioUrl))
    history.value = []
    dbClear().catch(() => undefined)
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
  }
}
