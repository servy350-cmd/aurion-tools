/**
 * POST /api/operations/word-excel-fill
 * Body: { word_path, word_filename, excel_path, excel_filename }
 *
 * Lee imágenes embebidas en un .docx + headers de la primera fila de un .xlsx,
 * llama a Claude Vision una vez por imagen pidiéndole un JSON con esos headers,
 * y devuelve un .xlsx con una fila por imagen.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type OpenAI from 'openai'
import ExcelJS from 'exceljs'
import {
  authenticateUser,
  checkQuota,
  completeOperation,
  failOperation,
  downloadFromStorage,
  uploadToStorage,
  getSignedDownloadUrl,
  getSupabaseAdmin,
  requireServiceRole,
} from '../_lib/supabase'
import { extractImagesFromDocx } from '../_lib/images'
import { getOpenAI, mapOpenAIError } from '../_lib/openai'

const VISION_MODEL = 'gpt-4o-mini'
const COST_PER_IMAGE_USD = 0.002

type FillRow = Record<string, string | number | null>

async function readHeadersFromXlsx(buffer: Buffer): Promise<string[]> {
  const wb = new ExcelJS.Workbook()
  // exceljs.load espera ArrayBuffer; convertimos sin copia
  const ab = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer
  await wb.xlsx.load(ab)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('El Excel no tiene hojas')
  const headerRow = ws.getRow(1)
  const headers: string[] = []
  headerRow.eachCell({ includeEmpty: false }, cell => {
    const v = cell.value
    if (v === null || v === undefined) return
    headers.push(String(v).trim())
  })
  if (headers.length === 0) throw new Error('La primera fila del Excel no tiene headers')
  return headers
}

async function callOpenAIWithRetry(
  client: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  maxRetries = 5
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await client.chat.completions.create(params)
    } catch (err) {
      lastError = err
      const status = (err as { status?: number }).status
      const code = (err as { code?: string }).code
      const isRateLimit = status === 429 || code === 'rate_limit_exceeded'
      const isQuotaExhausted = code === 'insufficient_quota'
      if (!isRateLimit || isQuotaExhausted) throw err
      const waitMs = Math.min(2000 * Math.pow(2, attempt), 32000)
      console.log(`[w-x-f] rate limit, retry ${attempt + 1}/${maxRetries} in ${waitMs}ms`)
      await new Promise(r => setTimeout(r, waitMs))
    }
  }
  throw lastError
}

async function fillRowFromImage(
  client: OpenAI,
  image: { mediaType: string; base64: string },
  headers: string[]
): Promise<FillRow> {
  const prompt =
    `Analiza esta imagen y devuelve un JSON con exactamente estos campos: ` +
    `${JSON.stringify(headers)}. Si algún campo no se ve en la imagen, ponlo como null. ` +
    `Responde SOLO un objeto JSON válido. Sin markdown ni texto adicional.`

  const completion = await callOpenAIWithRetry(client, {
    model: VISION_MODEL,
    response_format: { type: 'json_object' },
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
          },
        ],
      },
    ],
  })

  const text = completion.choices[0]?.message?.content || '{}'

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const row: FillRow = {}
    for (const h of headers) {
      const v = parsed[h]
      row[h] = v === undefined || v === null ? null : typeof v === 'number' ? v : String(v)
    }
    return row
  } catch {
    const row: FillRow = {}
    for (const h of headers) row[h] = null
    return row
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!requireServiceRole(res)) return

  let opId: string | null = null
  console.log('[w-x-f] start')
  try {
    const { userId } = await authenticateUser(req)
    const { word_path, word_filename, excel_path, excel_filename } = req.body as Record<string, string>

    if (!word_path || !word_filename || !excel_path || !excel_filename) {
      return res.status(400).json({
        error: 'Faltan word_path, word_filename, excel_path o excel_filename',
      })
    }
    if (!word_filename.toLowerCase().endsWith('.docx')) {
      return res.status(400).json({ error: 'El primer archivo debe ser .docx' })
    }
    if (!excel_filename.toLowerCase().endsWith('.xlsx')) {
      return res.status(400).json({ error: 'El segundo archivo debe ser .xlsx' })
    }

    const quota = await checkQuota(userId)
    if (!quota.allowed) {
      return res.status(403).json({
        error: `Has alcanzado tu límite de ${quota.limit} operaciones en 30 días. Plan: ${quota.plan}.`,
      })
    }

    const admin = getSupabaseAdmin()
    const { data: opRow, error: opErr } = await admin
      .from('operations')
      .insert({
        user_id: userId,
        operation_type: 'word_excel_fill',
        status: 'processing',
        input_file: word_path,
        input_filename: word_filename,
        metadata: { excel_path, excel_filename },
      })
      .select('id')
      .single()
    if (opErr || !opRow) {
      throw new Error(`No se pudo crear la operación: ${opErr?.message}`)
    }
    opId = opRow.id as string

    const [wordBuf, excelBuf] = await Promise.all([
      downloadFromStorage(word_path),
      downloadFromStorage(excel_path),
    ])

    const images = await extractImagesFromDocx(wordBuf)
    console.log('[w-x-f] images extracted:', images.length)
    if (images.length === 0) {
      throw new Error('El .docx no tiene imágenes embebidas')
    }

    const headers = await readHeadersFromXlsx(excelBuf)
    console.log('[w-x-f] headers read:', headers)

    const client = getOpenAI()

    // OpenAI tier 1 = 3 RPM. Procesamos en lotes con espera entre lotes y
    // retry exponencial dentro de cada llamada para absorber 429.
    const BATCH_SIZE = 3
    const BATCH_DELAY_MS = 1500

    console.log('[w-x-f] total images:', images.length, 'batch size:', BATCH_SIZE)
    console.log('[w-x-f] estimated time:', Math.ceil(images.length / BATCH_SIZE) * 4, 'seconds')

    type ResultItem =
      | { ok: true; index: number; row: FillRow }
      | { ok: false; index: number; error: string }
    const results: ResultItem[] = []

    for (let i = 0; i < images.length; i += BATCH_SIZE) {
      const batch = images.slice(i, i + BATCH_SIZE)
      const batchNum = Math.floor(i / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(images.length / BATCH_SIZE)
      console.log(
        '[w-x-f] processing batch',
        batchNum,
        '/',
        totalBatches,
        '(' + batch.length + ' images)',
      )
      const batchResults = await Promise.all(
        batch.map(async (img, idx): Promise<ResultItem> => {
          const globalIdx = i + idx
          const t0 = Date.now()
          console.log('[w-x-f] image', globalIdx, 'started')
          try {
            const row = await fillRowFromImage(client, img, headers)
            console.log('[w-x-f] image', globalIdx, 'completed in', Date.now() - t0, 'ms')
            return { ok: true, index: globalIdx, row }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error('[w-x-f] image', globalIdx, 'failed:', msg)
            return { ok: false, index: globalIdx, error: msg }
          }
        }),
      )
      results.push(...batchResults)
      if (i + BATCH_SIZE < images.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
      }
    }

    const rows: FillRow[] = results.map(r => {
      if (r.ok) return r.row
      const empty: FillRow = {}
      for (const h of headers) empty[h] = null
      return empty
    })
    const failures = results.filter((r): r is Extract<ResultItem, { ok: false }> => !r.ok)

    console.log('[w-x-f] building output xlsx')
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Resultados')
    ws.columns = headers.map(h => ({ header: h, key: h, width: 22 }))
    ws.getRow(1).font = { bold: true }
    for (const row of rows) ws.addRow(row)

    if (failures.length > 0) {
      const errSheet = wb.addWorksheet('Errores')
      errSheet.columns = [
        { header: 'imagen', key: 'index', width: 12 },
        { header: 'razon', key: 'error', width: 80 },
      ]
      errSheet.getRow(1).font = { bold: true }
      for (const f of failures) {
        errSheet.addRow({ index: f.index, error: f.error })
      }
    }

    const outBuf = Buffer.from(await wb.xlsx.writeBuffer())
    const outFilename = `${excel_filename.replace(/\.[^/.]+$/, '')}_rellenado.xlsx`
    const outPath = `${userId}/outputs/${Date.now()}_${outFilename}`
    await uploadToStorage(
      outPath,
      outBuf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    console.log('[w-x-f] uploaded to storage')

    const costEstimate = images.length * COST_PER_IMAGE_USD
    await completeOperation(opId, outPath, outFilename, {
      excel_path,
      excel_filename,
      headers,
      images_count: images.length,
      cost_estimate_usd: costEstimate,
    })
    await admin.from('operations').update({ cost_estimate: costEstimate }).eq('id', opId)

    const downloadUrl = await getSignedDownloadUrl(outPath)
    console.log('[w-x-f] done')
    return res.status(200).json({
      success: true,
      output_filename: outFilename,
      download_url: downloadUrl,
      images_count: images.length,
      headers_count: headers.length,
    })
  } catch (e) {
    console.error('word-excel-fill error:', e)
    const mapped = mapOpenAIError(e)
    if (mapped) {
      if (opId) await failOperation(opId, mapped.message).catch(() => {})
      return res.status(mapped.status).json({ error: mapped.message })
    }
    const msg = e instanceof Error ? e.message : 'Error desconocido'
    if (opId) await failOperation(opId, msg).catch(() => {})
    return res.status(500).json({ error: msg })
  }
}
