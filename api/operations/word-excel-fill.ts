/**
 * POST /api/operations/word-excel-fill
 * Body: { word_path, word_filename, excel_path, excel_filename }
 *
 * Lee imágenes embebidas en un .docx + headers de la primera fila de un .xlsx,
 * llama a Claude Vision una vez por imagen pidiéndole un JSON con esos headers,
 * y devuelve un .xlsx con una fila por imagen.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import type { ImageBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages'
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

const VISION_MODEL = 'claude-sonnet-4-20250514'
const COST_PER_IMAGE_USD = 0.1

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

async function fillRowFromImage(
  client: Anthropic,
  image: { mediaType: string; base64: string },
  headers: string[]
): Promise<FillRow> {
  const prompt =
    `Analiza esta imagen y devuelve un JSON con exactamente estos campos: ` +
    `${JSON.stringify(headers)}. Si algún campo no se ve en la imagen, ponlo como null. ` +
    `Responde SOLO el JSON, sin markdown ni explicación.`

  const content: (ImageBlockParam | TextBlockParam)[] = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mediaType as ImageBlockParam['source']['media_type'],
        data: image.base64,
      },
    },
    { type: 'text', text: prompt },
  ]

  const resp = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content }],
  })

  let text = ''
  for (const block of resp.content) {
    if (block.type === 'text') text += block.text
  }
  text = text.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim()
  }

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

    // Crear operation manualmente para meter ambos paths en metadata
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
    if (images.length === 0) {
      throw new Error('El .docx no tiene imágenes embebidas')
    }

    const headers = await readHeadersFromXlsx(excelBuf)

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY no configurada')
    }
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const rows: FillRow[] = []
    for (const img of images) {
      const row = await fillRowFromImage(client, img, headers)
      rows.push(row)
    }

    // Construir Excel de salida
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Resultados')
    ws.columns = headers.map(h => ({ header: h, key: h, width: 22 }))
    ws.getRow(1).font = { bold: true }
    for (const row of rows) ws.addRow(row)

    const outBuf = Buffer.from(await wb.xlsx.writeBuffer())
    const outFilename = `${excel_filename.replace(/\.[^/.]+$/, '')}_rellenado.xlsx`
    const outPath = `${userId}/outputs/${Date.now()}_${outFilename}`
    await uploadToStorage(
      outPath,
      outBuf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )

    const costEstimate = images.length * COST_PER_IMAGE_USD
    await completeOperation(opId, outPath, outFilename, {
      excel_path,
      excel_filename,
      headers,
      images_count: images.length,
      cost_estimate_usd: costEstimate,
    })
    // costo aparte en columna numérica (no afecta a metadata)
    await admin.from('operations').update({ cost_estimate: costEstimate }).eq('id', opId)

    const downloadUrl = await getSignedDownloadUrl(outPath)
    return res.status(200).json({
      success: true,
      output_filename: outFilename,
      download_url: downloadUrl,
      images_count: images.length,
      headers_count: headers.length,
    })
  } catch (e) {
    console.error('word-excel-fill error:', e)
    const msg = e instanceof Error ? e.message : 'Error desconocido'
    if (opId) await failOperation(opId, msg).catch(() => {})
    return res.status(500).json({ error: msg })
  }
}
