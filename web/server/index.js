import { WebSocket } from 'ws'
import express from 'express'
import crypto from 'crypto'
import { promises as fsp } from 'fs'
import { existsSync } from 'fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'

const app = express()
const PORT = 5174
const HOST = '127.0.0.1'

const __dirname = dirname(fileURLToPath(import.meta.url))

app.use(express.json({ limit: '60mb' }))

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const SEC_MS_GEC_VERSION = '1-143.0.3650.75'
const WIN_EPOCH = 11644473600
const TICKS_PER_SECOND = 10_000_000
const WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`

function generateSecMsGec() {
  let ticks = Math.floor(Date.now() / 1000) + WIN_EPOCH
  ticks -= ticks % 300
  ticks *= TICKS_PER_SECOND
  const str = String(ticks) + TRUSTED_CLIENT_TOKEN
  return crypto.createHash('sha256').update(str, 'ascii').digest('hex').toUpperCase()
}

function generateMuid() {
  return crypto.randomBytes(16).toString('hex').toUpperCase()
}

function formatRate(val) {
  if (!val || val === 0) return '+0%'
  return (val >= 0 ? '+' : '') + val + '%'
}

function formatPitch(val) {
  if (!val || val === 0) return '+0Hz'
  return (val >= 0 ? '+' : '') + val + 'Hz'
}

function buildSSML(text, voice, { rate = 0, pitch = 0, volume = 0, storyMode = false } = {}) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // 故事模式：在句号、问号、感叹号后插入自然停顿
  let content = escaped
  if (storyMode) {
    content = escaped
      .replace(/([。！？])(?=\S)/g, '$1<break time="350ms"/>')
      .replace(/([，；：])(?=\S)/g, '$1<break time="150ms"/>')
  }

  const lang = voice.startsWith('zh-HK') ? 'zh-HK'
    : voice.startsWith('zh-TW') ? 'zh-TW'
    : voice.startsWith('zh-CN') ? 'zh-CN'
    : voice.split('-').slice(0, 2).join('-')

  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='${formatPitch(pitch)}' rate='${formatRate(rate)}' volume='${formatRate(volume)}'>` +
    `${content}` +
    `</prosody></voice></speak>`
}

function synthesizeEdge(text, voice, { rate = 0, pitch = 0, volume = 0, storyMode = false } = {}) {
  return new Promise((resolve, reject) => {
    const reqId = crypto.randomUUID()
    const secMsGec = generateSecMsGec()
    const muid = generateMuid()
    const url = `${WSS_URL}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${reqId}`

    const ws = new WebSocket(url, {
      perMessageDeflate: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
        'Accept-Language': 'en-US,en;q=0.9',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'Cookie': `muid=${muid}`,
      },
    })

    const audioChunks = []
    let resolved = false
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        ws.close()
        reject(new Error('Edge TTS 请求超时'))
      }
    }, 120_000)

    ws.on('open', () => {
      const timestamp = new Date().toISOString()
      const configMsg =
        `X-Timestamp:${timestamp}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`
      ws.send(configMsg)

      const ssml = buildSSML(text, voice, { rate, pitch, volume, storyMode })
      const ssmlMsg =
        `X-RequestId:${reqId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${timestamp}Z\r\n` +
        `Path:ssml\r\n\r\n` +
        `${ssml}\r\n`
      ws.send(ssmlMsg)
    })

    ws.on('message', (data, isBinary) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
      if (isBinary) {
        if (buf.length >= 2) {
          const headerLen = buf.readUInt16BE(0)
          if (buf.length > 2 + headerLen) {
            const audioData = buf.subarray(2 + headerLen)
            if (audioData.length > 0) {
              audioChunks.push(audioData)
            }
          }
        }
      } else {
        const str = buf.toString('utf8')
        if (str.includes('Path:turn.end')) {
          clearTimeout(timeout)
          if (!resolved) {
            resolved = true
            ws.close()
            resolve(Buffer.concat(audioChunks))
          }
        }
      }
    })

    ws.on('error', (err) => {
      clearTimeout(timeout)
      if (!resolved) {
        resolved = true
        reject(new Error(`Edge TTS WebSocket 错误：${err.message}`))
      }
    })

    ws.on('close', (code, reason) => {
      clearTimeout(timeout)
      if (!resolved) {
        resolved = true
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks))
        } else {
          const msg = code === 403 ? 'Edge TTS 认证失败，可能需要更新 Token' : `Edge TTS 连接关闭 (code=${code})`
          reject(new Error(msg))
        }
      }
    })
  })
}

