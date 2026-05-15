/**
 * Construye el .xlsx de salida con 3 hojas: Data / Revisión requerida / Registro de procesamiento.
 */
import ExcelJS from 'exceljs'
import type { ExtractedRecord, ReviewItem } from './extraction-engine.js'

export type ProcessingLogEntry = {
  filename: string
  kind: string
  pages?: number
  sheets?: number
  images?: number
  records_found?: number
  rows_added?: number
  rows_updated?: number
  observaciones?: string
}

export type BuildInput = {
  schema: string[]
  records: ExtractedRecord[]
  reviewRequired: ReviewItem[]
  processingLog: ProcessingLogEntry[]
}

const HEADER_FILL: ExcelJS.FillPattern = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE5E5E5' },
}

const META_COLS = ['source_file', 'source_page', 'source_sheet', 'source_image', 'confidence', 'review_notes']

function applyHeaderStyle(ws: ExcelJS.Worksheet): void {
  const row = ws.getRow(1)
  row.font = { bold: true }
  row.fill = HEADER_FILL
  row.alignment = { vertical: 'middle' }
}

function autoWidth(ws: ExcelJS.Worksheet): void {
  ws.columns.forEach(col => {
    let max = 10
    col.eachCell?.({ includeEmpty: false }, cell => {
      const v = cell.value
      const s = v === null || v === undefined ? '' : String(v)
      if (s.length > max) max = Math.min(s.length, 60)
    })
    col.width = max + 2
  })
}

export async function buildOutputWorkbook(input: BuildInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()

  // Hoja 1: Data
  const dataSheet = wb.addWorksheet('Data')
  const allCols = [...input.schema, ...META_COLS]
  dataSheet.columns = allCols.map(c => ({ header: c, key: c, width: 18 }))
  applyHeaderStyle(dataSheet)
  for (const rec of input.records) {
    const row: Record<string, unknown> = {}
    for (const c of allCols) row[c] = rec[c] ?? ''
    dataSheet.addRow(row)
  }
  autoWidth(dataSheet)

  // Hoja 2: Revisión requerida
  const reviewSheet = wb.addWorksheet('Revisión requerida')
  reviewSheet.columns = [
    { header: 'issue', key: 'issue', width: 40 },
    { header: 'source', key: 'source', width: 30 },
    { header: 'suggested_action', key: 'suggested_action', width: 50 },
  ]
  applyHeaderStyle(reviewSheet)
  for (const r of input.reviewRequired) {
    reviewSheet.addRow({
      issue: r.issue || '',
      source: r.source || '',
      suggested_action: r.suggested_action || '',
    })
  }
  if (input.reviewRequired.length === 0) {
    reviewSheet.addRow({ issue: '(ninguna)', source: '', suggested_action: '' })
  }
  autoWidth(reviewSheet)

  // Hoja 3: Registro de procesamiento
  const logSheet = wb.addWorksheet('Registro de procesamiento')
  logSheet.columns = [
    { header: 'archivo', key: 'filename', width: 30 },
    { header: 'tipo', key: 'kind', width: 12 },
    { header: 'paginas', key: 'pages', width: 10 },
    { header: 'hojas', key: 'sheets', width: 10 },
    { header: 'imagenes', key: 'images', width: 10 },
    { header: 'registros_encontrados', key: 'records_found', width: 22 },
    { header: 'filas_agregadas', key: 'rows_added', width: 18 },
    { header: 'filas_actualizadas', key: 'rows_updated', width: 18 },
    { header: 'observaciones', key: 'observaciones', width: 50 },
  ]
  applyHeaderStyle(logSheet)
  for (const e of input.processingLog) {
    logSheet.addRow({
      filename: e.filename,
      kind: e.kind,
      pages: e.pages ?? '',
      sheets: e.sheets ?? '',
      images: e.images ?? '',
      records_found: e.records_found ?? '',
      rows_added: e.rows_added ?? '',
      rows_updated: e.rows_updated ?? '',
      observaciones: e.observaciones ?? '',
    })
  }
  autoWidth(logSheet)

  return Buffer.from(await wb.xlsx.writeBuffer())
}
