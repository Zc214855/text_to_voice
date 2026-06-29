<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { EMOTION_LABELS, MAX_TEXT_LENGTH, concatBlobsWithSilence, useTTS } from '../composables/useTTS'
import { defaultItemName, useSharedHistory } from '../composables/useSharedHistory'
import { useEdgeTTS } from '../composables/useEdgeTTS'
import { countTextUnits, normalizeLineBreaks } from '../utils/textCleanup'
import { parseRoleScript, parseVoiceMeta } from '../utils/roleScript'
import { recommendUnifiedVoices, type CandidateEngine, type UnifiedVoiceCandidate } from '../utils/voicePlanner'
import type { HistoryItem, RoleStoryControls, RoleStoryVoiceControls, TTSEngine } from '../composables/types'

interface RoleVoiceControl {
  role: string
  candidateKey: string
  engine: CandidateEngine
  voice: string
  voiceName: string
  resourceId: string
  detail: string
  speechRate: number
  pitch: number
  loudness: number
  emotion: string
  emotionScale: number
  explicitLanguage: string
}

const DEFAULT_TEXT = `标题：小兔和星星

旁白：月亮慢慢升起来，森林边的小窗亮着一小点暖光。
旁白：小兔把耳朵贴在枕头上，小声问妈妈。
小兔：星星为什么会眨眼睛？
妈妈：因为它们在很远很远的地方，轻轻给你说晚安。
旁白：小兔笑了，把被角拉到下巴下面。
小兔：那我也给星星说晚安。
旁白：窗外的风慢慢小了，星星一闪一闪，像把梦轻轻送进屋里。

[角色音色]
旁白：女声、成年、温柔朗读、偏慢
小兔：不限、幼童、安静好奇、偏慢
妈妈：女声、成年、日常温柔、中等
[/角色音色]`

const volc = useTTS()
const edge = useEdgeTTS()
const shared = useSharedHistory()

const text = ref(DEFAULT_TEXT)
const autoPlay = ref(true)
const roleControls = ref<RoleVoiceControl[]>([])
const configError = ref('')
const errorMsg = ref('')
const statusText = ref('就绪')
const isGenerating = ref(false)
const lastUsageWords = ref<number | null>(null)

const history = shared.history
const latestItem = computed(() => history.value[0] || null)

const normalizedText = computed(() => normalizeLineBreaks(text.value))
const voiceMetaResult = computed(() => parseVoiceMeta(normalizedText.value.trim()))
const storyText = computed(() => voiceMetaResult.value?.storyText || normalizedText.value.trim())
const parsedVoiceMeta = computed(() => voiceMetaResult.value?.metas || [])
const roleScript = computed(() => parseRoleScript(storyText.value))
const storyRoles = computed(() => {
  const roles: string[] = []
  const seen = new Set<string>()
  for (const segment of roleScript.value.segments) {
    if (!seen.has(segment.role)) {
      seen.add(segment.role)
      roles.push(segment.role)
    }
  }
  return roles
})

const textLength = computed(() => countTextUnits(normalizedText.value))
const estimatedBillableCount = computed(() => countTextUnits(storyText.value))
const textOverflow = computed(() => estimatedBillableCount.value > MAX_TEXT_LENGTH)

const roleAvailableVoices = computed(() => {
  const resourceIds = volc.availableResourceIds.value
  if (resourceIds.length === 0) return volc.volcVoices.value
  return volc.volcVoices.value.filter((voice) => voice.resourceIds.some((resourceId) => resourceIds.includes(resourceId)))
})

const roleDescriptorMap = computed(() => {
  return new Map(parsedVoiceMeta.value.map((meta) => [meta.role, meta.descriptor]))
})

const roleVoiceCandidates = computed<Record<string, UnifiedVoiceCandidate[]>>(() => {
  const result: Record<string, UnifiedVoiceCandidate[]> = {}
  for (const role of storyRoles.value) {
    result[role] = recommendUnifiedVoices({
      role,
      descriptor: roleDescriptorMap.value.get(role),
      volcVoices: roleAvailableVoices.value,
      edgeVoices: edge.edgeVoices,
    })
  }
  return result
})

