<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { EMOTION_LABELS, MAX_TEXT_LENGTH, useTTS } from '../composables/useTTS'
import { defaultItemName, useSharedHistory } from '../composables/useSharedHistory'
import { useEdgeTTS } from '../composables/useEdgeTTS'
import { cleanupTtsText, countTextUnits, normalizeLineBreaks } from '../utils/textCleanup'
import { parseRoleScript } from '../utils/roleScript'
import type { EdgeTTSControls, HistoryItem, PopularVoice, RoleStoryControls, RoleStoryVoiceControls, TTSEngine, TTSControls } from '../composables/types'

function detectTextLang(text: string): string {
  const sample = text.replace(/[\s\d\p{P}]/gu, '').slice(0, 200)
  if (!sample) return ''
  const cjk = [...sample].filter(c => {
    const code = c.codePointAt(0)!
    return (code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF)
  }).length
  const hiragana = [...sample].filter(c => c >= '぀' && c <= 'ゟ').length
  const katakana = [...sample].filter(c => c >= '゠' && c <= 'ヿ').length
  const hangul = [...sample].filter(c => c >= '가' && c <= '힯').length
  const latin = [...sample].filter(c => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')).length
  const total = [...sample].length
  if (cjk / total > 0.3) return 'zh'
  if ((hiragana + katakana) / total > 0.2) return 'ja'
  if (hangul / total > 0.2) return 'ko'
  if (latin / total > 0.3) return 'en'
  return ''
}

const TEXT_LANG_LABEL: Record<string, string> = { zh: '中文', en: '英文', ja: '日文', ko: '韩文' }

const volc = useTTS()
const edge = useEdgeTTS()

const activeEngine = ref<TTSEngine>('volc')
const generationMode = ref<'single' | 'role'>('single')
const text = ref('从前有一只小兔子住在森林边缘。每天傍晚，它都会把星星一样亮的蒲公英种子吹向远方。')
const autoPlay = ref(true)
const cleanupStatus = ref('')
const configError = ref('')

// Volc controls
const selectedVoice = ref(volc.volcVoices.value[0]?.id ?? '')
const speechRate = ref(1)
const pitch = ref(0)
const loudness = ref(1)
const emotion = ref('')
const emotionScale = ref(4)
const explicitLanguage = ref('')
const selectedResourceId = ref('')
const roleControls = ref<RoleStoryVoiceControls[]>([])

// Edge controls
const selectedEdgeVoice = ref(edge.edgeVoices[0]?.id ?? '')
const edgeRate = ref(0)
const edgePitch = ref(0)
const edgeVolume = ref(0)

const resourceVoices = computed(() => {
  if (!selectedResourceId.value) return volc.volcVoices.value
  return volc.volcVoices.value.filter((voice) => voice.resourceIds.includes(selectedResourceId.value))
})
const selectedVoiceInfo = computed(() => resourceVoices.value.find((voice) => voice.id === selectedVoice.value) || resourceVoices.value[0] || volc.volcVoices.value[0])
const selectedEdgeVoiceInfo = computed(() => edge.edgeVoices.find((v) => v.id === selectedEdgeVoice.value) || edge.edgeVoices[0])

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
  return resourceVoices.value.reduce<Record<string, PopularVoice[]>>((groups, voice) => {
    groups[voice.scene] ||= []
    groups[voice.scene].push(voice)
    return groups
  }, {})
})

const roleScript = computed(() => parseRoleScript(normalizedText.value.trim()))
const roleAvailableVoices = computed(() => {
  const resourceIds = volc.availableResourceIds.value
  if (resourceIds.length === 0) return volc.volcVoices.value
  return volc.volcVoices.value.filter((voice) => voice.resourceIds.some((resourceId) => resourceIds.includes(resourceId)))
})
const groupedRoleVoices = computed(() => {
  return roleAvailableVoices.value.reduce<Record<string, PopularVoice[]>>((groups, voice) => {
    groups[voice.scene] ||= []
    groups[voice.scene].push(voice)
    return groups
  }, {})
})

const groupedEdgeVoices = computed(() => {
  return edge.edgeVoices.reduce<Record<string, typeof edge.edgeVoices>>((groups, voice) => {
    groups[voice.locale] ||= []
    groups[voice.locale].push(voice)
    return groups
  }, {})
})

const history = volc.history
const latestItem = computed(() => history.value[0] || null)

const isGenerating = computed(() => {
  if (activeEngine.value === 'volc') return volc.isGenerating.value
  return edge.isGenerating.value
})
const statusText = computed(() => {
  if (activeEngine.value === 'volc') return volc.statusText.value
  return edge.statusText.value
})
const errorMsg = computed(() => {
  if (activeEngine.value === 'volc') return volc.errorMsg.value
  return edge.errorMsg.value
})

const detectedLang = computed(() => detectTextLang(normalizedText.value.trim()))
const edgeLangMismatch = computed(() => {
  if (activeEngine.value !== 'edge' || !detectedLang.value) return false
  const voiceLocale = selectedEdgeVoiceInfo.value.locale
  const voiceLang = voiceLocale.startsWith('zh') ? 'zh' : voiceLocale.split('-')[0]
  return voiceLang !== detectedLang.value
})

const roleStoryReady = computed(() => {
  if (generationMode.value !== 'role') return true
  return activeEngine.value === 'volc' &&
    roleScript.value.segments.length > 0 &&
    roleScript.value.roles.every((role) => roleControls.value.some((control) => control.role === role && control.voice))
})

