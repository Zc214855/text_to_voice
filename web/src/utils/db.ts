import type { TTSEngine } from '../composables/types'

const DB_NAME = 'fairyvoice'
const DB_VERSION = 2
const STORE_NAME = 'history'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (event) => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
      if (event.oldVersion < 2) {
        const store = (event.target as IDBOpenDBRequest).transaction!.objectStore(STORE_NAME)
        if (!store.indexNames.contains('engine')) {
          store.createIndex('engine', 'engine', { unique: false })
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export interface StoredItem {
  id: string
  engine: TTSEngine
  name: string
  text: string
  voice: string
  voiceName: string
  audioBlob: Blob
  byteLength: number
  requestId: string
  createdAt: string
  controls: {
    speechRate?: number
    pitch?: number
    loudness?: number
    emotion?: string
    emotionScale?: number
    explicitLanguage?: string
    rate?: number
    volume?: number
  }
}

export async function loadAll(): Promise<StoredItem[]> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req = store.getAll()
    req.onsuccess = () => {
      const items = req.result as StoredItem[]
      items.forEach((item) => {
        if (!item.engine) item.engine = 'volc'
      })
      resolve(items)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function save(item: StoredItem): Promise<void> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function updateName(id: string, name: string): Promise<void> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req = store.get(id)
    req.onsuccess = () => {
      const item = req.result as StoredItem | undefined
      if (!item) { resolve(); return }
      item.name = name
      store.put(item)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function remove(id: string): Promise<void> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function clear(): Promise<void> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
