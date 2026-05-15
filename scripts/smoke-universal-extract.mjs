// Smoke test end-to-end de /api/operations/universal-extract (SSE).
// Usa el fixture test-assets/word-con-foto.docx (2 placas HVAC sintéticas).
// Uso: node --env-file=.env.local scripts/smoke-universal-extract.mjs
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs/promises'
import * as path from 'path'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const ENDPOINT = process.env.UNIVERSAL_EXTRACT_URL || 'http://localhost:3000/api/operations/universal-extract'
const FIXTURE = 'test-assets/word-con-foto.docx'
const INSTRUCTION = 'extrae numero_placa, marca y serie de cada imagen'
const EMAIL = 'juanpablocespedes21@gmail.com'
const PASSWORD = 'juan12345'
const TIMEOUT_MS = 280_000

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error('Faltan SUPABASE_URL / ANON key')
  process.exit(1)
}

const ts = (start) => `+${Math.round((Date.now() - start) / 100) / 10}s`

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
})

console.log('[smoke] sign in', EMAIL)
const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
if (authErr || !auth.session) {
  console.error('[smoke] sign in failed:', authErr?.message)
  process.exit(1)
}
const userId = auth.session.user.id
const accessToken = auth.session.access_token
console.log('[smoke] signed in, user_id', userId)

const buf = await fs.readFile(path.resolve(FIXTURE))
const stamp = Date.now()
const storagePath = `${userId}/inputs/${stamp}_universal.docx`
console.log('[smoke] uploading', buf.length, 'bytes →', storagePath)
const up = await supabase.storage.from('files').upload(storagePath, buf, {
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  upsert: false,
})
if (up.error) {
  console.error('[smoke] upload failed:', up.error.message)
  process.exit(1)
}

console.log('[smoke] POST', ENDPOINT)
console.log('[smoke] instruction:', INSTRUCTION)
const t0 = Date.now()
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

let exitCode = 1
try {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      file_paths: [storagePath],
      file_names: ['word-con-foto.docx'],
      instruction: INSTRUCTION,
    }),
    signal: controller.signal,
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    console.error('[smoke] HTTP', res.status, text.slice(0, 400))
    process.exit(1)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let downloadUrl = null
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() || ''
    for (const block of parts) {
      const dataLines = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart())
      if (dataLines.length === 0) continue
      const raw = dataLines.join('\n')
      let ev
      try { ev = JSON.parse(raw) } catch { ev = { type: 'raw', raw } }
      const compact = { ...ev }
      if (typeof compact.record === 'object') compact.record = '<...>'
      if (typeof compact.schema === 'object') compact.schema = `[${compact.schema.length} cols]`
      console.log(ts(t0), JSON.stringify(compact))
      if (ev.type === 'completed') {
        downloadUrl = ev.download_url
        exitCode = 0
      }
      if (ev.type === 'error') {
        exitCode = 1
      }
    }
  }
  if (downloadUrl) {
    console.log('[smoke] download_url:', downloadUrl.slice(0, 100) + '...')
    const dl = await fetch(downloadUrl)
    const out = Buffer.from(await dl.arrayBuffer())
    const outPath = path.resolve('test-assets/output-universal.xlsx')
    await fs.writeFile(outPath, out)
    console.log('[smoke] saved', out.length, 'bytes →', outPath)
  }
} catch (e) {
  if (e.name === 'AbortError') {
    console.error('[smoke] timeout', TIMEOUT_MS, 'ms')
  } else {
    console.error('[smoke] threw:', e.message || e)
  }
  exitCode = 1
} finally {
  clearTimeout(timeoutId)
}

process.exit(exitCode)
