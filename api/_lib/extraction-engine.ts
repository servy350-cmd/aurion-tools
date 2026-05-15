/**
 * Motor de extracción: dado contenido parseado + schema, llama a gpt-4o
 * (con vision si hay imágenes) y devuelve records normalizados.
 * Hace chunking cuando el contenido es grande.
 */
import OpenAI from 'openai'
import { getOpenAI } from './openai.js'
import type { ParsedFile } from './file-parser.js'

const EXTRACTION_MODEL = 'gpt-4o'
const MAX_TEXT_CHARS = 100_000
const MAX_IMAGES_PER_CHUNK = 10
const MAX_PARALLEL = 3

export type ExtractedRecord = Record<string, string | number | null>

export type ReviewItem = {
  issue: string
  source: string
  suggested_action: string
}

export type ExtractionResult = {
  records: ExtractedRecord[]
  review_required: ReviewItem[]
  processing_summary: {
    files_processed: number
    records_found: number
    missing_fields: number
    illegible_fields: number
    duplicates_detected: number
  }
}

export type ExtractionProgress =
  | { type: 'chunk_started'; file: string; chunk: number; total: number }
  | { type: 'chunk_completed'; file: string; chunk: number; total: number; records: number }
  | { type: 'record_found'; record: ExtractedRecord; source: string }
  | { type: 'chunk_failed'; file: string; chunk: number; total: number; error: string }

function buildPrompt(schema: string[]): string {
  return `Actúa como un extractor experto de información estructurada. Analiza el contenido proporcionado (texto, tablas e imágenes). Extrae únicamente la información visible o claramente inferible del documento. No inventes datos. Usa este esquema de columnas: ${JSON.stringify(schema)}. Devuelve JSON con esta forma exacta:
{
  "detected_schema": [...],
  "records": [{ ...columnas..., "source_file":"", "source_page":"", "source_sheet":"", "source_image":"", "confidence":"high|medium|low", "review_notes":"" }],
  "review_required": [{ "issue":"", "source":"", "suggested_action":"" }],
  "processing_summary": { "files_processed":0, "records_found":0, "missing_fields":0, "illegible_fields":0, "duplicates_detected":0 }
}
Reglas estrictas:
- Si un dato no aparece: "Información no disponible"
- Si un dato está en imagen pero ilegible: "Imagen borrosa o ilegible"
- NO uses N/A, NO dejes vacío, NO inventes
- Conserva exacto: códigos, números, fechas, valores, seriales, IDs
- Una fila por cada entidad/registro encontrado
- Marca dudas en review_notes`
}

type ChunkInput = {
  file: ParsedFile
  text: string
  images: ParsedFile['images']
  chunkIndex: number
  totalChunks: number
}

function chunkFile(file: ParsedFile): ChunkInput[] {
  const chunks: ChunkInput[] = []
  // Si tiene muchas imágenes, dividir por imágenes
  const imageGroups: ParsedFile['images'][] = []
  for (let i = 0; i < file.images.length; i += MAX_IMAGES_PER_CHUNK) {
    imageGroups.push(file.images.slice(i, i + MAX_IMAGES_PER_CHUNK))
  }
  // Si tiene texto grande, dividir por chars
  const textChunks: string[] = []
  if (file.text.length > MAX_TEXT_CHARS) {
    for (let i = 0; i < file.text.length; i += MAX_TEXT_CHARS) {
      textChunks.push(file.text.slice(i, i + MAX_TEXT_CHARS))
    }
  } else {
    textChunks.push(file.text)
  }

  const total = Math.max(imageGroups.length, textChunks.length, 1)
  for (let i = 0; i < total; i++) {
    chunks.push({
      file,
      text: textChunks[i] ?? '',
      images: imageGroups[i] ?? [],
      chunkIndex: i,
      totalChunks: total,
    })
  }
  return chunks
}

