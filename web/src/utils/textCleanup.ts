export interface TextCleanupResult {
  text: string
  changed: boolean
  trimmedLines: number
  removedBlankLines: number
  mergedLines: number
}

const END_PUNCTUATION = /[。！？!?；;：:，,、）)”’》】〕」』…]$/
const OPENING_PUNCTUATION = /^[“‘（(《【「『]/
const TITLE_LINE = /^(第[一二三四五六七八九十百千万0-9]+[章节回幕段]|[一二三四五六七八九十百千万0-9]+[、.．])/
const LIST_MARKER = /^([#>]+\s*|[-*•]\s+|[0-9]+[.、．]\s*)/

export function normalizeLineBreaks(value: string) {
  return value.replace(/\r\n?/g, '\n')
}

export function countTextUnits(value: string) {
  return Array.from(normalizeLineBreaks(value)).length
}

function normalizeLine(line: string) {
  return line
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .replace(LIST_MARKER, '')
    .trim()
}

function shouldMergeLine(previous: string, current: string) {
  if (!previous || !current) return false
  if (END_PUNCTUATION.test(previous)) return false
  if (OPENING_PUNCTUATION.test(current)) return false
  if (TITLE_LINE.test(current)) return false
  return true
}

function joinBrokenLine(previous: string, current: string) {
  const needsSpace = /[A-Za-z0-9]$/.test(previous) && /^[A-Za-z0-9]/.test(current)
  return `${previous}${needsSpace ? ' ' : ''}${current}`
}

export function cleanupTtsText(input: string): TextCleanupResult {
  const source = normalizeLineBreaks(input)
  const lines = source.split('\n')
  const outputLines: string[] = []
  let trimmedLines = 0
  let removedBlankLines = 0
  let mergedLines = 0
  let blankPending = false

  // [角色音色] 块内部的行不做断行合并，避免把音色元数据粘成一行
  let inVoiceMetaBlock = false

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine)

    if (line !== rawLine) {
      trimmedLines += 1
    }

    // 检测 [角色音色] 块边界
    if (line === '[角色音色]') {
      inVoiceMetaBlock = true
    }

    if (!line) {
      if (outputLines.length === 0 || outputLines[outputLines.length - 1] === '' || blankPending) {
        removedBlankLines += 1
      } else {
        blankPending = true
      }
      continue
    }

    if (blankPending) {
      outputLines.push('')
      blankPending = false
    }

    const previous = outputLines[outputLines.length - 1] || ''
    // 角色音色块内部不合并断行
    const shouldMerge = !inVoiceMetaBlock && previous !== '' && shouldMergeLine(previous, line)
    if (previous && shouldMerge) {
      outputLines[outputLines.length - 1] = joinBrokenLine(previous, line)
      mergedLines += 1
    } else {
      outputLines.push(line)
    }

    // 检测 [角色音色] 块结束
    if (line === '[/角色音色]') {
      inVoiceMetaBlock = false
    }
  }

  while (outputLines[outputLines.length - 1] === '') {
    outputLines.pop()
  }

  const text = outputLines.join('\n').trim()

  return {
    text,
    changed: text !== input,
    trimmedLines,
    removedBlankLines,
    mergedLines,
  }
}
