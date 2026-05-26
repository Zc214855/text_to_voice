<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { EMOTION_LABELS, MAX_TEXT_LENGTH, useTTS } from '../composables/useTTS'
import { cleanupTtsText, countTextUnits, normalizeLineBreaks } from '../utils/textCleanup'
import type { HistoryItem } from '../composables/types'

const {
  volcVoices,
  history,
  errorMsg,
  statusText,
  isGenerating,
  isPlaying,
  currentPlayingId,
  currentResourceId,
  availableResourceIds,
  lastUsage,
  refreshConfig,
  restoreHistory,
  synthesize,
  playAudio,
  downloadAudio,
  removeHistoryItem,
  clearHistory,
} = useTTS()

const text = ref('从前有一只小兔子住在森林边缘。每天傍晚，它都会把星星一样亮的蒲公英种子吹向远方。')
const selectedVoice = ref(volcVoices[0].id)
const speechRate = ref(1)
const pitch = ref(0)
const loudness = ref(1)
const emotion = ref('')
const emotionScale = ref(4)
const explicitLanguage = ref('')
const autoPlay = ref(true)
const selectedResourceId = ref('')
const cleanupStatus = ref('')
const configError = ref('')

const resourceVoices = computed(() => {
  if (!selectedResourceId.value) return volcVoices
  return volcVoices.filter((voice) => voice.resourceIds.includes(selectedResourceId.value))
})
const selectedVoiceInfo = computed(() => resourceVoices.value.find((voice) => voice.id === selectedVoice.value) || resourceVoices.value[0] || volcVoices[0])
const normalizedText = computed(() => normalizeLineBreaks(text.value))
const textLength = computed(() => countTextUnits(normalizedText.value))
const estimatedBillableCount = computed(() => countTextUnits(normalizedText.value.trim()))
const textOverflow = computed(() => estimatedBillableCount.value > MAX_TEXT_LENGTH)
const availableEmotions = computed(() => {
  return selectedVoiceInfo.value.emotions.map((value) => ({
    value,
    label: EMOTION_LABELS[value] || value,
  }))
})

const LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '自动（不限）' },
  { value: 'zh-cn', label: '中文' },
  { value: 'en', label: '英文' },
  { value: 'ja', label: '日文' },
  { value: 'es-mx', label: '墨西哥语' },
  { value: 'id', label: '印尼语' },
  { value: 'pt-br', label: '巴葡' },
]

const voiceSupportsZh = computed(() => selectedVoiceInfo.value.language.includes('中文'))
const voiceSupportsEn = computed(() => selectedVoiceInfo.value.language.includes('英语'))

const availableLanguages = computed(() => {
  if (voiceSupportsZh.value && voiceSupportsEn.value) return LANGUAGE_OPTIONS
  if (voiceSupportsEn.value && !voiceSupportsZh.value) return LANGUAGE_OPTIONS.filter((o) => !o.value || o.value === 'en')
  if (voiceSupportsZh.value && !voiceSupportsEn.value) return LANGUAGE_OPTIONS.filter((o) => !o.value || o.value === 'zh-cn')
  return LANGUAGE_OPTIONS
})
const groupedVoices = computed(() => {
  return resourceVoices.value.reduce<Record<string, typeof volcVoices>>((groups, voice) => {
    groups[voice.scene] ||= []
    groups[voice.scene].push(voice)
    return groups
  }, {})
})

const latestItem = computed(() => history.value[0] || null)
const canGenerate = computed(() => Boolean(text.value.trim()) && !textOverflow.value && !isGenerating.value)

onMounted(() => {
  restoreHistory()
  refreshConfig()
    .then(() => {
      selectedResourceId.value = currentResourceId.value
    })
    .catch((err: unknown) => {
      configError.value = err instanceof Error ? err.message : '配置加载失败'
    })
})

watch(currentResourceId, (resourceId) => {
  if (!selectedResourceId.value && resourceId) {
    selectedResourceId.value = resourceId
  }
})

watch(resourceVoices, (voices) => {
  if (voices.length > 0 && !voices.some((voice) => voice.id === selectedVoice.value)) {
    selectedVoice.value = voices[0].id
  }
})

watch(selectedVoiceInfo, (voice) => {
  if (emotion.value && !voice.emotions.includes(emotion.value)) {
    emotion.value = ''
  }
  if (voiceSupportsEn.value && !voiceSupportsZh.value) explicitLanguage.value = 'en'
  else if (voiceSupportsZh.value && !voiceSupportsEn.value) explicitLanguage.value = 'zh-cn'
  else explicitLanguage.value = ''
})

