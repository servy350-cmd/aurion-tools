/**
 * POST /api/operations/universal-extract
 *
 * Endpoint streaming (SSE). Recibe paths ya subidos a Storage + instrucción
 * y emite eventos en tiempo real conforme procesa.
 *
 * Body JSON:
 *   {
 *     file_paths: string[],
 *     file_names: string[],
 *     instruction: string,
 *     master_excel_path?: string,
 *     master_excel_name?: string
 *   }
 *
 * Eventos SSE (cada uno como `data: <json>\n\n`):
 *   started, file_downloading, file_parsing, intent_parsing, schema_detected,
 *   clarification_needed, extracting, record_found, normalizing,
 *   merging_master, generating_excel, uploading, completed, error
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  authenticateUser,
  checkQuota,
  downloadFromStorage,
  uploadToStorage,
  getSignedDownloadUrl,
  getSupabaseAdmin,
  requireServiceRole,
} from '../_lib/supabase.js'
import { parseFile, type ParsedFile } from '../_lib/file-parser.js'
import { parseIntent } from '../_lib/intent-parser.js'
import { extractFromFiles, type ExtractedRecord } from '../_lib/extraction-engine.js'
import {
  normalizeRecords,
  mergeWithMaster,
  masterRowsToRecords,
} from '../_lib/normalization-engine.js'
import { buildOutputWorkbook, type ProcessingLogEntry } from '../_lib/excel-builder.js'
import { mapOpenAIError } from '../_lib/openai.js'

export const config = { maxDuration: 300 }

type SSEEvent = Record<string, unknown> & { type: string }

function emit(res: VercelResponse, event: SSEEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
  const r = res as unknown as { flush?: () => void }
  if (typeof r.flush === 'function') r.flush()
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!requireServiceRole(res)) return

  // Headers SSE — debe ir antes del primer write
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.status(200)
  if (typeof res.flushHeaders === 'function') res.flushHeaders()

  let opId: string | null = null
  try {
    const { userId } = await authenticateUser(req)

    const body = req.body as {
      file_paths?: string[]
      file_names?: string[]
      instruction?: string
      master_excel_path?: string
      master_excel_name?: string
    }
    const paths = body.file_paths || []
    const names = body.file_names || []
    const instruction = (body.instruction || '').trim()

    if (paths.length === 0 || paths.length !== names.length) {
      emit(res, { type: 'error', message: 'Faltan archivos (file_paths y file_names)' })
      return res.end()
    }
    if (!instruction) {
      emit(res, { type: 'error', message: 'Falta la instrucción de extracción' })
      return res.end()
    }

    const quota = await checkQuota(userId)
    if (!quota.allowed) {
      emit(res, {
        type: 'error',
        message: `Has alcanzado tu límite de ${quota.limit} operaciones en 30 días. Plan: ${quota.plan}.`,
      })
      return res.end()
    }

    emit(res, { type: 'started', files: names.length, has_master: !!body.master_excel_path })

    const admin = getSupabaseAdmin()

    // 1) Parseo de intent (ANTES de insertar la operación — si pide aclaración
    //    o falla, no contamina la tabla de operaciones ni gasta cuota)
    emit(res, { type: 'intent_parsing', instruction })
    const intent = await parseIntent(instruction)
    if (intent.confidence === 'low' && intent.clarification_needed) {
      emit(res, {
        type: 'clarification_needed',
        question: intent.clarification_needed,
        detected_schema: intent.detected_schema,
      })
      // Sin insert → no cuenta en cuota, no deja row huérfano
      return res.end()
    }
    let schema = intent.detected_schema
    emit(res, { type: 'schema_detected', schema })

    // Registrar operación (recién aquí, después de pasar intent parsing)
    const { data: opRow } = await admin
      .from('operations')
      .insert({
        user_id: userId,
        operation_type: 'universal_extract',
        status: 'processing',
        input_file: paths[0],
        input_filename: names.join(', '),
        metadata: { instruction, file_count: paths.length, master: body.master_excel_name || null, schema },
      })
      .select('id')
      .single()
    opId = (opRow?.id as string) || null

    // 2) Descargar + parsear archivos
    const parsed: ParsedFile[] = []
    const logEntries: ProcessingLogEntry[] = []
    for (let i = 0; i < paths.length; i++) {
      emit(res, { type: 'file_downloading', file: names[i], index: i, total: paths.length })
      const buf = await downloadFromStorage(paths[i])
      emit(res, { type: 'file_parsing', file: names[i], index: i, total: paths.length, bytes: buf.length })
      const p = await parseFile(buf, names[i])
      parsed.push(p)
      logEntries.push({
        filename: p.filename,
        kind: p.kind,
        pages: p.pages,
        sheets: p.tables.length || undefined,
        images: p.images.length || undefined,
        observaciones: p.warnings.join('; ') || '',
      })
    }

    // 3) Master Excel (si viene): leemos y, si el usuario no fue específico,
    //    sobrescribimos schema con sus headers
    let masterRecords: ExtractedRecord[] = []
    if (body.master_excel_path && body.master_excel_name) {
      emit(res, { type: 'file_downloading', file: body.master_excel_name, master: true })
      const buf = await downloadFromStorage(body.master_excel_path)
      const masterParsed = await parseFile(buf, body.master_excel_name)
      const allRows = masterParsed.tables.flatMap(t => t.rows)
      const m = masterRowsToRecords(allRows)
      masterRecords = m.records
      if (m.schema.length > 0) {
        schema = m.schema
        emit(res, { type: 'schema_detected', schema, source: 'master_excel' })
      }
    }

    if (schema.length === 0) {
      emit(res, {
        type: 'error',
        message: 'No pude determinar las columnas a extraer. Sé más específico o sube un Excel maestro.',
      })
      return res.end()
    }

    // 4) Extracción con vision
    let allRecords: ExtractedRecord[] = []
    await extractFromFiles(parsed, schema, ev => {
      const { type: subtype, ...rest } = ev
      emit(res, { type: 'extracting', subtype, ...rest })
      if (ev.type === 'record_found') allRecords.push(ev.record)
    }).then(result => {
      // El extracted ya emitió record_found; usamos su set agregado por chunks
      // (más robusto que confiar en los callbacks porque dedupea estructuralmente).
      allRecords = result.records
      // log per-file: aproximación — distribuimos records_found en el log
      const recordsPerFile = new Map<string, number>()
      for (const r of result.records) {
        const sf = String(r.source_file || '')
        recordsPerFile.set(sf, (recordsPerFile.get(sf) || 0) + 1)
      }
      for (const e of logEntries) {
        e.records_found = recordsPerFile.get(e.filename) || 0
      }
      ;(handler as unknown as { _review: typeof result.review_required })._review = result.review_required
    })

    // 5) Normalizar
    emit(res, { type: 'normalizing', count: allRecords.length })
    let normalized = normalizeRecords(allRecords, schema)

    // 6) Merge con maestro
    let added = normalized.length
    let updated = 0
    let conflicts: ExtractedRecord[] = []
    if (masterRecords.length > 0) {
      emit(res, { type: 'merging_master', existing: masterRecords.length, incoming: normalized.length })
      const masterNormalized = normalizeRecords(masterRecords, schema)
      const merge = mergeWithMaster(masterNormalized, normalized, schema)
      normalized = merge.merged
      added = merge.added
      updated = merge.updated
      conflicts = merge.conflicts
    }

    // 7) Construir Excel
    emit(res, { type: 'generating_excel', total_rows: normalized.length })
    const reviewRequired = ((handler as unknown as { _review?: { issue: string; source: string; suggested_action: string }[] })._review) || []
    const reviewWithConflicts = [
      ...reviewRequired,
      ...conflicts.map(c => ({
        issue: `Conflicto en columna ${c.__conflict_field}: maestro="${c.__master_value}" vs nuevo="${c[String(c.__conflict_field)]}"`,
        source: String(c.source_file || ''),
        suggested_action: 'Revisar manualmente cuál valor es correcto.',
      })),
    ]
    // distribuir added/updated en log (simplificado a la última fila)
    if (logEntries.length > 0) {
      logEntries[logEntries.length - 1].rows_added = added
      logEntries[logEntries.length - 1].rows_updated = updated
    }
    const outBuf = await buildOutputWorkbook({
      schema,
      records: normalized,
      reviewRequired: reviewWithConflicts,
      processingLog: logEntries,
    })

    // 8) Subir + signed URL
    const ts = Date.now()
    const outName = `extraccion_${ts}.xlsx`
    const outPath = `${userId}/outputs/${ts}_${outName}`
    emit(res, { type: 'uploading', filename: outName })
    await uploadToStorage(
      outPath,
      outBuf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    const downloadUrl = await getSignedDownloadUrl(outPath)

    if (opId) {
      await admin
        .from('operations')
        .update({
          status: 'completed',
          output_file: outPath,
          output_filename: outName,
          metadata: {
            schema,
            records: normalized.length,
            added,
            updated,
            review: reviewWithConflicts.length,
          },
          completed_at: new Date().toISOString(),
        })
        .eq('id', opId)
    }

    emit(res, {
      type: 'completed',
      download_url: downloadUrl,
      output_filename: outName,
      total_records: normalized.length,
      added,
      updated,
      review_required: reviewWithConflicts.length,
      schema,
    })
    return res.end()
  } catch (e) {
    console.error('universal-extract error:', e)
    const mapped = mapOpenAIError(e)
    const message = mapped?.message || (e instanceof Error ? e.message : 'Error desconocido')
    if (opId) {
      try {
        await getSupabaseAdmin()
          .from('operations')
          .update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
          .eq('id', opId)
      } catch { /* ignore */ }
    }
    emit(res, { type: 'error', message })
    return res.end()
  }
}