const canGenerate = computed(() => Boolean(text.value.trim()) && !textOverflow.value && !isGenerating.value && !edgeLangMismatch.value && roleStoryReady.value)

onMounted(() => {
  volc.restoreHistory()
  volc.refreshConfig()
    .then(() => {
      selectedResourceId.value = volc.currentResourceId.value
    })
    .catch((err: unknown) => {
      configError.value = err instanceof Error ? err.message : '配置加载失败'
    })
  edge.checkServer()
})

watch(() => volc.currentResourceId.value, (resourceId) => {
  if (!selectedResourceId.value && resourceId) {
    selectedResourceId.value = resourceId
  }
})

watch(resourceVoices, (voices) => {
  if (voices.length > 0 && !voices.some((voice) => voice.id === selectedVoice.value)) {
    selectedVoice.value = voices[0].id
  }
})

watch(activeEngine, (engine) => {
  if (engine === 'edge' && generationMode.value === 'role') {
    generationMode.value = 'single'
  }
  if (engine === 'edge') {
    const lang = detectedLang.value
    if (lang) {
      const prefix = lang === 'zh' ? 'zh-CN' : lang === 'ja' ? 'ja-JP' : lang === 'ko' ? 'ko-KR' : 'en-US'
      const match = edge.edgeVoices.find(v => v.locale.startsWith(prefix))
      if (match) selectedEdgeVoice.value = match.id
    }
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

watch([
  () => roleScript.value.roles.join('\u0000'),
  () => roleAvailableVoices.value.map((voice) => voice.id).join('\u0000'),
], syncRoleControls, { immediate: true })

function setGenerationMode(mode: 'single' | 'role') {
  generationMode.value = mode
  if (mode === 'role') {
    activeEngine.value = 'volc'
  }
}

function findRoleVoice(names: string[]) {
  const voices = roleAvailableVoices.value.length > 0 ? roleAvailableVoices.value : volc.volcVoices.value
  return names.map((name) => voices.find((voice) => voice.name === name)).find(Boolean) || voices[0]
}

function createRoleControl(role: string): RoleStoryVoiceControls {
  const isVillain = /狼|怪|魔|坏|反派|巫/.test(role)
  const isMother = /妈妈|母亲|奶奶|外婆|老师|阿姨/.test(role)
  const isMale = /爸爸|父亲|爷爷|外公|男孩|哥哥|弟弟|王子/.test(role)
  const isChild = /小|兔|猫|狗|熊|鸟|鹿|孩子|宝宝|公主/.test(role)
  const names = isVillain
    ? ['冷酷哥哥（多情感）', '云舟 2.0']
    : isMother
      ? ['温柔淑女 2.0', '儿童绘本']
      : isMale
        ? ['爽朗少年', '儒雅逸辰', '云舟 2.0']
        : isChild
          ? ['可爱女生', '调皮公主', '爽朗少年']
          : ['儿童绘本', '温柔淑女 2.0']
  const voice = findRoleVoice(names)
  const emotion = isVillain && voice?.emotions.includes('coldness') ? 'coldness' : ''

  return {
    role,
    voice: voice?.id || '',
    voiceName: voice?.name || '',
    resourceId: voice?.resourceIds[0] || selectedResourceId.value,
    speechRate: role === '旁白' ? 0.9 : 0.95,
    pitch: isVillain ? -1 : 0,
    loudness: 1,
    emotion,
    emotionScale: emotion ? 2 : 4,
    explicitLanguage: 'zh-cn',
  }
}

function normalizeRoleControl(control: RoleStoryVoiceControls) {
  const voice = roleAvailableVoices.value.find((item) => item.id === control.voice)
  if (!voice) return createRoleControl(control.role)
  return {
    ...control,
    voiceName: voice.name,
    resourceId: voice.resourceIds[0],
    emotion: control.emotion && voice.emotions.includes(control.emotion) ? control.emotion : '',
  }
}

function syncRoleControls() {
  const existing = new Map(roleControls.value.map((control) => [control.role, control]))
  roleControls.value = roleScript.value.roles.map((role) => {
    const current = existing.get(role)
    return current ? normalizeRoleControl(current) : createRoleControl(role)
  })
}

function updateRoleVoice(control: RoleStoryVoiceControls) {
  const voice = roleAvailableVoices.value.find((item) => item.id === control.voice)
  if (!voice) return
  control.voiceName = voice.name
  control.resourceId = voice.resourceIds[0]
  if (control.emotion && !voice.emotions.includes(control.emotion)) {
    control.emotion = ''
  }
}

function roleEmotionOptions(control: RoleStoryVoiceControls) {
  const voice = roleAvailableVoices.value.find((item) => item.id === control.voice)
  return voice?.emotions || []
}

function roleSegmentCount(role: string) {
  return roleScript.value.segments.filter((segment) => segment.role === role).length
}

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
  const cleanText = generationMode.value === 'role' ? normalizeLineBreaks(text.value).trim() : applyTextCleanup()

  if (activeEngine.value === 'volc' && generationMode.value === 'role') {
    const parsed = parseRoleScript(cleanText)
    const item = await volc.synthesizeRoleStory({
      name: defaultItemName(cleanText),
      text: cleanText,
      segments: parsed.segments,
      roleControls: roleControls.value.map((control) => ({ ...control })),
    })
    if (item && autoPlay.value) await volc.playAudio(item)
  } else if (activeEngine.value === 'volc') {
    const item = await volc.synthesize({
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
    if (item && autoPlay.value) await volc.playAudio(item)
  } else if (activeEngine.value === 'edge') {
    const item = await edge.synthesize({
      text: cleanText,
      voice: selectedEdgeVoice.value,
      voiceName: selectedEdgeVoiceInfo.value.name,
      rate: edgeRate.value,
      pitch: edgePitch.value,
      volume: edgeVolume.value,
    })
    if (item && autoPlay.value) await edge.playAudio(item)
  }
}

function formatTime(date: string | Date) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(date))
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function active(item: HistoryItem) {
  return volc.currentPlayingId.value === item.id && volc.isPlaying.value
}

function engineLabel(engine: TTSEngine) {
  if (engine === 'volc') return '云端'
  return '本地'
}

function engineBadgeClass(engine: TTSEngine, dark = false) {
  if (engine === 'volc') return dark ? 'bg-amber-400 text-zinc-950' : 'bg-amber-100 text-amber-700'
  return dark ? 'bg-sky-400 text-zinc-950' : 'bg-sky-100 text-sky-700'
}

function isRoleStoryControls(controls: HistoryItem['controls']): controls is RoleStoryControls {
  return 'mode' in controls && controls.mode === 'role-story'
}

function isEdgeControls(controls: HistoryItem['controls']): controls is EdgeTTSControls {
  return 'rate' in controls && !('speechRate' in controls)
}
</script>

<template>
  <div class="min-h-screen bg-[#f7f4ef] text-zinc-950">
    <div class="mx-auto grid min-h-screen w-full max-w-7xl grid-cols-1 lg:grid-cols-[1fr_380px]">
      <main class="flex min-h-screen flex-col border-zinc-950/10 bg-[#fbfaf7] px-5 py-5 lg:border-r lg:px-10 lg:py-6">
        <header class="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">Volcengine &middot; Edge</p>
            <h1 class="mt-1 text-3xl font-black tracking-normal text-zinc-950 md:text-4xl">FairyVoice</h1>
          </div>
          <div class="flex items-center gap-3">
            <div class="inline-flex rounded-full border border-zinc-950/10 bg-white shadow-sm">
              <button
                class="rounded-l-full px-3 py-2 text-xs font-bold transition"
                :class="activeEngine === 'volc' ? 'bg-amber-500 text-white' : 'text-zinc-700 hover:bg-zinc-50'"
                @click="activeEngine = 'volc'"
              >云端</button>
              <button
                class="rounded-r-full px-3 py-2 text-xs font-bold transition"
                :class="activeEngine === 'edge' ? 'bg-sky-500 text-white' : 'text-zinc-700 hover:bg-zinc-50'"
                @click="activeEngine = 'edge'"
              >本地</button>
            </div>
            <div class="inline-flex rounded-full border border-zinc-950/10 bg-white shadow-sm">
              <button
                class="rounded-l-full px-3 py-2 text-xs font-bold transition"
                :class="generationMode === 'single' ? 'bg-zinc-950 text-white' : 'text-zinc-700 hover:bg-zinc-50'"
                @click="setGenerationMode('single')"
              >单段</button>
              <button
                class="rounded-r-full px-3 py-2 text-xs font-bold transition"
                :class="generationMode === 'role' ? 'bg-amber-500 text-white' : 'text-zinc-700 hover:bg-zinc-50'"
                @click="setGenerationMode('role')"
              >角色故事</button>
            </div>
            <div class="flex items-center gap-2 rounded-full border border-zinc-950/10 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 shadow-sm">
              <span class="h-2 w-2 rounded-full" :class="isGenerating ? 'bg-amber-500' : errorMsg ? 'bg-red-500' : 'bg-emerald-500'"></span>
              {{ statusText }}
            </div>
          </div>
        </header>

        <!-- Service unavailable warnings -->
        <div v-if="activeEngine === 'edge' && !edge.serverAvailable.value" class="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700">
          Edge TTS 本地服务未启动，请先运行 node server/index.js
        </div>

        <section class="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div class="flex min-h-[440px] flex-col rounded-lg border border-zinc-950/10 bg-white shadow-sm">
            <div class="flex items-center justify-between gap-3 border-b border-zinc-950/10 px-4 py-3">
              <label class="text-sm font-bold text-zinc-900">文案</label>
              <div class="flex items-center gap-3">
                <button
                  v-if="generationMode === 'single'"
                  class="rounded-md border border-zinc-950/10 px-2.5 py-1 text-xs font-bold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="!text.trim()"
                  @click="applyTextCleanup"
                >整理文本</button>
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
              <div v-if="generationMode === 'role'" class="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">
                <p>格式：标题：故事名 / 旁白：月亮慢慢升起来。 / 小兔：妈妈，星星为什么会眨眼睛？</p>
                <p class="mt-1">已识别 {{ roleScript.roles.length }} 个角色、{{ roleScript.segments.length }} 段、{{ roleScript.characterCount }} 字。</p>
              </div>
              <p v-if="textOverflow" class="text-sm font-semibold text-red-600">估算计费字符超出前端限制。</p>
              <p v-else-if="cleanupStatus" class="text-sm font-semibold text-emerald-700">{{ cleanupStatus }}</p>
              <p v-else-if="activeEngine === 'volc' && generationMode === 'single'" class="text-sm text-zinc-500">
                当前音色：{{ selectedVoiceInfo.name }} · {{ selectedVoiceInfo.language }} · {{ selectedVoiceInfo.model }}
              </p>
              <p v-else-if="activeEngine === 'volc' && generationMode === 'role'" class="text-sm text-zinc-500">
                角色故事将按角色表逐段生成，并保存为一个作品。
              </p>
              <p v-else-if="activeEngine === 'edge'" class="text-sm text-zinc-500">
                当前音色：{{ selectedEdgeVoiceInfo.name }} · {{ selectedEdgeVoiceInfo.locale }} · {{ selectedEdgeVoiceInfo.gender }}
              </p>
            </div>
          </div>

          <aside class="space-y-4">
            <!-- Volc engine controls -->
            <template v-if="activeEngine === 'volc'">
              <template v-if="generationMode === 'single'">
              <section class="rounded-lg border border-zinc-950/10 bg-white p-3 shadow-sm">
                <label class="text-sm font-bold text-zinc-900">服务资源</label>
                <select
                  v-model="selectedResourceId"
                  class="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
                >
                  <option v-for="resourceId in volc.availableResourceIds.value" :key="resourceId" :value="resourceId">{{ resourceId }}</option>
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
                  <p>当前资源：{{ selectedResourceId || volc.currentResourceId.value || '读取中' }}</p>
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
                  <p class="mt-1 text-xs font-medium leading-4 text-zinc-500">指定文本语种可提升合成质量；英语音色请选"英文"。</p>
                </section>
              </section>
              </template>

              <template v-else>
                <section class="rounded-lg border border-zinc-950/10 bg-white p-3 shadow-sm">
                  <div class="flex items-center justify-between gap-3">
                    <label class="text-sm font-bold text-zinc-900">角色音色</label>
                    <span class="text-xs font-black text-amber-700">{{ roleScript.roles.length }} 角色 / {{ roleScript.segments.length }} 段</span>
                  </div>
                  <div class="mt-3 space-y-4">
                    <div v-for="control in roleControls" :key="control.role" class="border-t border-zinc-950/10 pt-3 first:border-t-0 first:pt-0">
                      <div class="mb-2 flex items-center justify-between gap-2">
                        <span class="text-sm font-black text-zinc-950">{{ control.role }}</span>
                        <span class="rounded bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">{{ roleSegmentCount(control.role) }} 段</span>
                      </div>
                      <select
                        v-model="control.voice"
                        class="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-900 outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
                        @change="updateRoleVoice(control)"
                      >
                        <optgroup v-for="(voices, scene) in groupedRoleVoices" :key="scene" :label="scene">
                          <option v-for="voice in voices" :key="voice.id" :value="voice.id">
                            {{ voice.name }} · {{ voice.model }}
                          </option>
                        </optgroup>
                      </select>
                      <div class="mt-3 grid grid-cols-3 gap-2">
                        <label class="text-[11px] font-bold text-zinc-600">
                          语速 {{ control.speechRate.toFixed(1) }}x
                          <input v-model.number="control.speechRate" type="range" min="0.5" max="2" step="0.1" class="mt-1 w-full accent-zinc-950" />
                        </label>
                        <label class="text-[11px] font-bold text-zinc-600">
                          音调 {{ control.pitch > 0 ? '+' : '' }}{{ control.pitch }}
                          <input v-model.number="control.pitch" type="range" min="-12" max="12" step="1" class="mt-1 w-full accent-zinc-950" />
                        </label>
                        <label class="text-[11px] font-bold text-zinc-600">
                          音量 {{ control.loudness.toFixed(1) }}x
                          <input v-model.number="control.loudness" type="range" min="0.5" max="2" step="0.1" class="mt-1 w-full accent-zinc-950" />
                        </label>
                      </div>
                      <div class="mt-2 grid grid-cols-[1fr_72px] gap-2">
                        <select
                          v-model="control.emotion"
                          :disabled="roleEmotionOptions(control).length === 0"
                          class="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-semibold outline-none transition disabled:bg-zinc-100 disabled:text-zinc-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/15"
                        >
                          <option value="">默认情绪</option>
                          <option v-for="item in roleEmotionOptions(control)" :key="item" :value="item">{{ EMOTION_LABELS[item] || item }}</option>
                        </select>
                        <input
                          v-model.number="control.emotionScale"
                          type="number"
                          min="1"
                          max="5"
                          :disabled="!control.emotion"
                          class="w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-bold outline-none transition disabled:bg-zinc-100 disabled:text-zinc-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/15"
                        />
                      </div>
                    </div>
                  </div>
                  <label class="mt-3 flex cursor-pointer items-center gap-3 text-sm font-bold text-zinc-800">
                    <input v-model="autoPlay" type="checkbox" class="h-4 w-4 accent-zinc-950" />
                    生成后播放
                  </label>
                </section>

                <section class="rounded-lg border border-zinc-950/10 bg-white p-3 shadow-sm">
                  <label class="text-sm font-bold text-zinc-900">解析预览</label>
                  <div v-if="roleScript.segments.length" class="mt-2 space-y-2">
                    <div v-for="(segment, index) in roleScript.segments.slice(0, 5)" :key="`${segment.role}-${index}`" class="text-xs leading-5 text-zinc-600">
                      <span class="font-black text-zinc-900">{{ segment.role }}</span>
                      <span v-if="segment.isTitle" class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700">标题</span>
                      <span class="mx-1 text-zinc-300">/</span>
                      <span>{{ segment.characterCount }} 字</span>
                      <p class="line-clamp-2">{{ segment.text }}</p>
                    </div>
                    <p v-if="roleScript.segments.length > 5" class="text-xs font-semibold text-zinc-400">还有 {{ roleScript.segments.length - 5 }} 段未显示。</p>
                  </div>
                  <p v-else class="mt-2 text-xs font-semibold leading-5 text-red-600">未识别到可生成的角色台词。</p>
                </section>
              </template>
            </template>

            <!-- Edge engine controls -->
            <template v-else-if="activeEngine === 'edge'">
              <section class="rounded-lg border border-zinc-950/10 bg-white p-3 shadow-sm">
                <label class="text-sm font-bold text-zinc-900">音色</label>
                <select
                  v-model="selectedEdgeVoice"
                  class="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15"
                >
                  <optgroup v-for="(voices, locale) in groupedEdgeVoices" :key="locale" :label="locale">
                    <option v-for="voice in voices" :key="voice.id" :value="voice.id">
                      {{ voice.name }} · {{ voice.gender }}
                    </option>
                  </optgroup>
                </select>
                <div class="mt-2 space-y-1 rounded-md bg-zinc-50 p-2 text-xs font-medium leading-5 text-zinc-600">
                  <p class="break-all">{{ selectedEdgeVoiceInfo.id }}</p>
                  <p>语言：{{ selectedEdgeVoiceInfo.locale }} · {{ selectedEdgeVoiceInfo.gender }}</p>
                </div>
              </section>

              <section class="rounded-lg border border-zinc-950/10 bg-white p-3 shadow-sm">
                <div class="space-y-3">
                  <div>
                    <div class="mb-1 flex justify-between text-sm font-bold">
                      <label>语速</label>
                      <span>{{ edgeRate >= 0 ? '+' : '' }}{{ edgeRate }}%</span>
                    </div>
                    <input v-model.number="edgeRate" type="range" min="-100" max="200" step="10" class="w-full accent-zinc-950" />
                  </div>
                  <div>
                    <div class="mb-1 flex justify-between text-sm font-bold">
                      <label>音调</label>
                      <span>{{ edgePitch >= 0 ? '+' : '' }}{{ edgePitch }}Hz</span>
                    </div>
                    <input v-model.number="edgePitch" type="range" min="-50" max="50" step="5" class="w-full accent-zinc-950" />
                  </div>
                  <div>
                    <div class="mb-1 flex justify-between text-sm font-bold">
                      <label>音量</label>
                      <span>{{ edgeVolume >= 0 ? '+' : '' }}{{ edgeVolume }}%</span>
                    </div>
                    <input v-model.number="edgeVolume" type="range" min="-50" max="50" step="5" class="w-full accent-zinc-950" />
                  </div>
                </div>
              </section>

              <section class="rounded-lg border border-zinc-950/10 bg-white p-3 shadow-sm">
                <label class="text-sm font-bold text-zinc-900">Edge TTS 说明</label>
                <p class="mt-2 text-xs font-medium leading-5 text-zinc-500">
                  免费、无需配置，需启动 Node 服务（端口 5174）。<span class="font-bold text-amber-700">文本语言必须和声音语言一致。</span>
                </p>
                <div v-if="edgeLangMismatch" class="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                  检测到{{ TEXT_LANG_LABEL[detectedLang] || detectedLang }}文本，请切换到对应声音
                </div>
                <label class="mt-3 flex cursor-pointer items-center gap-3 text-sm font-bold text-zinc-800">
                  <input v-model="autoPlay" type="checkbox" class="h-4 w-4 accent-zinc-950" />
                  生成后播放
                </label>
              </section>
            </template>

            <button
              class="flex w-full items-center justify-center gap-3 rounded-lg px-5 py-3 text-base font-black text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-45"
              :class="{
                'bg-zinc-950 shadow-zinc-950/15 hover:bg-zinc-800': activeEngine === 'volc',
                'bg-sky-600 shadow-sky-600/15 hover:bg-sky-500': activeEngine === 'edge',
              }"
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

      <!-- History sidebar -->
      <aside class="flex min-h-screen flex-col bg-[#ece6dc] px-5 py-6 lg:px-6 lg:py-8">
        <div class="mb-5 flex items-center justify-between gap-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.24em] text-zinc-500">Library</p>
            <h2 class="mt-2 text-2xl font-black text-zinc-950">作品</h2>
          </div>
          <button
            v-if="history.length"
            class="rounded-md border border-zinc-950/15 px-3 py-2 text-xs font-bold text-zinc-700 transition hover:bg-white"
            @click="volc.clearHistory()"
          >清空</button>
        </div>

        <!-- Latest item card -->
        <section v-if="latestItem" class="mb-5 rounded-lg border border-zinc-950/10 bg-zinc-950 p-4 text-white shadow-sm">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="rounded px-1.5 py-0.5 text-[10px] font-black" :class="engineBadgeClass(latestItem.engine, true)">{{ engineLabel(latestItem.engine) }}</span>
                <input
                  class="truncate bg-transparent text-sm font-bold outline-none hover:bg-white/10 focus:bg-white/15 rounded px-1 -ml-1 max-w-[200px]"
                  :value="latestItem.name"
                  @change="volc.renameItem(latestItem.id, ($event.target as HTMLInputElement).value || defaultItemName(latestItem.text))"
                  @blur="($event.target as HTMLInputElement).value = ($event.target as HTMLInputElement).value || defaultItemName(latestItem.text)"
                />
              </div>
              <p class="mt-1 text-xs text-white/55">{{ latestItem.voiceName }} · {{ formatTime(latestItem.createdAt) }} · {{ formatSize(latestItem.byteLength) }}</p>
            </div>
            <div class="flex items-center gap-2">
              <button class="rounded-full px-4 py-2 text-sm font-black transition" :class="active(latestItem) ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-amber-400 text-zinc-950 hover:bg-amber-300'" @click="volc.playAudio(active(latestItem) ? null : latestItem)">
                {{ active(latestItem) ? '暂停' : '播放' }}
              </button>
              <button class="rounded-full bg-white/10 px-3 py-2 text-sm font-bold text-white/60 transition hover:bg-red-500/40 hover:text-white" @click="volc.removeHistoryItem(latestItem.id)">删除</button>
            </div>
          </div>
          <p class="mt-4 line-clamp-3 text-sm leading-6 text-white/75">{{ latestItem.text }}</p>
          <p v-if="isRoleStoryControls(latestItem.controls)" class="mt-3 text-xs font-semibold text-amber-200">
            角色故事：{{ (latestItem.controls as RoleStoryControls).roles.length }} 角色 · {{ (latestItem.controls as RoleStoryControls).segmentCount }} 段
          </p>
          <p v-if="volc.lastUsage.value?.text_words" class="mt-4 text-xs font-semibold text-amber-200">计费字符：{{ volc.lastUsage.value.text_words }}</p>
        </section>

        <!-- History list -->
        <div v-if="history.length" class="space-y-3 overflow-y-auto pr-1">
          <article
            v-for="item in history"
            :key="item.id"
            class="rounded-lg border bg-white p-4 shadow-sm transition"
            :class="active(item) ? 'border-amber-500' : 'border-zinc-950/10 hover:border-zinc-950/25'"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="rounded px-1.5 py-0.5 text-[10px] font-black" :class="engineBadgeClass(item.engine)">{{ engineLabel(item.engine) }}</span>
                  <input
                    class="truncate bg-transparent text-sm font-black text-zinc-900 outline-none hover:bg-zinc-100 focus:bg-zinc-100 rounded px-1 -ml-1 max-w-[180px]"
                    :value="item.name"
                    @change="volc.renameItem(item.id, ($event.target as HTMLInputElement).value || defaultItemName(item.text))"
                    @blur="($event.target as HTMLInputElement).value = ($event.target as HTMLInputElement).value || defaultItemName(item.text)"
                  />
                </div>
                <p class="mt-1 text-xs font-semibold text-zinc-500">{{ item.voiceName }} · {{ formatTime(item.createdAt) }} · {{ formatSize(item.byteLength) }}</p>
              </div>
              <button class="rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-black text-zinc-900 transition hover:bg-amber-300" @click="volc.playAudio(active(item) ? null : item)">
                {{ active(item) ? '停' : '播' }}
              </button>
            </div>
            <p class="mt-3 line-clamp-2 text-sm leading-6 text-zinc-600">{{ item.text }}</p>
            <div class="mt-4 flex flex-wrap items-center gap-2 text-xs font-bold text-zinc-500">
              <template v-if="isRoleStoryControls(item.controls)">
                <span class="rounded bg-amber-100 px-2 py-1 text-amber-700">角色故事</span>
                <span class="rounded bg-zinc-100 px-2 py-1">{{ (item.controls as RoleStoryControls).roles.length }} 角色</span>
                <span class="rounded bg-zinc-100 px-2 py-1">{{ (item.controls as RoleStoryControls).segmentCount }} 段</span>
              </template>
              <template v-else-if="isEdgeControls(item.controls)">
                <span class="rounded bg-zinc-100 px-2 py-1">速率 {{ (item.controls as EdgeTTSControls).rate >= 0 ? '+' : '' }}{{ (item.controls as EdgeTTSControls).rate }}%</span>
                <span class="rounded bg-zinc-100 px-2 py-1">音调 {{ (item.controls as EdgeTTSControls).pitch >= 0 ? '+' : '' }}{{ (item.controls as EdgeTTSControls).pitch }}Hz</span>
              </template>
              <template v-else>
                <span class="rounded bg-zinc-100 px-2 py-1">{{ (item.controls as TTSControls).speechRate?.toFixed(1) ?? '1.0' }}x</span>
                <span class="rounded bg-zinc-100 px-2 py-1">pitch {{ (item.controls as TTSControls).pitch ?? 0 }}</span>
                <span v-if="(item.controls as TTSControls).emotion" class="rounded bg-zinc-100 px-2 py-1">{{ EMOTION_LABELS[(item.controls as TTSControls).emotion!] || (item.controls as TTSControls).emotion }}</span>
                <span v-if="(item.controls as TTSControls).explicitLanguage" class="rounded bg-zinc-100 px-2 py-1">{{ LANGUAGE_OPTIONS.find(o => o.value === (item.controls as TTSControls).explicitLanguage!)?.label || (item.controls as TTSControls).explicitLanguage }}</span>
              </template>
              <button class="ml-auto rounded-md px-2 py-1 text-zinc-800 transition hover:bg-zinc-100" @click="volc.revealInFolder(item)">定位</button>
              <button class="rounded-md px-2 py-1 text-red-600 transition hover:bg-red-50" @click="volc.removeHistoryItem(item.id)">删除</button>
            </div>
          </article>
        </div>

        <div v-else class="flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-950/20 bg-white/40 p-8 text-center text-sm font-semibold leading-6 text-zinc-500">
          生成的音频会出现在这里。
        </div>
      </aside>
    </div>

    <!-- API Guide Section -->
    <footer class="mx-auto w-full max-w-7xl border-t border-zinc-950/10 bg-[#fbfaf7] px-5 py-10 lg:px-10">
      <h2 class="mb-6 text-2xl font-black text-zinc-950">服务说明与使用指南</h2>
      <div class="grid gap-6 lg:grid-cols-2">

        <!-- 火山引擎 -->
        <section class="rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
          <div class="mb-4 flex items-center gap-3">
            <span class="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-lg">☁️</span>
            <div>
              <h3 class="text-lg font-black text-zinc-950">火山引擎 · 语音合成大模型</h3>
              <p class="text-xs font-semibold text-amber-600">付费 · 高品质 · 云端 API</p>
            </div>
          </div>

          <div class="mb-4 space-y-2 text-sm leading-6 text-zinc-700">
            <p>字节跳动旗下开放语音平台，提供业界领先的语音合成大模型，音质自然、表现力强，支持情感控制与声音复刻。</p>
          </div>

          <div class="mb-4 overflow-x-auto">
            <table class="w-full text-xs font-semibold">
              <thead>
                <tr class="border-b border-zinc-200 text-left text-zinc-500">
                  <th class="pb-2 pr-3">资源 ID</th>
                  <th class="pb-2 pr-3">说明</th>
                  <th class="pb-2 pr-3">音色数</th>
                  <th class="pb-2">特点</th>
                </tr>
              </thead>
              <tbody class="text-zinc-800">
                <tr class="border-b border-zinc-100">
                  <td class="py-2 pr-3"><code class="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">seed-tts-2.0</code></td>
                  <td class="py-2 pr-3">语音合成 2.0</td>
                  <td class="py-2 pr-3">16</td>
                  <td class="py-2">含精品克隆音色，最新模型，推荐首选</td>
                </tr>
                <tr class="border-b border-zinc-100">
                  <td class="py-2 pr-3"><code class="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-700">seed-tts-1.0</code></td>
                  <td class="py-2 pr-3">语音合成 1.0</td>
                  <td class="py-2 pr-3">18</td>
                  <td class="py-2">经典模型，音色最多，可多音色选择</td>
                </tr>
                <tr>
                  <td class="py-2 pr-3"><code class="rounded bg-violet-50 px-1.5 py-0.5 text-violet-700">seed-icl-2.0</code></td>
                  <td class="py-2 pr-3">声音复刻 2.0</td>
                  <td class="py-2 pr-3">—</td>
                  <td class="py-2">克隆自己的声音，需单独开通并训练音色</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-xs font-semibold leading-5 text-amber-800">
            <p class="mb-1">💰 <strong>计费方式</strong>：按合成字符数计费，前端单次上限 5000 字。</p>
            <p>💡 新用户通常有免费体验额度，具体价格请以<a href="https://www.volcengine.com/docs/6561/1263507" target="_blank" class="underline">火山引擎官方计费文档</a>为准。</p>
          </div>

          <div>
            <h4 class="mb-2 text-sm font-black text-zinc-900">🚀 如何开通</h4>
            <ol class="list-inside list-decimal space-y-1.5 text-xs font-medium leading-5 text-zinc-700">
              <li>访问 <a href="https://console.volcengine.com/speech/service" target="_blank" class="font-bold text-amber-700 underline">火山引擎语音服务控制台</a>，注册并登录。</li>
              <li>在「服务管理」中开通所需的资源（推荐先开通 <code class="rounded bg-amber-50 px-1">seed-tts-2.0</code>）。</li>
              <li>进入「API Key 管理」，创建一个 API Key 并复制。</li>
              <li>打开本项目的 <code class="rounded bg-zinc-100 px-1">web/public/config.json</code>，填入你的 API Key 和 Resource ID。</li>
              <li>重启前端开发服务器，即可使用。</li>
            </ol>
          </div>

          <div class="mt-4">
            <h4 class="mb-2 text-sm font-black text-zinc-900">🎙️ 音色使用说明</h4>
            <ul class="list-inside list-disc space-y-1.5 text-xs font-medium leading-5 text-zinc-700">
              <li><strong>官方音色</strong>：内置 20 个 2.0 音色 + 18 个 1.0 多情感音色，下拉框按场景分组，直接选择即可。</li>
              <li><strong>音色与资源对应</strong>：2.0 音色用 <code class="rounded bg-amber-50 px-1">seed-tts-2.0</code>，1.0 音色用 <code class="rounded bg-zinc-100 px-1">seed-tts-1.0</code>。切换「服务资源」后下拉只显示该资源可用的音色。</li>
              <li><strong>声音复刻（克隆自己的声音）</strong>：先在控制台「声音复刻」训练音色拿到 ID（形如 <code class="rounded bg-zinc-100 px-1">S_xxxx</code>），再填入 <code class="rounded bg-zinc-100 px-1">config.json</code> 的 <code class="rounded bg-zinc-100 px-1">cloneVoices</code> 数组，刷新页面后在「声音复刻」分组中选择。配置示例：</li>
            </ul>
            <pre class="mt-2 overflow-x-auto rounded-md bg-zinc-900 p-3 text-[11px] leading-5 text-zinc-100"><code>"cloneVoices": [
  { "id": "S_xxxxxxxxxxxxxxxx", "name": "我的声音", "description": "本人录制" },
  { "id": "S_yyyyyyyyyyyyyyyy", "name": "妈妈的声音", "description": "" }
]</code></pre>
            <p class="mt-2 text-[11px] font-medium leading-5 text-zinc-500">💡 复刻音色必须把「服务资源」切到 <code class="rounded bg-violet-50 px-1">seed-icl-2.0</code> 才能调用；填几个音色，列表里就显示几个。</p>
          </div>

          <div class="mt-3 flex flex-wrap gap-2">
            <a href="https://www.volcengine.com/docs/6561/1257544" target="_blank" class="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 transition hover:bg-amber-200">📖 音色列表文档</a>
            <a href="https://www.volcengine.com/docs/6561/1598757" target="_blank" class="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 transition hover:bg-amber-200">📖 V3 接口文档</a>
          </div>
        </section>

        <!-- Edge TTS -->
        <section class="rounded-xl border border-sky-200 bg-white p-6 shadow-sm">
          <div class="mb-4 flex items-center gap-3">
            <span class="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 text-lg">🎧</span>
            <div>
              <h3 class="text-lg font-black text-zinc-950">Microsoft Edge · 大声朗读</h3>
              <p class="text-xs font-semibold text-sky-600">免费 · 无需配置 · 本地代理</p>
            </div>
          </div>

          <div class="mb-4 space-y-2 text-sm leading-6 text-zinc-700">
            <p>利用 Edge 浏览器内置的「大声朗读」功能，通过 WebSocket 协议调用微软 Bing 语音合成服务，生成 Neural 高品质语音。</p>
          </div>

          <div class="mb-4 overflow-x-auto">
            <table class="w-full text-xs font-semibold">
              <thead>
                <tr class="border-b border-zinc-200 text-left text-zinc-500">
                  <th class="pb-2 pr-3">特性</th>
                  <th class="pb-2">详情</th>
                </tr>
              </thead>
              <tbody class="text-zinc-800">
                <tr class="border-b border-zinc-100">
                  <td class="py-2 pr-3">支持语言</td>
                  <td class="py-2">中文（普通话/粤语/台湾）、英语、日语、韩语、法语等</td>
                </tr>
                <tr class="border-b border-zinc-100">
                  <td class="py-2 pr-3">语音品质</td>
                  <td class="py-2">Neural 神经网络语音，自然流畅</td>
                </tr>
                <tr class="border-b border-zinc-100">
                  <td class="py-2 pr-3">参数调节</td>
                  <td class="py-2">语速（±200%）、音调（±50Hz）、音量（±50%）</td>
                </tr>
                <tr>
                  <td class="py-2 pr-3">限制</td>
                  <td class="py-2">⚠️ 文本语言必须和所选声音语言一致，否则合成效果差</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="mb-4 rounded-lg bg-sky-50 px-4 py-3 text-xs font-semibold leading-5 text-sky-800">
            <p>💰 <strong>完全免费</strong>，无需注册账号、无需 API Key，无字符数限制。</p>
            <p class="mt-1">⚠️ 属于非官方接口，大量调用可能被限制频率，请合理使用。</p>
          </div>

          <div>
            <h4 class="mb-2 text-sm font-black text-zinc-900">🚀 如何使用</h4>
            <ol class="list-inside list-decimal space-y-1.5 text-xs font-medium leading-5 text-zinc-700">
              <li>确保已安装 Node.js。</li>
              <li>双击项目根目录的 <code class="rounded bg-zinc-100 px-1">start.bat</code>，它会自动启动 Edge TTS 服务器和前端。</li>
              <li>或手动启动：在 <code class="rounded bg-zinc-100 px-1">web/</code> 目录下运行 <code class="rounded bg-zinc-100 px-1">node server/index.js</code>，再运行 <code class="rounded bg-zinc-100 px-1">npm run dev</code>。</li>
              <li>在页面中切换到「本地」引擎，选择声音即可使用。</li>
            </ol>
          </div>

          <div class="mt-3 flex flex-wrap gap-2">
            <a href="https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4" target="_blank" class="inline-flex items-center gap-1 rounded-md bg-sky-100 px-2.5 py-1 text-xs font-bold text-sky-800 transition hover:bg-sky-200">📖 完整语音列表</a>
          </div>
        </section>

      </div>

      <!-- 选择建议 -->
      <div class="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h3 class="mb-3 text-base font-black text-zinc-950">📌 如何选择？</h3>
        <div class="grid gap-4 text-xs font-medium leading-6 text-zinc-700 sm:grid-cols-3">
          <div class="rounded-lg bg-amber-50 px-4 py-3">
            <p class="mb-1 text-sm font-black text-amber-800">追求最高音质</p>
            <p>选择「云端」→ <code>seed-tts-2.0</code>，含精品克隆音色，音质自然且支持情感控制。</p>
          </div>
          <div class="rounded-lg bg-sky-50 px-4 py-3">
            <p class="mb-1 text-sm font-black text-sky-800">免费快速使用</p>
            <p>选择「本地」→ Edge TTS，零配置、零成本，中文 Neural 语音效果也不错。</p>
          </div>
          <div class="rounded-lg bg-violet-50 px-4 py-3">
            <p class="mb-1 text-sm font-black text-violet-800">声音复刻需求</p>
            <p>在火山引擎控制台上传音频样本完成声音复刻，使用 <code>seed-icl-2.0</code> 资源调用。</p>
          </div>
        </div>
      </div>

      <p class="mt-6 text-center text-xs font-semibold text-zinc-400">FairyVoice 纯净配音舱 · 让每一段文字都有温度</p>
    </footer>
  </div>
</template>