function setCleanupStatus(result: ReturnType<typeof cleanupTtsText>) {
  if (!result.changed) {
    cleanupStatus.value = ''
    return
  }

  const details = [
    result.trimmedLines ? `修剪 ${result.trimmedLines} 行` : '',
    result.removedBlankLines ? `压缩空行 ${result.removedBlankLines} 处` : '',
    result.mergedLines ? `合并断行 ${result.mergedLines} 处` : '',
  ].filter(Boolean)

  cleanupStatus.value = details.length ? `已整理：${details.join('，')}` : '已整理文本'
}

function applyTextCleanup() {
  const result = cleanupTtsText(text.value)
  text.value = result.text
  setCleanupStatus(result)
  return result.text
}

function handlePaste(event: ClipboardEvent) {
  const pastedText = event.clipboardData?.getData('text/plain')
  const target = event.target as HTMLTextAreaElement | null

  if (!pastedText || !target) return

  event.preventDefault()
  const result = cleanupTtsText(pastedText)
  const start = target.selectionStart ?? text.value.length
  const end = target.selectionEnd ?? start
  text.value = `${text.value.slice(0, start)}${result.text}${text.value.slice(end)}`
  setCleanupStatus(result)

  window.requestAnimationFrame(() => {
    const cursor = start + result.text.length
    target.setSelectionRange(cursor, cursor)
  })
}

