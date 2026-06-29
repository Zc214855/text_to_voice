import { countTextUnits, normalizeLineBreaks } from './textCleanup'

export const DEFAULT_ROLE_NAME = '旁白'
export const TITLE_ROLE_NAME = '标题'

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

  for (const rawLine of normalizeLineBreaks(input).split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

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
