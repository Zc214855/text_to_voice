import { countTextUnits, normalizeLineBreaks } from './textCleanup'

export const DEFAULT_ROLE_NAME = '旁白'
export const TITLE_ROLE_NAME = '标题'

/** 故事文本中 LLM 产出的角色特征描述 */
export interface VoiceDescriptor {
  gender: string   // 男声 / 女声 / 不限
  ageGroup: string // 幼童 / 少年 / 成年 / 老年 / 不限
  tone: string     // 温柔 / 活泼 / 沉稳 / 日常 / 朗读 / 好奇 ...
  speed: string    // 很慢 / 偏慢 / 中等 / 偏快 / 很快
}

/** [角色音色] 块的解析结果 */
export interface VoiceMeta {
  role: string
  descriptor: VoiceDescriptor
}

/** 解析出的音色元数据（如果文本中没有则为 null） */
export interface VoiceMetaResult {
  metas: VoiceMeta[]
  storyText: string
}

const DESCRIPTOR_LINE = /^([^：:\n]{1,20})[：:]\s*(.+)$/

const GENDER_KEYWORDS = ['男声', '女声', '不限', '男', '女']
const AGE_KEYWORDS = ['幼童', '少年', '成年', '老年']
const SPEED_KEYWORDS = ['很慢', '偏慢', '中等', '偏快', '很快', '慢', '快']

function parseDescriptor(raw: string): VoiceDescriptor {
  const parts = raw.split(/[,，、\s]+/).filter(Boolean)

  // 性别优先匹配最具体的（不限优先级低于男声/女声）
  const gender = parts.find((p) => p === '男声' || p === '女声')
    || parts.find((p) => p === '不限')
    || ''
  // 年龄段只匹配明确的年龄词，不匹配"不限"
  const ageGroup = parts.find((p) => AGE_KEYWORDS.includes(p)) || ''
  // 语速
  const speed = parts.find((p) => SPEED_KEYWORDS.includes(p)) || ''
  // 语气：排除已分类的词
  const classified = new Set([...GENDER_KEYWORDS, ...AGE_KEYWORDS, ...SPEED_KEYWORDS])
  const tone = parts.filter((p) => !classified.has(p)).join('')

  return { gender, ageGroup, tone, speed }
}

/**
 * 从故事文本中提取 [角色音色] 元数据块。
 * 格式示例：
 *   [角色音色]
 *   旁白：女声、成年、温柔朗读、偏慢
 *   团团：女声、幼童、安静好奇、偏慢
 *   [/角色音色]
 *
 * 同时支持换行分隔和无换行紧凑格式：
 *   [角色音色]旁白：女声、成年、温柔朗读、偏慢团团：女声、幼童、安静好奇、偏慢[/角色音色]
 *
 * 返回解析后的元数据和去掉音色块的纯文本。
 * 如果没有找到 [角色音色] 块，返回 null。
 */
export function parseVoiceMeta(input: string): VoiceMetaResult | null {
  const startTag = '[角色音色]'
  const endTag = '[/角色音色]'

  const startIdx = input.indexOf(startTag)
  const endIdx = input.indexOf(endTag)

  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
    return null
  }

  const block = input.slice(startIdx + startTag.length, endIdx)
  const before = input.slice(0, startIdx)
  const after = input.slice(endIdx + endTag.length)
  const storyText = (before + after).trim()

  const metas: VoiceMeta[] = []

  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const match = DESCRIPTOR_LINE.exec(line)
    if (!match) continue

    const role = match[1].trim()
    const descriptorText = match[2].trim()
    if (!role || !descriptorText) continue

    // 防御：描述过长或含句号说明是故事正文而非音色描述
    if (descriptorText.length > 40 || /[。！？]/.test(descriptorText)) continue

    metas.push({
      role,
      descriptor: parseDescriptor(descriptorText),
    })
  }

  return {
    metas,
    storyText: storyText || input,
  }
}

export interface RoleScriptSegment {
  role: string
  text: string
  characterCount: number
  isTitle?: boolean
}

export interface RoleScriptParseResult {
  roles: string[]
  segments: RoleScriptSegment[]
  characterCount: number
}

const ROLE_LINE = /^([^：:\n]{1,20})[：:]\s*(.*)$/

function normalizeRoleName(value: string) {
  const role = value.trim()
  return role || DEFAULT_ROLE_NAME
}

function appendSegment(segments: RoleScriptSegment[], role: string, text: string, isTitle = false) {
  const previous = segments[segments.length - 1]

  if (previous?.role === role && !previous.isTitle && !isTitle) {
    previous.text = `${previous.text}\n${text}`
    previous.characterCount = countTextUnits(previous.text)
    return
  }

  segments.push({
    role,
    text,
    characterCount: countTextUnits(text),
    isTitle,
  })
}

export function parseRoleScript(input: string): RoleScriptParseResult {
  const segments: RoleScriptSegment[] = []
  const roles: string[] = []
  const seenRoles = new Set<string>()
  let voiceMetaBlock = false

  for (const rawLine of normalizeLineBreaks(input).split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    // 防御：跳过整个 [角色音色] ... [/角色音色] 块
    // （当 parseVoiceMeta 无法正确剥离时，parseRoleScript 自行过滤）
    if (line === '[角色音色]') {
      voiceMetaBlock = true
      continue
    }
    if (line === '[/角色音色]') {
      voiceMetaBlock = false
      continue
    }
    if (voiceMetaBlock) continue

    const match = ROLE_LINE.exec(line)
    const rawRole = match ? normalizeRoleName(match[1]) : DEFAULT_ROLE_NAME
    const text = (match ? match[2] : line).trim()
    if (!text) continue

    const isTitle = rawRole === TITLE_ROLE_NAME
    const role = isTitle ? DEFAULT_ROLE_NAME : rawRole
    const segmentText = isTitle ? `${text}\n\n` : text

    appendSegment(segments, role, segmentText, isTitle)

    if (!isTitle && !seenRoles.has(role)) {
      seenRoles.add(role)
      roles.push(role)
    }
  }

  return {
    roles,
    segments,
    characterCount: segments.reduce((total, segment) => total + segment.characterCount, 0),
  }
}
