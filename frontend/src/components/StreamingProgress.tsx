import { useEffect, useRef } from 'react'
import {
  FileUp,
  FileSearch,
  Brain,
  Table,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Layers,
  Download,
  XCircle,
} from 'lucide-react'

export type ProgressEvent = {
  type: string
  ts?: number
  [key: string]: unknown
}

function iconFor(type: string) {
  switch (type) {
    case 'started':
      return Sparkles
    case 'file_downloading':
      return FileUp
    case 'file_parsing':
      return FileSearch
    case 'intent_parsing':
    case 'schema_detected':
      return Brain
    case 'extracting':
    case 'record_found':
      return Table
    case 'normalizing':
    case 'merging_master':
      return Layers
    case 'generating_excel':
    case 'uploading':
      return Download
    case 'completed':
      return CheckCircle2
    case 'error':
    case 'clarification_needed':
      return AlertTriangle
    case 'chunk_failed':
      return XCircle
    case 'separator':
      return Sparkles
    default:
      return Sparkles
  }
}

function colorFor(type: string): string {
  if (type === 'completed') return 'text-green-400'
  if (type === 'error' || type === 'chunk_failed') return 'text-red-400'
  if (type === 'clarification_needed') return 'text-amber-400'
  if (type === 'record_found') return 'text-emerald-300'
  if (type === 'separator') return 'text-slate-500 italic'
  return 'text-slate-300'
}

function describe(ev: ProgressEvent): string {
  switch (ev.type) {
    case 'started':
      return `Iniciando proceso con ${ev.files} archivo(s)${ev.has_master ? ' + maestro' : ''}`
    case 'intent_parsing':
      return `Interpretando: "${String(ev.instruction).slice(0, 80)}"`
    case 'schema_detected':
      return `Columnas detectadas${ev.source === 'master_excel' ? ' (desde maestro)' : ''}: ${(ev.schema as string[]).join(', ')}`
    case 'clarification_needed':
      return `Necesito una aclaración: ${ev.question}`
    case 'file_downloading':
      return ev.master
        ? `Descargando maestro: ${ev.file}`
        : `Descargando ${ev.index !== undefined ? `${(ev.index as number) + 1}/${ev.total}` : ''}: ${ev.file}`
    case 'file_parsing':
      return `Parseando ${ev.file} (${((ev.bytes as number) / 1024).toFixed(0)} KB)`
    case 'extracting': {
      const t = ev as { type: string; file?: string; chunk?: number; total?: number; records?: number; error?: string; record?: Record<string, unknown> }
      if ('record' in t) return `Registro encontrado en ${t.file || '...'}`
      if ('error' in t && t.error) return `Falló fragmento ${t.chunk}/${t.total} de ${t.file}: ${t.error}`
      if ('records' in t) return `Fragmento ${t.chunk}/${t.total} de ${t.file}: ${t.records} registros`
      return `Procesando fragmento ${t.chunk}/${t.total} de ${t.file}`
    }
    case 'record_found':
      return `Registro encontrado en ${ev.source}`
    case 'normalizing':
      return `Normalizando ${ev.count} registros`
    case 'merging_master':
      return `Mergeando con maestro (${ev.existing} existentes, ${ev.incoming} nuevos)`
    case 'generating_excel':
      return `Generando Excel con ${ev.total_rows} filas`
    case 'uploading':
      return `Subiendo ${ev.filename}`
    case 'completed':
      return `✓ ${ev.total_records} registros · ${ev.added} nuevos · ${ev.updated} actualizados · ${ev.review_required} en revisión`
    case 'error':
      return `Error: ${ev.message}`
    case 'separator':
      return String(ev.text || '──────────')
    default:
      return ev.type
  }
}

export function StreamingProgress({ events }: { events: ProgressEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events])

  return (
    <div
      ref={scrollRef}
      className="bg-slate-900 border border-slate-800 rounded-2xl p-5 h-96 overflow-y-auto font-mono text-sm space-y-2"
    >
      {events.length === 0 && (
        <p className="text-slate-500 italic">Esperando inicio del procesamiento...</p>
      )}
      {events.map((ev, i) => {
        const Icon = iconFor(ev.type)
        const color = colorFor(ev.type)
        return (
          <div key={i} className="flex items-start gap-2 animate-in fade-in">
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
            <span className={`${color} break-all`}>{describe(ev)}</span>
          </div>
        )
      })}
    </div>
  )
}
