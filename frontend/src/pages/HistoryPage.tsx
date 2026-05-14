import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Profile, supabase, Operation } from '../lib/supabase'
import { ArrowLeft, Download, Clock, CheckCircle2, XCircle, Loader2 } from 'lucide-react'

const TYPE_LABELS: Record<string, string> = {
  photo_extract: 'Extraer fotos',
  pdf_to_word: 'PDF → Word',
  pdf_to_excel: 'PDF → Excel',
  word_to_pdf: 'Word → PDF',
  excel_to_pdf: 'Excel → PDF',
}

export default function HistoryPage({ profile }: { profile: Profile }) {
  const [operations, setOperations] = useState<Operation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchOps = async () => {
      const { data } = await supabase
        .from('operations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)
      setOperations((data as Operation[]) || [])
      setLoading(false)
    }
    fetchOps()
  }, [])

  const handleDownload = async (op: Operation) => {
    if (!op.output_file) return
    const { data, error } = await supabase.storage.from('files').createSignedUrl(op.output_file, 3600)
    if (error) {
      alert(`No se pudo generar el link: ${error.message}`)
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-slate-300 hover:text-white transition text-sm">
            <ArrowLeft className="w-4 h-4" />
            Volver al dashboard
          </Link>
          <p className="text-sm text-slate-400">{profile.email}</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-white mb-2">Historial</h1>
        <p className="text-slate-400 mb-8">Tus últimas 50 operaciones</p>

        {loading && <p className="text-slate-500">Cargando…</p>}

        {!loading && operations.length === 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center">
            <p className="text-slate-400">Aún no has procesado ningún archivo.</p>
            <Link to="/" className="mt-4 inline-block text-amber-400 hover:text-amber-300">
              Empezar →
            </Link>
          </div>
        )}

        {!loading && operations.length > 0 && (
          <div className="space-y-3">
            {operations.map(op => {
              const date = new Date(op.created_at).toLocaleString('es-CO', {
                day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
              })
              return (
                <div
                  key={op.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4"
                >
                  <StatusIcon status={op.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{op.input_filename || '(sin nombre)'}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {TYPE_LABELS[op.operation_type] || op.operation_type} · {date}
                    </p>
                    {op.error_message && (
                      <p className="text-xs text-red-400 mt-1">{op.error_message}</p>
                    )}
                  </div>
                  {op.status === 'completed' && op.output_file && (
                    <button
                      onClick={() => handleDownload(op)}
                      className="flex items-center gap-2 text-sm text-amber-400 hover:text-amber-300 transition px-3 py-1.5 rounded-lg hover:bg-slate-800"
                    >
                      <Download className="w-4 h-4" />
                      Descargar
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
  if (status === 'failed')    return <XCircle className="w-5 h-5 text-red-400 shrink-0" />
  if (status === 'processing' || status === 'pending') return <Loader2 className="w-5 h-5 text-amber-400 shrink-0 animate-spin" />
  return <Clock className="w-5 h-5 text-slate-500 shrink-0" />
}
