/**
 * Normalización, deduplicación y merge con Excel maestro.
 */
import type { ExtractedRecord } from './extraction-engine.js'

const PLACEHOLDER = 'Información no disponible'
const ILLEGIBLE = 'Imagen borrosa o ilegible'

const KEY_FIELDS = ['email', 'correo', 'telefono', 'phone', 'id', 'cedula', 'nit', 'serial', 'factura', 'numero_factura']

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const matrix: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  )
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      )
    }
  }
  return matrix[a.length][b.length]
}

function similar(a: string, b: string, threshold = 0.85): boolean {
  if (!a || !b) return false
  const A = a.trim().toLowerCase()
  const B = b.trim().toLowerCase()
  if (A === B) return true
  const maxLen = Math.max(A.length, B.length)
  if (maxLen === 0) return false
  const dist = levenshtein(A, B)
  return 1 - dist / maxLen >= threshold
}

export function normalizeRecord(record: ExtractedRecord, schema: string[]): ExtractedRecord {
  const out: ExtractedRecord = {}
  for (const col of schema) {
    const raw = record[col]
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      out[col] = PLACEHOLDER
      continue
    }
    if (typeof raw === 'string') {
      const trimmed = raw.trim()
      if (/^(n\/?a|sin datos|no disponible|—|-)$/i.test(trimmed)) out[col] = PLACEHOLDER
      else if (/borros|ilegible/i.test(trimmed)) out[col] = ILLEGIBLE
      else out[col] = trimmed
    } else {
      out[col] = raw
    }
  }
  // Preservar metadata útil si existe
  for (const k of ['source_file', 'source_page', 'source_sheet', 'source_image', 'confidence', 'review_notes']) {
    if (record[k] !== undefined) out[k] = record[k]
  }
  return out
}

export function normalizeRecords(records: ExtractedRecord[], schema: string[]): ExtractedRecord[] {
  return records.map(r => normalizeRecord(r, schema))
}

function detectKeyField(schema: string[]): string | null {
  for (const k of KEY_FIELDS) {
    const found = schema.find(s => s.toLowerCase().includes(k))
    if (found) return found
  }
  return null
}

function recordsMatch(a: ExtractedRecord, b: ExtractedRecord, schema: string[], key: string | null): boolean {
  if (key) {
    const va = String(a[key] || '').trim()
    const vb = String(b[key] || '').trim()
    if (!va || va === PLACEHOLDER || !vb || vb === PLACEHOLDER) return false
    return va.toLowerCase() === vb.toLowerCase()
  }
  // fuzzy: contar columnas similares
  let matches = 0
  for (const col of schema) {
    const va = String(a[col] || '')
    const vb = String(b[col] || '')
    if (va === PLACEHOLDER || vb === PLACEHOLDER) continue
    if (similar(va, vb)) matches++
    if (matches >= 3) return true
  }
  return false
}

export type MergeResult = {
  merged: ExtractedRecord[]
  added: number
  updated: number
  conflicts: ExtractedRecord[]
}

export function mergeWithMaster(
  master: ExtractedRecord[],
  incoming: ExtractedRecord[],
  schema: string[],
): MergeResult {
  const key = detectKeyField(schema)
  const merged = master.map(r => ({ ...r }))
  const conflicts: ExtractedRecord[] = []
  let added = 0
  let updated = 0

  for (const rec of incoming) {
    const idx = merged.findIndex(m => recordsMatch(m, rec, schema, key))
    if (idx === -1) {
      merged.push(rec)
      added++
    } else {
      // Update: si maestro tiene placeholder y el nuevo tiene dato real → reemplaza
      let didUpdate = false
      const m = merged[idx]
      for (const col of schema) {
        const mv = String(m[col] || '')
        const rv = String(rec[col] || '')
        if ((mv === PLACEHOLDER || mv === ILLEGIBLE || mv === '') && rv && rv !== PLACEHOLDER && rv !== ILLEGIBLE) {
          m[col] = rec[col]
          didUpdate = true
        } else if (mv && rv && mv !== rv && rv !== PLACEHOLDER && rv !== ILLEGIBLE) {
          // Conflicto
          conflicts.push({ ...rec, __conflict_field: col, __master_value: mv })
        }
      }
      if (didUpdate) updated++
    }
  }

  return { merged, added, updated, conflicts }
}

export function masterRowsToRecords(
  rows: (string | number | null)[][],
): { schema: string[]; records: ExtractedRecord[] } {
  if (rows.length === 0) return { schema: [], records: [] }
  const headers = rows[0].map(v => String(v ?? '').trim()).filter(Boolean)
  const records: ExtractedRecord[] = []
  for (let i = 1; i < rows.length; i++) {
    const r: ExtractedRecord = {}
    for (let j = 0; j < headers.length; j++) {
      const v = rows[i][j]
      r[headers[j]] = v === null || v === undefined ? PLACEHOLDER : v
    }
    records.push(r)
  }
  return { schema: headers, records }
}