const candidateSignature = computed(() => {
  return storyRoles.value
    .map((role) => `${role}:${roleVoiceCandidates.value[role]?.slice(0, 12).map((candidate) => candidate.key).join('|') || ''}`)
    .join('\n')
})

const usesEdge = computed(() => roleControls.value.some((control) => control.engine === 'edge'))
const usesVolc = computed(() => roleControls.value.some((control) => control.engine === 'volc'))
const roleStoryReady = computed(() => {
  if (roleScript.value.segments.length === 0) return false
  return storyRoles.value.every((role) => roleControls.value.some((control) => control.role === role && control.voice))
})
const canGenerate = computed(() => {
  return Boolean(storyText.value) &&
    !textOverflow.value &&
    roleStoryReady.value &&
    !isGenerating.value &&
    (!usesEdge.value || edge.serverAvailable.value)
})

const planSummary = computed(() => {
  if (roleControls.value.length === 0) return '等待角色文本'
  const volcCount = roleControls.value.filter((control) => control.engine === 'volc').length
  const edgeCount = roleControls.value.length - volcCount
  if (volcCount && edgeCount) return `智能混合：云端 ${volcCount} 角色 / 本地 ${edgeCount} 角色`
  if (volcCount) return `推荐云端：${volcCount} 角色`
  return `推荐本地：${edgeCount} 角色`
})

onMounted(() => {
  shared.restoreHistory()
  volc.refreshConfig()
    .catch((err: unknown) => {
      configError.value = err instanceof Error ? err.message : '配置加载失败'
    })
  edge.checkServer()
})

watch([
  () => storyRoles.value.join('\u0000'),
  candidateSignature,
], syncRoleControls, { immediate: true })

function candidateForKey(role: string, key: string) {
  return roleVoiceCandidates.value[role]?.find((candidate) => candidate.key === key)
}

function createRoleControl(role: string): RoleVoiceControl {
  const candidate = roleVoiceCandidates.value[role]?.[0]
  if (!candidate) {
    return {
      role,
      candidateKey: '',
      engine: 'volc',
      voice: '',
      voiceName: '',
      resourceId: '',
      detail: '',
      speechRate: 0.9,
      pitch: 0,
      loudness: 1,
      emotion: '',
      emotionScale: 4,
      explicitLanguage: 'zh-cn',
    }
  }
  return controlFromCandidate(role, candidate)
}

function controlFromCandidate(role: string, candidate: UnifiedVoiceCandidate): RoleVoiceControl {
  return {
    role,
    candidateKey: candidate.key,
    engine: candidate.engine,
    voice: candidate.voice,
    voiceName: candidate.voiceName,
    resourceId: candidate.resourceId,
    detail: candidate.detail,
    speechRate: candidate.speechRate,
    pitch: candidate.pitch,
    loudness: candidate.loudness,
    emotion: candidate.emotion,
    emotionScale: candidate.emotionScale,
    explicitLanguage: candidate.explicitLanguage,
  }
}

function syncRoleControls() {
  const existing = new Map(roleControls.value.map((control) => [control.role, control]))
  roleControls.value = storyRoles.value.map((role) => {
    const current = existing.get(role)
    if (!current) return createRoleControl(role)

    const candidate = candidateForKey(role, current.candidateKey)
    if (!candidate) return createRoleControl(role)

    return {
      ...current,
      engine: candidate.engine,
      voice: candidate.voice,
      voiceName: candidate.voiceName,
      resourceId: candidate.resourceId,
      detail: candidate.detail,
      emotion: candidate.engine === 'volc' ? current.emotion : '',
      explicitLanguage: candidate.engine === 'volc' ? current.explicitLanguage : 'zh-cn',
    }
  })
}

function selectCandidate(control: RoleVoiceControl, candidate: UnifiedVoiceCandidate) {
  Object.assign(control, controlFromCandidate(control.role, candidate))
}

function handleCandidateChange(control: RoleVoiceControl) {
  const candidate = candidateForKey(control.role, control.candidateKey)
  if (candidate) selectCandidate(control, candidate)
}

function roleEmotionOptions(control: RoleVoiceControl) {
  if (control.engine !== 'volc') return []
  const voice = roleAvailableVoices.value.find((item) => item.id === control.voice)
  return voice?.emotions || []
}