async function extractFromChunk(
  client: OpenAI,
  chunk: ChunkInput,
  schema: string[],
): Promise<ExtractionResult> {
  const userParts: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  > = []

  const meta = `Archivo: ${chunk.file.filename} (tipo: ${chunk.file.kind})` +
    (chunk.totalChunks > 1 ? ` — fragmento ${chunk.chunkIndex + 1}/${chunk.totalChunks}` : '')
  userParts.push({ type: 'text', text: meta })

  if (chunk.text.trim().length > 0) {
    userParts.push({
      type: 'text',
      text: `Contenido textual:\n${chunk.text.slice(0, MAX_TEXT_CHARS)}`,
    })
  }
  for (const img of chunk.images) {
    userParts.push({
      type: 'image_url',
      image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
    })
  }

  const completion = await client.chat.completions.create({
    model: EXTRACTION_MODEL,
    response_format: { type: 'json_object' },
    max_tokens: 4000,
    messages: [
      { role: 'system', content: buildPrompt(schema) },
      { role: 'user', content: userParts },
    ],
  })

  let text = completion.choices[0]?.message?.content || '{}'
  let parsed: Partial<ExtractionResult>
  try {
    parsed = JSON.parse(text) as Partial<ExtractionResult>
  } catch {
    // Reintenta una vez con prompt más estricto
    const retry = await client.chat.completions.create({
      model: EXTRACTION_MODEL,
      response_format: { type: 'json_object' },
      max_tokens: 4000,
      messages: [
        { role: 'system', content: buildPrompt(schema) + '\n\nIMPORTANTE: La respuesta anterior no fue JSON válido. Devuelve SOLO JSON.' },
        { role: 'user', content: userParts },
      ],
    })
    text = retry.choices[0]?.message?.content || '{}'
    parsed = JSON.parse(text) as Partial<ExtractionResult>
  }

  return {
    records: parsed.records || [],
    review_required: parsed.review_required || [],
    processing_summary: parsed.processing_summary || {
      files_processed: 1,
      records_found: (parsed.records || []).length,
      missing_fields: 0,
      illegible_fields: 0,
      duplicates_detected: 0,
    },
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let cursor = 0
  async function next(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++
      try {
        results[idx] = { status: 'fulfilled', value: await worker(items[idx], idx) }
      } catch (e) {
        results[idx] = { status: 'rejected', reason: e }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()))
  return results
}

export async function extractFromFiles(
  files: ParsedFile[],
  schema: string[],
  onProgress: (e: ExtractionProgress) => void,
): Promise<ExtractionResult> {
  const client = getOpenAI()
  const allChunks: ChunkInput[] = []
  for (const f of files) allChunks.push(...chunkFile(f))

  const aggRecords: ExtractedRecord[] = []
  const aggReview: ReviewItem[] = []
  let missing = 0
  let illegible = 0

  const settled = await runWithConcurrency(allChunks, MAX_PARALLEL, async chunk => {
    onProgress({ type: 'chunk_started', file: chunk.file.filename, chunk: chunk.chunkIndex + 1, total: chunk.totalChunks })
    try {
      const result = await extractFromChunk(client, chunk, schema)
      onProgress({ type: 'chunk_completed', file: chunk.file.filename, chunk: chunk.chunkIndex + 1, total: chunk.totalChunks, records: result.records.length })
      for (const r of result.records) {
        onProgress({ type: 'record_found', record: r, source: chunk.file.filename })
      }
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      onProgress({ type: 'chunk_failed', file: chunk.file.filename, chunk: chunk.chunkIndex + 1, total: chunk.totalChunks, error: msg })
      throw e
    }
  })

  for (const r of settled) {
    if (r.status === 'fulfilled') {
      aggRecords.push(...r.value.records)
      aggReview.push(...r.value.review_required)
      missing += r.value.processing_summary.missing_fields || 0
      illegible += r.value.processing_summary.illegible_fields || 0
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason)
      aggReview.push({
        issue: `Chunk falló: ${reason}`,
        source: '(desconocido)',
        suggested_action: 'Revisar manualmente este archivo o reintentar.',
      })
    }
  }

  return {
    records: aggRecords,
    review_required: aggReview,
    processing_summary: {
      files_processed: files.length,
      records_found: aggRecords.length,
      missing_fields: missing,
      illegible_fields: illegible,
      duplicates_detected: 0,
    },
  }
}
