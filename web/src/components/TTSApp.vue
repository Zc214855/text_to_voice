<script setup lang="ts">
import { computed, ref } from 'vue'
import { EMOTIONS, MAX_TEXT_LENGTH, useTTS } from '../composables/useTTS'
import type { HistoryItem } from '../composables/types'

const {
  volcVoices,
  history,
  errorMsg,
  statusText,
  isGenerating,
  isPlaying,
  currentPlayingId,
  lastUsage,
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
const autoPlay = ref(true)

const selectedVoiceInfo = computed(() => volcVoices.find((voice) => voice.id === selectedVoice.value) || volcVoices[0])
const charCount = computed(() => text.value.length)
const textOverflow = computed(() => charCount.value > MAX_TEXT_LENGTH)
const groupedVoices = computed(() => {
  return volcVoices.reduce<Record<string, typeof volcVoices>>((groups, voice) => {
    groups[voice.scene] ||= []
    groups[voice.scene].push(voice)
    return groups
  }, {})
})

const latestItem = computed(() => history.value[0] || null)
const canGenerate = computed(() => Boolean(text.value.trim()) && !textOverflow.value && !isGenerating.value)

async function handleGenerate() {
  if (!canGenerate.value) return

  const item = await synthesize({
    text: text.value,
    voice: selectedVoice.value,
    voiceName: selectedVoiceInfo.value.name,
    speechRate: speechRate.value,
    pitch: pitch.value,
    loudness: loudness.value,
    emotion: emotion.value,
    emotionScale: emotionScale.value,
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
            <div class="flex items-center justify-between border-b border-zinc-950/10 px-4 py-3">
              <label class="text-sm font-bold text-zinc-900">文案</label>
              <span class="text-xs font-bold" :class="textOverflow ? 'text-red-600' : 'text-zinc-500'">{{ charCount }} / {{ MAX_TEXT_LENGTH }}</span>
            </div>
            <textarea
              v-model="text"
              class="min-h-[280px] flex-1 resize-none bg-transparent px-5 py-4 text-base leading-8 text-zinc-900 outline-none placeholder:text-zinc-400"
              placeholder="输入要合成的文本"
            ></textarea>
            <div class="border-t border-zinc-950/10 px-4 py-3">
              <p v-if="textOverflow" class="text-sm font-semibold text-red-600">文本超出接口限制。</p>
              <p v-else class="text-sm text-zinc-500">当前音色：{{ selectedVoiceInfo.name }} · {{ selectedVoiceInfo.language }}</p>
            </div>
          </div>

          <aside class="space-y-4">
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
              <div class="mt-2 rounded-md bg-zinc-50 p-2 text-xs font-medium leading-5 text-zinc-600">
                {{ selectedVoiceInfo.id }}
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
                    class="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
                  >
                    <option v-for="item in EMOTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
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
              <label class="mt-3 flex cursor-pointer items-center gap-3 text-sm font-bold text-zinc-800">
                <input v-model="autoPlay" type="checkbox" class="h-4 w-4 accent-zinc-950" />
                生成后播放
              </label>
            </section>

            <button
              class="flex w-full items-center justify-center gap-3 rounded-lg bg-zinc-950 px-5 py-3 text-base font-black text-white shadow-lg shadow-zinc-950/15 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45"
              :disabled="!canGenerate"
              @click="handleGenerate"
            >
              <span v-if="isGenerating" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
              {{ isGenerating ? '生成中' : '生成配音' }}
            </button>

            <p v-if="errorMsg" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{{ errorMsg }}</p>
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
            <button class="rounded-full bg-amber-400 px-4 py-2 text-sm font-black text-zinc-950 transition hover:bg-amber-300" @click="playAudio(active(latestItem) ? null : latestItem)">
              {{ active(latestItem) ? '暂停' : '播放' }}
            </button>
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