function roleSegmentCount(role: string) {
  return roleScript.value.segments.filter((segment) => segment.role === role).length
}

function engineLabel(engine: CandidateEngine | TTSEngine) {
  if (engine === 'volc') return '云端'
  if (engine === 'edge') return '本地'
  return '混合'
}

function engineClass(engine: CandidateEngine) {
  return engine === 'volc'
    ? 'bg-amber-100 text-amber-800 border-amber-200'
    : 'bg-sky-100 text-sky-800 border-sky-200'
}

function compactReasons(candidate: UnifiedVoiceCandidate) {
  return candidate.reasons.slice(0, 3).join(' / ') || '推荐'
}

function optionLabel(candidate: UnifiedVoiceCandidate, index: number) {
  const prefix = index < 8 ? `推荐${index + 1}` : '候选'
  return `${prefix} · ${engineLabel(candidate.engine)} · ${candidate.voiceName} · ${candidate.detail}`
}

function toRoleStoryControl(control: RoleVoiceControl): RoleStoryVoiceControls {
  return {
    role: control.role,
    engine: control.engine,
    voice: control.voice,
    voiceName: control.voiceName,
    resourceId: control.resourceId,
    speechRate: control.speechRate,
    pitch: control.pitch,
    loudness: control.loudness,
    emotion: control.engine === 'volc' ? control.emotion : '',
    emotionScale: control.engine === 'volc' ? control.emotionScale : 4,
    explicitLanguage: control.engine === 'volc' ? control.explicitLanguage : 'zh-cn',
  }
}

