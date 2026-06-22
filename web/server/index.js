import { WebSocket } from 'ws'
import express from 'express'
import crypto from 'crypto'

const app = express()
const PORT = 5174
const HOST = '127.0.0.1'

app.use(express.json({ limit: '1mb' }))

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

function buildSSML(text, voice, rate, pitch, volume) {
  const rateStr = formatRate(rate)
  const pitchStr = formatPitch(pitch)
  const volStr = formatRate(volume)
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lang = voice.startsWith('zh-HK') ? 'zh-HK' : voice.startsWith('zh-TW') ? 'zh-TW' : voice.startsWith('zh-CN') ? 'zh-CN' : voice.split('-').slice(0, 2).join('-')
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
    `<voice name='${voice}'><prosody pitch='${pitchStr}' rate='${rateStr}' volume='${volStr}'>${escaped}</prosody></voice></speak>`
}

function synthesizeEdge(text, voice, { rate = 0, pitch = 0, volume = 0 } = {}) {
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

      const ssml = buildSSML(text, voice, rate, pitch, volume)
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
    const { text, voice, rate, pitch, volume } = req.body
    if (!text || !voice) {
      return res.status(400).json({ error: '需要 text 和 voice 参数' })
    }
    const audio = await synthesizeWithRetry(text, voice, { rate, pitch, volume })
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

app.listen(PORT, HOST, () => {
  console.log(`Edge TTS Server running at http://${HOST}:${PORT}`)
})