async function handleGenerate() {
  if (!canGenerate.value) return

  const cleanText = applyTextCleanup()

  const item = await synthesize({
    text: cleanText,
    voice: selectedVoice.value,
    voiceName: selectedVoiceInfo.value.name,
    resourceId: selectedResourceId.value,
    speechRate: speechRate.value,
    pitch: pitch.value,
    loudness: loudness.value,
    emotion: emotion.value,
    emotionScale: emotionScale.value,
    explicitLanguage: explicitLanguage.value,
  })

  if (item && autoPlay.value) {
    await playAudio(item)
  }
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function active(item: HistoryItem) {
  return currentPlayingId.value === item.id && isPlaying.value
}
</script>

<template>
  <div class="min-h-screen bg-[#f7f4ef] text-zinc-950">
    <div class="mx-auto grid min-h-screen w-full max-w-7xl grid-cols-1 lg:grid-cols-[1fr_380px]">
      <main class="flex min-h-screen flex-col border-zinc-950/10 bg-[#fbfaf7] px-5 py-5 lg:border-r lg:px-10 lg:py-6">
        <header class="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">Volcengine TTS</p>
            <h1 class="mt-1 text-3xl font-black tracking-normal text-zinc-950 md:text-4xl">FairyVoice</h1>
          </div>
          <div class="flex items-center gap-3 rounded-full border border-zinc-950/10 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm">
            <span class="h-2 w-2 rounded-full" :class="isGenerating ? 'bg-amber-500' : errorMsg ? 'bg-red-500' : 'bg-emerald-500'"></span>
            {{ statusText }}
          </div>
        </header>

        <section class="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div class="flex min-h-[440px] flex-col rounded-lg border border-zinc-950/10 bg-white shadow-sm">
            <div class="flex items-center justify-between gap-3 border-b border-zinc-950/10 px-4 py-3">
              <label class="text-sm font-bold text-zinc-900">文案</label>
              <div class="flex items-center gap-3">
                <button
                  class="rounded-md border border-zinc-950/10 px-2.5 py-1 text-xs font-bold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="!text.trim()"
                  @click="applyTextCleanup"
                >
                  整理文本
                </button>
                <span class="text-xs font-bold" :class="textOverflow ? 'text-red-600' : 'text-zinc-500'">估算 {{ estimatedBillableCount }} / {{ MAX_TEXT_LENGTH }}</span>
              </div>
            </div>
            <textarea
              v-model="text"
              class="min-h-[280px] flex-1 resize-none bg-transparent px-5 py-4 text-base leading-8 text-zinc-900 outline-none placeholder:text-zinc-400"
              placeholder="输入要合成的文本"
              @paste="handlePaste"
            ></textarea>
            <div class="border-t border-zinc-950/10 px-4 py-3">
              <div class="mb-3 grid grid-cols-2 gap-2 text-xs font-semibold text-zinc-600">
                <div class="rounded bg-zinc-50 px-2 py-1.5">字符 {{ textLength }}</div>
                <div class="rounded bg-zinc-50 px-2 py-1.5" :class="textOverflow ? 'text-red-600' : ''">估算计费 {{ estimatedBillableCount }}</div>
              </div>
              <p v-if="textOverflow" class="text-sm font-semibold text-red-600">估算计费字符超出前端限制。</p>
              <p v-else-if="cleanupStatus" class="text-sm font-semibold text-emerald-700">{{ cleanupStatus }}</p>
              <p v-else class="text-sm text-zinc-500">
                当前音色：{{ selectedVoiceInfo.name }} · {{ selectedVoiceInfo.language }} · {{ selectedVoiceInfo.model }}
              </p>
            </div>
          </div>

          <aside class="space-y-4">
            <section class="rounded-lg border border-zinc-950/10 bg-white p-3 shadow-sm">
              <label class="text-sm font-bold text-zinc-900">服务资源</label>
              <select
                v-model="selectedResourceId"
                class="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
              >
                <option v-for="resourceId in availableResourceIds" :key="resourceId" :value="resourceId">{{ resourceId }}</option>
              </select>
              <p class="mt-2 text-xs font-medium leading-5 text-zinc-500">切换服务后，只显示该服务可调用的音色。</p>
            </section>

            <section class="rounded-lg border border-zinc-950/10 bg-white p-3 shadow-sm">
              <label class="text-sm font-bold text-zinc-900">音色</label>
              <select
                v-model="selectedVoice"
                class="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
              >
                <optgroup v-for="(voices, scene) in groupedVoices" :key="scene" :label="scene">
                  <option v-for="voice in voices" :key="voice.id" :value="voice.id">
                    {{ voice.name }} · {{ voice.model }}
                  </option>
                </optgroup>
              </select>
              <div class="mt-2 space-y-1 rounded-md bg-zinc-50 p-2 text-xs font-medium leading-5 text-zinc-600">
                <p class="break-all">{{ selectedVoiceInfo.id }}</p>
                <p>当前资源：{{ selectedResourceId || currentResourceId || '读取中' }}</p>
                <p>音色资源：{{ selectedVoiceInfo.resourceIds.join(' / ') }}</p>
              </div>
            </section>

            <section class="rounded-lg border border-zinc-950/10 bg-white p-3 shadow-sm">
              <div class="space-y-3">
                <div>
                  <div class="mb-1 flex justify-between text-sm font-bold">
                    <label>语速</label>
                    <span>{{ speechRate.toFixed(1) }}x</span>
                  </div>
                  <input v-model.number="speechRate" type="range" min="0.5" max="2" step="0.1" class="w-full accent-zinc-950" />
                </div>

                <div>
                  <div class="mb-1 flex justify-between text-sm font-bold">
                    <label>音调</label>
                    <span>{{ pitch > 0 ? '+' : '' }}{{ pitch }}</span>
                  </div>
                  <input v-model.number="pitch" type="range" min="-12" max="12" step="1" class="w-full accent-zinc-950" />
                </div>

                <div>
                  <div class="mb-1 flex justify-between text-sm font-bold">
                    <label>音量</label>
                    <span>{{ loudness.toFixed(1) }}x</span>
                  </div>
                  <input v-model.number="loudness" type="range" min="0.5" max="2" step="0.1" class="w-full accent-zinc-950" />
                </div>
              </div>
            </section>

            <section class="rounded-lg border border-zinc-950/10 bg-white p-3 shadow-sm">
              <div class="grid grid-cols-[1fr_88px] gap-3">
                <div>
                  <label class="text-sm font-bold text-zinc-900">情绪</label>
                  <select
                    v-model="emotion"
                    :disabled="availableEmotions.length === 0"
                    class="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold outline-none transition disabled:bg-zinc-100 disabled:text-zinc-400 focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
                  >
                    <option value="">默认</option>
                    <option v-for="item in availableEmotions" :key="item.value" :value="item.value">{{ item.label }}</option>
                  </select>
                </div>
                <div>
                  <label class="text-sm font-bold text-zinc-900">强度</label>
                  <input
                    v-model.number="emotionScale"
                    type="number"
                    min="1"
                    max="5"
                    :disabled="!emotion"
                    class="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-bold outline-none transition disabled:bg-zinc-100 disabled:text-zinc-400 focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
                  />
                </div>
              </div>
              <p class="mt-2 text-xs font-medium leading-5 text-zinc-500">
                {{ availableEmotions.length ? `该音色支持 ${availableEmotions.length} 种情绪。` : '官网未声明该音色支持情绪参数。' }}
              </p>
              <label class="mt-3 flex cursor-pointer items-center gap-3 text-sm font-bold text-zinc-800">
                <input v-model="autoPlay" type="checkbox" class="h-4 w-4 accent-zinc-950" />
                生成后播放
              </label>

              <section class="mt-3 rounded-md border border-zinc-950/10 bg-zinc-50 p-2">
                <label class="text-xs font-bold text-zinc-700">文本语种</label>
                <select
                  v-model="explicitLanguage"
                  class="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-900 outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/15"
                >
                  <option v-for="lang in availableLanguages" :key="lang.value" :value="lang.value">{{ lang.label }}</option>
                </select>
                <p class="mt-1 text-xs font-medium leading-4 text-zinc-500">
                  指定文本语种可提升合成质量；英语音色请选"英文"。
                </p>
              </section>
            </section>

            <button
              class="flex w-full items-center justify-center gap-3 rounded-lg bg-zinc-950 px-5 py-3 text-base font-black text-white shadow-lg shadow-zinc-950/15 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45"
              :disabled="!canGenerate"
              @click="handleGenerate"
            >
              <span v-if="isGenerating" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
              {{ isGenerating ? '生成中' : '生成配音' }}
            </button>

            <p v-if="configError || errorMsg" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{{ configError || errorMsg }}</p>
          </aside>
        </section>
      </main>

      <aside class="flex min-h-screen flex-col bg-[#ece6dc] px-5 py-6 lg:px-6 lg:py-8">
        <div class="mb-5 flex items-center justify-between gap-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Library</p>
            <h2 class="mt-2 text-2xl font-black text-zinc-950">作品</h2>
          </div>
          <button
            v-if="history.length"
            class="rounded-md border border-zinc-950/15 px-3 py-2 text-xs font-bold text-zinc-700 transition hover:bg-white"
            @click="clearHistory"
          >
            清空
          </button>
        </div>

        <section v-if="latestItem" class="mb-5 rounded-lg border border-zinc-950/10 bg-zinc-950 p-4 text-white shadow-sm">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate text-sm font-bold">{{ latestItem.voiceName }}</p>
              <p class="mt-1 text-xs text-white/55">{{ formatTime(latestItem.createdAt) }} · {{ formatSize(latestItem.byteLength) }}</p>
            </div>
            <div class="flex items-center gap-2">
              <button class="rounded-full bg-amber-400 px-4 py-2 text-sm font-black text-zinc-950 transition hover:bg-amber-300" @click="playAudio(active(latestItem) ? null : latestItem)">
                {{ active(latestItem) ? '暂停' : '播放' }}
              </button>
              <button class="rounded-full bg-white/10 px-3 py-2 text-sm font-bold text-white/60 transition hover:bg-red-500/40 hover:text-white" @click="removeHistoryItem(latestItem.id)">删除</button>
            </div>
          </div>
          <p class="mt-4 line-clamp-3 text-sm leading-6 text-white/75">{{ latestItem.text }}</p>
          <p v-if="lastUsage?.text_words" class="mt-4 text-xs font-semibold text-amber-200">计费字符：{{ lastUsage.text_words }}</p>
        </section>

        <div v-if="history.length" class="space-y-3 overflow-y-auto pr-1">
          <article
            v-for="item in history"
            :key="item.id"
            class="rounded-lg border bg-white p-4 shadow-sm transition"
            :class="active(item) ? 'border-amber-500' : 'border-zinc-950/10 hover:border-zinc-950/25'"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate text-sm font-black text-zinc-900">{{ item.voiceName }}</p>
                <p class="mt-1 text-xs font-semibold text-zinc-500">{{ formatTime(item.createdAt) }} · {{ formatSize(item.byteLength) }}</p>
              </div>
              <button class="rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-black text-zinc-900 transition hover:bg-amber-300" @click="playAudio(active(item) ? null : item)">
                {{ active(item) ? '停' : '播' }}
              </button>
            </div>
            <p class="mt-3 line-clamp-2 text-sm leading-6 text-zinc-600">{{ item.text }}</p>
            <div class="mt-4 flex flex-wrap items-center gap-2 text-xs font-bold text-zinc-500">
              <span class="rounded bg-zinc-100 px-2 py-1">{{ item.controls.speechRate.toFixed(1) }}x</span>
              <span class="rounded bg-zinc-100 px-2 py-1">pitch {{ item.controls.pitch }}</span>
              <span v-if="item.controls.emotion" class="rounded bg-zinc-100 px-2 py-1">{{ EMOTION_LABELS[item.controls.emotion] || item.controls.emotion }}</span>
              <span v-if="item.controls.explicitLanguage" class="rounded bg-zinc-100 px-2 py-1">{{ LANGUAGE_OPTIONS.find(o => o.value === item.controls.explicitLanguage)?.label || item.controls.explicitLanguage }}</span>
              <button class="ml-auto rounded-md px-2 py-1 text-zinc-800 transition hover:bg-zinc-100" @click="downloadAudio(item)">下载</button>
              <button class="rounded-md px-2 py-1 text-red-600 transition hover:bg-red-50" @click="removeHistoryItem(item.id)">删除</button>
            </div>
          </article>
        </div>

        <div v-else class="flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-950/20 bg-white/40 p-8 text-center text-sm font-semibold leading-6 text-zinc-500">
          生成的音频会出现在这里。
        </div>
      </aside>
    </div>
  </div>
</template>