async function synthesizeWithRetry(text, voice, opts, maxRetries = 2) {
  let lastError
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const audio = await synthesizeEdge(text, voice, opts)
      if (audio.length > 0) return audio
      if (i < maxRetries) {
        console.log(`[Edge TTS] 第 ${i + 1} 次尝试未返回音频，重试中...`)
        await new Promise(r => setTimeout(r, 1000))
      }
    } catch (err) {
      lastError = err
      if (i < maxRetries) {
        console.log(`[Edge TTS] 第 ${i + 1} 次尝试出错：${err.message}，重试中...`)
        await new Promise(r => setTimeout(r, 1000 * (i + 1)))
      }
    }
  }
  throw lastError || new Error('Edge TTS 未返回音频数据')
}

app.post('/api/edge-tts/synthesize', async (req, res) => {
  try {
    const { text, voice, rate, pitch, volume, storyMode } = req.body
    if (!text || !voice) {
      return res.status(400).json({ error: '需要 text 和 voice 参数' })
    }
    const audio = await synthesizeWithRetry(text, voice, { rate, pitch, volume, storyMode })
    res.set('Content-Type', 'audio/mpeg')
    res.set('Content-Length', audio.length)
    res.send(audio)
  } catch (err) {
    console.error('[Edge TTS Error]', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/edge-tts/health', (_req, res) => {
  res.json({ status: 'ok' })
})

// ============ 作品库（output 目录文件系统存储）============

// output 目录：server/ 的上两级（项目根目录）
const OUTPUT_DIR = resolve(__dirname, '..', '..', 'output')
const INDEX_FILE = join(OUTPUT_DIR, 'index.json')

// 串行化 index.json 写入，避免并发覆盖
let indexWriteChain = Promise.resolve()
function withIndexLock(fn) {
  const run = indexWriteChain.then(fn, fn)
  indexWriteChain = run.catch(() => undefined)
  return run
}

/** 读取 index.json，返回 items 数组（不存在则返回空数组） */
async function readIndex() {
  try {
    const raw = await fsp.readFile(INDEX_FILE, 'utf8')
    const data = JSON.parse(raw)
    return Array.isArray(data.items) ? data.items : []
  } catch {
    return []
  }
}

/** 写入 index.json（会先把 items 持久化） */
async function writeIndex(items) {
  await fsp.mkdir(OUTPUT_DIR, { recursive: true })
  await fsp.writeFile(INDEX_FILE, JSON.stringify({ items }, null, 2), 'utf8')
}

/** 根据 contentType 返回文件扩展名 */
function contentTypeToExt(contentType) {
  if (contentType === 'audio/wav') return '.wav'
  return '.mp3'
}

/** 只允许访问 output 根目录下的单个 mp3/wav 文件，避免路径穿越。 */
function resolveOutputFile(fileName) {
  const name = String(fileName || '')
  const ext = extname(name).toLowerCase()
  if (!name || name !== basename(name) || (ext !== '.mp3' && ext !== '.wav')) {
    throw new Error('非法文件')
  }

  const filePath = resolve(OUTPUT_DIR, name)
  const relativePath = relative(OUTPUT_DIR, filePath)
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('非法文件')
  }

  return filePath
}

/** 清理文件名：去掉 Windows 不允许的字符，截断长度 */
function sanitizeName(name) {
  return String(name || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30) || 'untitled'
}

/** 生成不冲突的文件名：已存在则加 (1)(2)... */
async function resolveUniqueFileName(baseName, ext) {
  let candidate = `${baseName}${ext}`
  let i = 1
  while (existsSync(join(OUTPUT_DIR, candidate))) {
    candidate = `${baseName}(${i})${ext}`
    i++
  }
  return candidate
}

// 列表
app.get('/api/library', async (_req, res) => {
  try {
    const items = await readIndex()
    res.json({ items })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 新建：接收 base64 音频 + 元数据，写音频文件到 output 和 index.json
app.post('/api/library', async (req, res) => {
  try {
    const { name, text, engine, voice, voiceName, controls, duration, byteLength, createdAt, audioBase64, contentType } = req.body
    if (!audioBase64) return res.status(400).json({ error: '缺少 audioBase64' })

    await withIndexLock(async () => {
      await fsp.mkdir(OUTPUT_DIR, { recursive: true })
      const items = await readIndex()
      const ext = contentTypeToExt(contentType)
      const base = `${sanitizeName(name)}_${sanitizeName(voiceName || 'voice')}`
      const fileName = await resolveUniqueFileName(base, ext)
      const buf = Buffer.from(audioBase64, 'base64')
      await fsp.writeFile(join(OUTPUT_DIR, fileName), buf)

      const item = {
        id: crypto.randomUUID(),
        fileName,
        name: name || 'untitled',
        text: text || '',
        engine: engine || 'volc',
        voice: voice || '',
        voiceName: voiceName || '',
        byteLength: byteLength || buf.length,
        duration: duration || 0,
        controls: controls || {},
        createdAt: createdAt || new Date().toISOString(),
      }
      items.unshift(item)
      await writeIndex(items)
      res.json(item)
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 重命名：改 index.json 的 name，同时重命名文件
app.patch('/api/library/:id/rename', async (req, res) => {
  try {
    const { id } = req.params
    const { name } = req.body
    if (!name) return res.status(400).json({ error: '缺少 name' })

    await withIndexLock(async () => {
      const items = await readIndex()
      const idx = items.findIndex((it) => it.id === id)
      if (idx === -1) return res.status(404).json({ error: '记录不存在' })

      const item = items[idx]
      const oldPath = resolveOutputFile(item.fileName)
      const base = `${sanitizeName(name)}_${sanitizeName(item.voiceName || 'voice')}`
      const ext = extname(item.fileName) || '.mp3'
      const newFileName = await resolveUniqueFileName(base, ext)

      if (existsSync(oldPath)) {
        await fsp.rename(oldPath, resolveOutputFile(newFileName))
      }
      item.name = name
      item.fileName = newFileName
      items[idx] = item
      await writeIndex(items)
      res.json(item)
    })
  } catch (err) {
    if (err.message === '非法文件') return res.status(400).json({ error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// 删除单条：删 mp3 + 从 index 移除
app.delete('/api/library/:id', async (req, res) => {
  try {
    const { id } = req.params
    await withIndexLock(async () => {
      const items = await readIndex()
      const idx = items.findIndex((it) => it.id === id)
      if (idx === -1) return res.status(404).json({ error: '记录不存在' })
      const item = items[idx]
      const filePath = resolveOutputFile(item.fileName)
      if (existsSync(filePath)) {
        await fsp.unlink(filePath).catch(() => undefined)
      }
      items.splice(idx, 1)
      await writeIndex(items)
      res.json({ ok: true })
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 清空：删所有 mp3 + 清空 items
app.delete('/api/library', async (_req, res) => {
  try {
    await withIndexLock(async () => {
      const items = await readIndex()
      for (const item of items) {
        const filePath = resolveOutputFile(item.fileName)
        if (existsSync(filePath)) {
          await fsp.unlink(filePath).catch(() => undefined)
        }
      }
      await writeIndex([])
      res.json({ ok: true })
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 在 Windows 资源管理器中定位文件
app.post('/api/library/:id/locate', async (req, res) => {
  try {
    const { id } = req.params
    const items = await readIndex()
    const item = items.find((it) => it.id === id)
    if (!item) return res.status(404).json({ error: '记录不存在' })
    const filePath = resolveOutputFile(item.fileName)
    if (!existsSync(filePath)) return res.status(404).json({ error: '文件不存在' })

    if (process.platform === 'win32') {
      spawn('explorer.exe', ['/select,', filePath], { detached: true, stdio: 'ignore' }).unref()
      return res.json({ ok: true })
    }
    res.status(400).json({ error: '当前系统不支持定位功能' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// 音频流：前端 <audio> 播放用，支持 Range
app.get('/api/library/audio/:fileName', async (req, res) => {
  try {
    const filePath = resolveOutputFile(req.params.fileName)
    if (!existsSync(filePath)) return res.status(404).json({ error: '文件不存在' })

    const ext = extname(filePath).toLowerCase()
    const mimeType = ext === '.wav' ? 'audio/wav' : 'audio/mpeg'

    const stat = await fsp.stat(filePath)
    const range = req.headers.range
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range)
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0
        const end = match[2] ? parseInt(match[2], 10) : stat.size - 1
        res.status(206)
        res.set('Content-Range', `bytes ${start}-${end}/${stat.size}`)
        res.set('Accept-Ranges', 'bytes')
        res.set('Content-Length', end - start + 1)
        res.set('Content-Type', mimeType)
        return fsp.readFile(filePath).then((buf) => res.send(buf.slice(start, end + 1)))
      }
    }
    res.set('Content-Length', stat.size)
    res.set('Accept-Ranges', 'bytes')
    res.set('Content-Type', mimeType)
    fsp.readFile(filePath).then((buf) => res.send(buf))
  } catch (err) {
    if (err.message === '非法文件') return res.status(400).json({ error: err.message })
    res.status(500).json({ error: err.message })
  }
})

app.listen(PORT, HOST, () => {
  console.log(`Edge TTS Server running at http://${HOST}:${PORT}`)
})