async function handleGenerate() {
  if (!canGenerate.value) return

  const controls = new Map(roleControls.value.map((control) => [control.role, control]))
  const blobs: Blob[] = []
  let usageWords = 0
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), 180_000)

  isGenerating.value = true
  errorMsg.value = ''
  configError.value = ''
  lastUsageWords.value = null
  statusText.value = '准备角色方案'

  try {
    if (usesEdge.value) {
      await edge.checkServer()
      if (!edge.serverAvailable.value) {
        throw new Error('本地 Edge TTS 服务未启动，请先运行 start.bat 或 node server/index.js')
      }
    }

    const volcConfig = usesVolc.value ? await volc.refreshConfig() : undefined

    for (let index = 0; index < roleScript.value.segments.length; index += 1) {
      const segment = roleScript.value.segments[index]
      const control = controls.get(segment.role)
      if (!control) throw new Error(`角色「${segment.role}」缺少音色配置`)

      statusText.value = `生成片段 ${index + 1} / ${roleScript.value.segments.length} · ${segment.role}`

      if (control.engine === 'edge') {
        const blob = await edge.synthesizeAudioOnly({
          text: segment.text,
          voice: control.voice,
          rate: Math.round((control.speechRate - 1) * 100),
          pitch: Math.round(control.pitch),
          volume: Math.round((control.loudness - 1) * 100),
          storyMode: true,
          signal: controller.signal,
        })
        blobs.push(blob)
        usageWords += segment.characterCount
      } else {
        const result = await volc.synthesizeAudioOnly({
          text: segment.text,
          voice: control.voice,
          voiceName: control.voiceName,
          resourceId: control.resourceId,
          speechRate: control.speechRate,
          pitch: control.pitch,
          loudness: control.loudness,
          emotion: control.emotion,
          emotionScale: control.emotionScale,
          explicitLanguage: control.explicitLanguage,
          signal: controller.signal,
        }, volcConfig)
        blobs.push(result.blob)
        usageWords += result.usage?.text_words ?? segment.characterCount
      }
    }

    statusText.value = '合并角色音频'
    const blob = await concatBlobsWithSilence(blobs, 400)
    const engines = new Set(roleControls.value.map((control) => control.engine))
    const engine = (engines.size > 1 ? 'mixed' : roleControls.value[0]?.engine || 'volc') as TTSEngine
    const requestId = `role-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const item: HistoryItem = {
      id: requestId,
      engine,
      name: defaultItemName(storyText.value),
      text: storyText.value,
      voice: 'role-story',
      voiceName: `${engineLabel(engine)}角色故事 · ${roleControls.value.length} 角色`,
      fileName: '',
      byteLength: blob.size,
      requestId,
      createdAt: new Date().toISOString(),
      controls: {
        mode: 'role-story',
        roles: roleControls.value.map(toRoleStoryControl),
        segmentCount: roleScript.value.segments.length,
        characterCount: roleScript.value.characterCount,
      } as RoleStoryControls,
    }

    statusText.value = '保存作品'
    const saved = await shared.addItem(item, blob, 'audio/wav')
    if (!saved) throw new Error('音频已生成但保存失败，请检查本地服务或 output 目录权限')

    lastUsageWords.value = usageWords
    statusText.value = '完成'
    if (autoPlay.value) await shared.playAudio(saved)
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      errorMsg.value = '请求超时'
    } else {
      errorMsg.value = error instanceof Error ? error.message : '合成失败'
    }
    statusText.value = '失败'
  } finally {
    window.clearTimeout(timeoutId)
    isGenerating.value = false
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
  return shared.currentPlayingId.value === item.id && shared.isPlaying.value
}

function isRoleStoryControls(controls: HistoryItem['controls']): controls is RoleStoryControls {
  return 'mode' in controls && controls.mode === 'role-story'
}
</script>

<template>
  <div class="min-h-screen bg-[#f4f0e8] text-zinc-950">
    <div class="mx-auto grid min-h-screen w-full max-w-7xl grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
      <main class="flex min-h-screen flex-col border-zinc-950/10 bg-[#fbfaf7] px-5 py-5 lg:border-r lg:px-10 lg:py-7">
        <header class="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">FairyVoice Role Studio</p>
            <h1 class="mt-1 text-3xl font-black tracking-normal text-zinc-950 md:text-4xl">睡前故事分音</h1>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <div class="rounded-md border border-zinc-950/10 bg-white px-3 py-2 text-xs font-black text-zinc-700 shadow-sm">
              {{ planSummary }}
            </div>
            <div class="flex items-center gap-2 rounded-md border border-zinc-950/10 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 shadow-sm">
              <span class="h-2 w-2 rounded-full" :class="isGenerating ? 'bg-amber-500' : errorMsg ? 'bg-red-500' : 'bg-emerald-500'"></span>
              {{ statusText }}
            </div>
          </div>
        </header>

        <div v-if="usesEdge && !edge.serverAvailable.value" class="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700">
          当前方案包含本地音色，请先启动 Edge TTS 本地服务。
        </div>

        <section class="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div class="flex min-h-[620px] flex-col rounded-lg border border-zinc-950/10 bg-white shadow-sm">
            <div class="flex items-center justify-between gap-3 border-b border-zinc-950/10 px-4 py-3">
              <label class="text-sm font-bold text-zinc-900">角色故事文本</label>
              <span class="text-xs font-bold" :class="textOverflow ? 'text-red-600' : 'text-zinc-500'">
                估算 {{ estimatedBillableCount }} / {{ MAX_TEXT_LENGTH }}
              </span>
            </div>
            <textarea
              v-model="text"
              class="min-h-[390px] flex-1 resize-none bg-transparent px-5 py-4 text-base leading-8 text-zinc-900 outline-none placeholder:text-zinc-400"
              placeholder="标题：故事名&#10;&#10;旁白：月亮慢慢升起来。&#10;小兔：晚安。&#10;&#10;[角色音色]&#10;旁白：女声、成年、温柔朗读、偏慢&#10;[/角色音色]"
            ></textarea>
            <div class="border-t border-zinc-950/10 px-4 py-3">
              <div class="mb-3 grid grid-cols-3 gap-2 text-xs font-semibold text-zinc-600">
                <div class="rounded bg-zinc-50 px-2 py-1.5">原文 {{ textLength }}</div>
                <div class="rounded bg-zinc-50 px-2 py-1.5" :class="textOverflow ? 'text-red-600' : ''">计费 {{ estimatedBillableCount }}</div>
                <div class="rounded bg-zinc-50 px-2 py-1.5">{{ storyRoles.length }} 角色 / {{ roleScript.segments.length }} 段</div>
              </div>
              <p v-if="parsedVoiceMeta.length" class="text-sm font-semibold text-emerald-700">
                已读取 [角色音色]，优先按角色描述推荐音色和参数。
              </p>
              <p v-else-if="roleScript.segments.length" class="text-sm font-semibold text-zinc-500">
                未提供 [角色音色]，已按角色名自动推荐。
              </p>
              <p v-else class="text-sm font-semibold text-red-600">未识别到可生成的角色台词。</p>
              <p v-if="textOverflow" class="mt-2 text-sm font-semibold text-red-600">文本超过单次合成上限。</p>
            </div>
          </div>

          <aside class="space-y-4">
            <section class="rounded-lg border border-zinc-950/10 bg-white p-3 shadow-sm">
              <div class="flex items-center justify-between gap-3">
                <h2 class="text-sm font-black text-zinc-950">角色推荐</h2>
                <span class="text-xs font-bold text-zinc-500">{{ roleControls.length }} 个角色</span>
              </div>

              <div v-if="roleControls.length" class="mt-3 space-y-4">
                <div v-for="control in roleControls" :key="control.role" class="border-t border-zinc-950/10 pt-3 first:border-t-0 first:pt-0">
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-black text-zinc-950">{{ control.role }}</span>
                        <span class="rounded border px-1.5 py-0.5 text-[10px] font-black" :class="engineClass(control.engine)">
                          {{ engineLabel(control.engine) }}
                        </span>
                      </div>
                      <p class="mt-1 truncate text-[11px] font-semibold text-zinc-500">{{ control.voiceName }} · {{ control.detail }}</p>
                    </div>
                    <span class="shrink-0 rounded bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">{{ roleSegmentCount(control.role) }} 段</span>
                  </div>

                  <div class="mb-2 flex flex-wrap gap-1.5">
                    <button
                      v-for="candidate in (roleVoiceCandidates[control.role] || []).slice(0, 3)"
                      :key="candidate.key"
                      class="rounded-md border px-2 py-1 text-[11px] font-bold transition hover:bg-zinc-50"
                      :class="candidate.key === control.candidateKey ? 'border-zinc-950 bg-zinc-950 text-white' : 'border-zinc-950/10 text-zinc-700'"
                      :title="compactReasons(candidate)"
                      @click="selectCandidate(control, candidate)"
                    >
                      {{ engineLabel(candidate.engine) }} · {{ candidate.voiceName }}
                    </button>
                  </div>

                  <select
                    v-model="control.candidateKey"
                    class="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-900 outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
                    @change="handleCandidateChange(control)"
                  >
                    <option
                      v-for="(candidate, index) in roleVoiceCandidates[control.role] || []"
                      :key="candidate.key"
                      :value="candidate.key"
                    >
                      {{ optionLabel(candidate, index) }}
                    </option>
                  </select>

                  <p class="mt-2 text-[11px] font-semibold leading-4 text-zinc-500">
                    {{ compactReasons(candidateForKey(control.role, control.candidateKey) || (roleVoiceCandidates[control.role] || [])[0]) }}
                  </p>

                  <div class="mt-3 grid grid-cols-3 gap-2">
                    <label class="text-[11px] font-bold text-zinc-600">
                      语速 {{ control.speechRate.toFixed(2) }}x
                      <input v-model.number="control.speechRate" type="range" min="0.65" max="1.25" step="0.01" class="mt-1 w-full accent-zinc-950" />
                    </label>
                    <label class="text-[11px] font-bold text-zinc-600">
                      音调 {{ control.pitch > 0 ? '+' : '' }}{{ control.pitch }}
                      <input
                        v-model.number="control.pitch"
                        type="range"
                        :min="control.engine === 'edge' ? -50 : -12"
                        :max="control.engine === 'edge' ? 50 : 12"
                        step="1"
                        class="mt-1 w-full accent-zinc-950"
                      />
                    </label>
                    <label class="text-[11px] font-bold text-zinc-600">
                      音量 {{ control.loudness.toFixed(2) }}x
                      <input v-model.number="control.loudness" type="range" min="0.7" max="1.3" step="0.01" class="mt-1 w-full accent-zinc-950" />
                    </label>
                  </div>

                  <div v-if="control.engine === 'volc'" class="mt-2 grid grid-cols-[1fr_72px] gap-2">
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

              <p v-else class="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs font-bold leading-5 text-red-700">请粘贴角色分音格式文本。</p>
            </section>

            <section class="rounded-lg border border-zinc-950/10 bg-white p-3 shadow-sm">
              <div class="flex items-center justify-between gap-3">
                <label class="flex cursor-pointer items-center gap-3 text-sm font-bold text-zinc-800">
                  <input v-model="autoPlay" type="checkbox" class="h-4 w-4 accent-zinc-950" />
                  生成后播放
                </label>
                <span v-if="lastUsageWords" class="text-xs font-bold text-amber-700">计费 {{ lastUsageWords }}</span>
              </div>
              <p class="mt-2 text-xs font-medium leading-5 text-zinc-500">
                克隆音色继续从 <code class="rounded bg-zinc-100 px-1">config.json</code> 的 <code class="rounded bg-zinc-100 px-1">cloneVoices</code> 读取，并参与云端推荐。
              </p>
            </section>

            <button
              class="flex w-full items-center justify-center gap-3 rounded-lg bg-zinc-950 px-5 py-3 text-base font-black text-white shadow-lg shadow-zinc-950/15 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-45"
              :disabled="!canGenerate"
              @click="handleGenerate"
            >
              <span v-if="isGenerating" class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
              {{ isGenerating ? '生成中' : '生成角色音频' }}
            </button>

            <p v-if="configError" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{{ configError }}</p>
            <p v-if="errorMsg && errorMsg !== configError" class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{{ errorMsg }}</p>
          </aside>
        </section>
      </main>

      <aside class="flex min-h-screen flex-col bg-[#e9e1d3] px-5 py-6 lg:px-6 lg:py-8">
        <div class="mb-5 flex items-center justify-between gap-4">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Library</p>
            <h2 class="mt-2 text-2xl font-black text-zinc-950">作品</h2>
          </div>
          <button
            v-if="history.length"
            class="rounded-md border border-zinc-950/15 px-3 py-2 text-xs font-bold text-zinc-700 transition hover:bg-white"
            @click="shared.clearHistory()"
          >清空</button>
        </div>

        <section v-if="latestItem" class="mb-5 rounded-lg border border-zinc-950/10 bg-zinc-950 p-4 text-white shadow-sm">
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <input
                class="-ml-1 max-w-[220px] truncate rounded bg-transparent px-1 text-sm font-bold outline-none hover:bg-white/10 focus:bg-white/15"
                :value="latestItem.name"
                @change="shared.renameItem(latestItem.id, ($event.target as HTMLInputElement).value || defaultItemName(latestItem.text))"
                @blur="($event.target as HTMLInputElement).value = ($event.target as HTMLInputElement).value || defaultItemName(latestItem.text)"
              />
              <p class="mt-1 text-xs text-white/55">{{ latestItem.voiceName }} · {{ formatTime(latestItem.createdAt) }} · {{ formatSize(latestItem.byteLength) }}</p>
            </div>
            <div class="flex items-center gap-2">
              <button class="rounded-md px-3 py-2 text-sm font-black transition" :class="active(latestItem) ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-amber-400 text-zinc-950 hover:bg-amber-300'" @click="shared.playAudio(active(latestItem) ? null : latestItem)">
                {{ active(latestItem) ? '暂停' : '播放' }}
              </button>
              <button class="rounded-md bg-white/10 px-3 py-2 text-sm font-bold text-white/60 transition hover:bg-red-500/40 hover:text-white" @click="shared.removeHistoryItem(latestItem.id)">删除</button>
            </div>
          </div>
          <p class="mt-4 line-clamp-3 text-sm leading-6 text-white/75">{{ latestItem.text }}</p>
          <p v-if="isRoleStoryControls(latestItem.controls)" class="mt-3 text-xs font-semibold text-amber-200">
            角色故事：{{ (latestItem.controls as RoleStoryControls).roles.length }} 角色 · {{ (latestItem.controls as RoleStoryControls).segmentCount }} 段
          </p>
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
                <input
                  class="-ml-1 max-w-[190px] truncate rounded bg-transparent px-1 text-sm font-black text-zinc-900 outline-none hover:bg-zinc-100 focus:bg-zinc-100"
                  :value="item.name"
                  @change="shared.renameItem(item.id, ($event.target as HTMLInputElement).value || defaultItemName(item.text))"
                  @blur="($event.target as HTMLInputElement).value = ($event.target as HTMLInputElement).value || defaultItemName(item.text)"
                />
                <p class="mt-1 text-xs font-semibold text-zinc-500">{{ item.voiceName }} · {{ formatTime(item.createdAt) }} · {{ formatSize(item.byteLength) }}</p>
              </div>
              <button class="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-black text-zinc-900 transition hover:bg-amber-300" @click="shared.playAudio(active(item) ? null : item)">
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
              <button class="ml-auto rounded-md px-2 py-1 text-zinc-800 transition hover:bg-zinc-100" @click="shared.revealInFolder(item)">定位</button>
              <button class="rounded-md px-2 py-1 text-red-600 transition hover:bg-red-50" @click="shared.removeHistoryItem(item.id)">删除</button>
            </div>
          </article>
        </div>

        <div v-else class="flex flex-1 items-center justify-center rounded-lg border border-dashed border-zinc-950/20 bg-white/40 p-8 text-center text-sm font-semibold leading-6 text-zinc-500">
          生成的角色故事音频会出现在这里。
        </div>
      </aside>
    </div>

    <footer class="border-t border-zinc-950/10 bg-[#fbfaf7] px-5 py-8 lg:px-10">
      <div class="mx-auto w-full max-w-7xl space-y-4">
        <section class="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">Reference</p>
              <h2 class="mt-2 text-xl font-black text-zinc-950">模型、控制台和配置</h2>
            </div>
            <div class="flex flex-wrap gap-2 text-xs font-bold">
              <a class="rounded-md bg-amber-100 px-2.5 py-1 text-amber-800 transition hover:bg-amber-200" href="https://console.volcengine.com/speech/service" target="_blank">火山语音控制台</a>
              <a class="rounded-md bg-zinc-100 px-2.5 py-1 text-zinc-800 transition hover:bg-zinc-200" href="https://console.volcengine.com/iam/keymanage" target="_blank">API Key 管理</a>
              <a class="rounded-md bg-zinc-100 px-2.5 py-1 text-zinc-800 transition hover:bg-zinc-200" href="https://www.volcengine.com/docs/6561/1257544" target="_blank">音色列表</a>
              <a class="rounded-md bg-zinc-100 px-2.5 py-1 text-zinc-800 transition hover:bg-zinc-200" href="https://www.volcengine.com/docs/6561/1598757" target="_blank">V3 接口</a>
            </div>
          </div>

          <div class="mt-5 overflow-x-auto">
            <table class="w-full min-w-[760px] text-left text-xs">
              <thead class="border-b border-zinc-950/10 text-zinc-500">
                <tr>
                  <th class="pb-2 pr-4 font-black">模型 / 服务</th>
                  <th class="pb-2 pr-4 font-black">Resource ID / 入口</th>
                  <th class="pb-2 pr-4 font-black">适合用途</th>
                  <th class="pb-2 font-black">项目内用法</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-950/10 font-semibold text-zinc-700">
                <tr>
                  <td class="py-3 pr-4 text-zinc-950">火山语音合成 2.0</td>
                  <td class="py-3 pr-4"><code class="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">seed-tts-2.0</code></td>
                  <td class="py-3 pr-4">默认高质量成片，儿童旁白、妈妈、稳定角色优先推荐。</td>
                  <td class="py-3">从 `voices.json` 读取 2.0 音色，走 `/volc-api/api/v3/tts/unidirectional`。</td>
                </tr>
                <tr>
                  <td class="py-3 pr-4 text-zinc-950">火山语音合成 1.0</td>
                  <td class="py-3 pr-4"><code class="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-800">seed-tts-1.0</code></td>
                  <td class="py-3 pr-4">补充多情感、口音、特殊角色；适合需要情绪变化的台词。</td>
                  <td class="py-3">同池参与推荐；角色选中 1.0 音色时自动携带对应 Resource ID。</td>
                </tr>
                <tr>
                  <td class="py-3 pr-4 text-zinc-950">火山声音复刻 2.0</td>
                  <td class="py-3 pr-4"><code class="rounded bg-violet-50 px-1.5 py-0.5 text-violet-800">seed-icl-2.0</code></td>
                  <td class="py-3 pr-4">后续接入自己的克隆音色，例如家长、老师或固定旁白。</td>
                  <td class="py-3">在 `config.json` 的 `cloneVoices` 填入训练后的音色 ID 后出现在候选池。</td>
                </tr>
                <tr>
                  <td class="py-3 pr-4 text-zinc-950">Microsoft Edge Neural</td>
                  <td class="py-3 pr-4"><code class="rounded bg-sky-50 px-1.5 py-0.5 text-sky-800">/edge-api/synthesize</code></td>
                  <td class="py-3 pr-4">免费快速试听；儿童、少年、普通话角色可临时替代。</td>
                  <td class="py-3">启动 `start.bat` 后可用；角色下拉里标记为“本地”。</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div class="grid gap-4 lg:grid-cols-3">
          <section class="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-sm">
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Config</p>
            <h3 class="mt-2 text-base font-black text-zinc-950">配置文件字段</h3>
            <dl class="mt-4 space-y-3 text-xs font-medium leading-5 text-zinc-600">
              <div>
                <dt class="font-black text-zinc-900">`apiKey`</dt>
                <dd>火山 API Key。当前按本机使用保留在 `web/public/config.json`。</dd>
              </div>
              <div>
                <dt class="font-black text-zinc-900">`resourceId`</dt>
                <dd>默认资源，建议使用 `seed-tts-2.0`。</dd>
              </div>
              <div>
                <dt class="font-black text-zinc-900">`resourceIds`</dt>
                <dd>候选资源列表，当前可放 `seed-tts-2.0`、`seed-tts-1.0`、`seed-icl-2.0`。</dd>
              </div>
              <div>
                <dt class="font-black text-zinc-900">`cloneVoices`</dt>
                <dd>自训练音色数组：`{ id, name, description }`，刷新后进入云端候选。</dd>
              </div>
            </dl>
          </section>

          <section class="rounded-lg border border-zinc-950/10 bg-white p-5 shadow-sm">
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Controls</p>
            <h3 class="mt-2 text-base font-black text-zinc-950">推荐参数含义</h3>
            <dl class="mt-4 space-y-3 text-xs font-medium leading-5 text-zinc-600">
              <div>
                <dt class="font-black text-zinc-900">语速</dt>
                <dd>按 `[角色音色]` 的“偏慢 / 中等 / 偏快”初始化；睡前故事默认偏慢。</dd>
              </div>
              <div>
                <dt class="font-black text-zinc-900">音调</dt>
                <dd>孩子和活泼角色略高；沉稳、长辈、本地男声略低。</dd>
              </div>
              <div>
                <dt class="font-black text-zinc-900">音量</dt>
                <dd>默认 1.00x；只做角色间轻微平衡，不建议大幅拉高。</dd>
              </div>
              <div>
                <dt class="font-black text-zinc-900">情绪</dt>
                <dd>仅火山支持情绪的音色可选；本地 Edge 不显示情绪控件。</dd>
              </div>
            </dl>
          </section>

          <section class="rounded-lg border border-zinc-950/10 bg-zinc-950 p-5 text-white shadow-sm">
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Workflow</p>
            <h3 class="mt-2 text-base font-black">生成链路</h3>
            <ol class="mt-4 list-inside list-decimal space-y-2 text-xs font-medium leading-5 text-white/70">
              <li>粘贴角色分音文本，保留 `标题：` 和 `[角色音色]`。</li>
              <li>系统为每个角色生成云端 + 本地完整候选，下拉里可手动改。</li>
              <li>点击生成后按角色片段逐段请求 TTS。</li>
              <li>所有片段加 400ms 静音间隔，合并为一个 WAV。</li>
              <li>作品保存到项目 `output` 目录，并写入 `output/index.json`。</li>
            </ol>
          </section>
        </div>
      </div>
    </footer>
  </div>
</template>
