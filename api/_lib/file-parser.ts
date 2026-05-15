/**
 * Parsea cualquier archivo soportado a una estructura uniforme
 * { text, tables[], images[] } lista para alimentar al motor de extracción.
 */
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { extractImagesFromDocx, extractImagesFromPdf } from './images.js'

export type ParsedImage = { mediaType: string; base64: string; sourcePage?: number }
export type ParsedTable = {
  sheet?: string
  page?: number
  rows: (string | number | null)[][]
}

export type ParsedFile = {
  filename: string
  kind: 'xlsx' | 'csv' | 'docx' | 'pdf' | 'image' | 'unsupported'
  text: string
  tables: ParsedTable[]
  images: ParsedImage[]
  pages?: number
  warnings: string[]
}

function detectKind(filename: string): ParsedFile['kind'] {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx'
  if (lower.endsWith('.csv')) return 'csv'
  if (lower.endsWith('.docx')) return 'docx'
  if (lower.endsWith('.pdf')) return 'pdf'
  if (/\.(jpe?g|png|webp|gif)$/i.test(lower)) return 'image'
  return 'unsupported'
}

async function parseXlsx(buffer: Buffer): Promise<{ text: string; tables: ParsedTable[] }> {
  const wb = new ExcelJS.Workbook()
  const ab = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer
  await wb.xlsx.load(ab)
  const tables: ParsedTable[] = []
  const textChunks: string[] = []
  for (const ws of wb.worksheets) {
    const rows: (string | number | null)[][] = []
    ws.eachRow({ includeEmpty: false }, row => {
      const r: (string | number | null)[] = []
      row.eachCell({ includeEmpty: true }, cell => {
        const v = cell.value
        if (v === null || v === undefined) r.push(null)
        else if (typeof v === 'number') r.push(v)
        else r.push(String(typeof v === 'object' && 'text' in (v as object) ? (v as { text: string }).text : v))
      })
      rows.push(r)
    })
    tables.push({ sheet: ws.name, rows })
    textChunks.push(`# Sheet: ${ws.name}\n` + rows.map(r => r.join(' | ')).join('\n'))
  }
  return { text: textChunks.join('\n\n'), tables }
}

function parseCsv(buffer: Buffer): { text: string; tables: ParsedTable[] } {
  const text = buffer.toString('utf8')
  const rows = text
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .map(line => line.split(',').map(c => c.trim()))
  return { text, tables: [{ rows }] }
}

async function parseDocx(
  buffer: Buffer,
): Promise<{ text: string; images: ParsedImage[] }> {
  const result = await mammoth.extractRawText({ buffer })
  const images = await extractImagesFromDocx(buffer)
  return { text: result.value, images }
}

async function parsePdf(
  buffer: Buffer,
): Promise<{ text: string; images: ParsedImage[]; pages: number; warnings: string[] }> {
  const warnings: string[] = []
  let text = ''
  let pages = 0
  let parser: PDFParse | null = null
  try {
    parser = new PDFParse({ data: new Uint8Array(buffer) })
    const out = await parser.getText()
    type PageLike = { text?: string }
    const pageArr: PageLike[] =
      (out as unknown as { pages?: PageLike[] }).pages ||
      (out as unknown as { text_per_page?: PageLike[] }).text_per_page ||
      []
    pages = pageArr.length || (out as unknown as { numpages?: number }).numpages || 0
    text =
      (out as unknown as { text?: string }).text ||
      pageArr.map(p => p.text || '').join('\n\n')
  } catch (e) {
    warnings.push(`pdf-parse falló: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    try { await parser?.destroy() } catch { /* ignore */ }
  }
  let images: ParsedImage[] = []
  try {
    const raw = await extractImagesFromPdf(buffer)
    images = raw.slice(0, 20)
    if (raw.length > 20) warnings.push(`PDF tiene ${raw.length} páginas, rasterizamos solo las primeras 20`)
  } catch (e) {
    warnings.push(`PDF→imágenes falló: ${e instanceof Error ? e.message : String(e)}. Texto sí extraído.`)
  }
  return { text, images, pages, warnings }
}

async function parseImage(
  buffer: Buffer,
  filename: string,
): Promise<{ images: ParsedImage[]; warnings: string[] }> {
  const lower = filename.toLowerCase()
  const mediaType =
    lower.endsWith('.png') ? 'image/png' :
    lower.endsWith('.webp') ? 'image/webp' :
    lower.endsWith('.gif') ? 'image/gif' :
    'image/jpeg'

  // Normalizar tamaño con sharp (limitar a 1600px en el lado mayor)
  let outBuf = buffer
  const warnings: string[] = []
  try {
    const sharp = (await import('sharp')).default
    const meta = await sharp(buffer).metadata()
    const longest = Math.max(meta.width || 0, meta.height || 0)
    if (longest > 1600) {
      outBuf = await sharp(buffer).resize({ width: 1600, height: 1600, fit: 'inside' }).toBuffer()
    }
  } catch (e) {
    warnings.push(`sharp falló normalizando, uso buffer original: ${e instanceof Error ? e.message : String(e)}`)
  }

  return {
    images: [{ mediaType, base64: outBuf.toString('base64') }],
    warnings,
  }
}

export async function parseFile(
  buffer: Buffer,
  filename: string,
): Promise<ParsedFile> {
  const kind = detectKind(filename)
  const base: ParsedFile = {
    filename,
    kind,
    text: '',
    tables: [],
    images: [],
    warnings: [],
  }

  if (kind === 'xlsx') {
    const { text, tables } = await parseXlsx(buffer)
    return { ...base, text, tables }
  }
  if (kind === 'csv') {
    const { text, tables } = parseCsv(buffer)
    return { ...base, text, tables }
  }
  if (kind === 'docx') {
    const { text, images } = await parseDocx(buffer)
    return { ...base, text, images }
  }
  if (kind === 'pdf') {
    const { text, images, pages, warnings } = await parsePdf(buffer)
    return { ...base, text, images, pages, warnings }
  }
  if (kind === 'image') {
    const { images, warnings } = await parseImage(buffer, filename)
    return { ...base, images, warnings }
  }
  return { ...base, warnings: [`Tipo no soportado: ${filename}`] }
}
