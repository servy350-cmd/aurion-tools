// Smoke test end-to-end de /api/operations/word-excel-fill.
// Uso: node --env-file=.env.local scripts/smoke-word-excel-fill.mjs
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs/promises'
import * as path from 'path'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const ENDPOINT = 'http://localhost:3000/api/operations/word-excel-fill'
const EMAIL = 'juanpablocespedes21@gmail.com'
const PASSWORD = 'juan12345'

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error('Faltan SUPABASE_URL o ANON key')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: false, autoRefreshToken: false },
})

console.log('[smoke] sign in', EMAIL)
const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD,
})
if (authErr || !auth.session) {
  console.error('[smoke] sign in FAILED:', authErr?.message || 'no session')
  process.exit(2)
}
const accessToken = auth.session.access_token
const userId = auth.session.user.id
console.log('[smoke] signed in, user_id', userId)

const ts = Date.now()
const wordPath = `${userId}/inputs/${ts}_word.docx`
const excelPath = `${userId}/inputs/${ts}_excel.xlsx`

const wordBuf = await fs.readFile(path.resolve('test-assets/word-con-foto.docx'))
const excelBuf = await fs.readFile(path.resolve('test-assets/tabla-vacia.xlsx'))

console.log('[smoke] uploading', wordBuf.length, 'bytes (docx) +', excelBuf.length, 'bytes (xlsx)')
const u1 = await supabase.storage.from('files').upload(wordPath, wordBuf, {
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  upsert: false,
})
if (u1.error) {
  console.error('[smoke] upload docx FAILED:', u1.error.message)
  process.exit(3)
}
const u2 = await supabase.storage.from('files').upload(excelPath, excelBuf, {
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  upsert: false,
})
if (u2.error) {
  console.error('[smoke] upload xlsx FAILED:', u2.error.message)
  process.exit(4)
}
console.log('[smoke] both uploaded')

console.log('[smoke] POST', ENDPOINT)
const t0 = Date.now()
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), 180_000)

let res, bodyText
try {
  res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      word_path: wordPath,
      word_filename: 'word-con-foto.docx',
      excel_path: excelPath,
      excel_filename: 'tabla-vacia.xlsx',
    }),
    signal: controller.signal,
  })
  bodyText = await res.text()
} catch (e) {
  console.error('[smoke] fetch threw:', e?.message || e)
  process.exit(5)
} finally {
  clearTimeout(timeoutId)
}

const ms = Date.now() - t0
console.log('[smoke] HTTP', res.status, 'in', ms, 'ms')
console.log('[smoke] BODY:', bodyText.slice(0, 2000))

// Si hay download_url, lo bajamos
try {
  const json = JSON.parse(bodyText)
  if (json.download_url) {
    const dl = await fetch(json.download_url)
    const buf = Buffer.from(await dl.arrayBuffer())
    console.log('[smoke] downloaded result:', buf.length, 'bytes, status', dl.status)
    const outPath = path.resolve('test-assets/output-rellenado.xlsx')
    await fs.writeFile(outPath, buf)
    console.log('[smoke] saved to', outPath)
  }
} catch {
  // bodyText no es JSON o no tiene download_url — ignoramos
}

process.exit(res.ok ? 0 : 10)
