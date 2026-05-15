import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import { Profile, supabase } from '../../lib/supabase'
import {
  ArrowLeft,
  Upload,
  Download,
  CheckCircle2,
  AlertCircle,
  FileStack,
  FileSpreadsheet,
  Sparkles,
} from 'lucide-react'
import { StreamingProgress, type ProgressEvent } from '../../components/StreamingProgress'
import { streamSSE } from '../../lib/sseClient'

const MAX_FILE_BYTES = 50 * 1024 * 1024

const ROTATING_PLACEHOLDERS = [
  'Sácame nombre, teléfono y correo de cada persona',
  'Extrae factura, fecha y total de cada documento',
  'Saca número de placa, marca, modelo y serie',
  'Extrae cédula, nombre completo y dirección',
  'Lista cada producto con su precio y SKU',
]

const ACCEPTED_INPUT = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
  'text/csv': ['.csv'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
}

const ACCEPTED_MASTER = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
}

type Status = 'idle' | 'running' | 'done' | 'error'

export default function UniversalExtractPage({ profile }: { profile: Profile }) {
  const [files, setFiles] = useState<File[]>([])
  const [masterFile, setMasterFile] = useState<File | null>(null)
  const [instruction, setInstruction] = useState('')
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [status, setStatus] = useState<Status>('idle')
  const [events, setEvents] = useState<ProgressEvent[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [outputName, setOutputName] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ total: number; added: number; updated: number; review: number } | null>(null)

  useEffect(() => {
    if (status !== 'idle') return
    const id = setInterval(() => setPlaceholderIdx(i => (i + 1) % ROTATING_PLACEHOLDERS.length), 3500)
    return () => clearInterval(id)
  }, [status])

  if (!profile) return <Navigate to="/login" replace />

  const inputDz = useDropzone({
    accept: ACCEPTED_INPUT,
    multiple: true,
    maxSize: MAX_FILE_BYTES,
    onDrop: accepted => {
      if (accepted.length > 0) setFiles(prev => [...prev, ...accepted])
    },
  })

  const masterDz = useDropzone({
    accept: ACCEPTED_MASTER,
    multiple: false,
    maxSize: MAX_FILE_BYTES,
    onDrop: accepted => {
      if (accepted.length > 0) setMasterFile(accepted[0])
    },
  })

  const handleReset = () => {
    setFiles([])
    setMasterFile(null)
    setInstruction('')
    setStatus('idle')
    setEvents([])
    setErrorMsg(null)
    setDownloadUrl(null)
    setOutputName(null)
    setSummary(null)
  }

  const handleProcess = async () => {
    if (files.length === 0 || !instruction.trim()) return
    setStatus('running')
    setEvents([])
    setErrorMsg(null)
    setDownloadUrl(null)
    setSummary(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sesión expirada. Vuelve a iniciar sesión.')
      const userId = session.user.id
      const ts = Date.now()

      // Subir todos los archivos en paralelo
      const filePaths: string[] = []
      const fileNames: string[] = []
      const uploadResults = await Promise.all(
        files.map((f, i) => {
          const ext = f.name.split('.').pop() || 'bin'
          const path = `${userId}/inputs/${ts}_${i}.${ext}`
          fileNames.push(f.name)
          filePaths.push(path)
          return supabase.storage.from('files').upload(path, f, {
            contentType: f.type || 'application/octet-stream',
            upsert: false,
          })
        }),
      )
      const uploadErr = uploadResults.find(r => r.error)
      if (uploadErr?.error) throw new Error(`Error subiendo: ${uploadErr.error.message}`)

      let masterPath: string | undefined
      let masterName: string | undefined
      if (masterFile) {
        masterPath = `${userId}/inputs/${ts}_master.xlsx`
        masterName = masterFile.name
        const r = await supabase.storage.from('files').upload(masterPath, masterFile, {
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: false,
        })
        if (r.error) throw new Error(`Error subiendo maestro: ${r.error.message}`)
      }

      // SSE
      for await (const ev of streamSSE('/api/operations/universal-extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          file_paths: filePaths,
          file_names: fileNames,
          instruction: instruction.trim(),
          master_excel_path: masterPath,
          master_excel_name: masterName,
        }),
      })) {
        setEvents(prev => [...prev, { ...ev, ts: Date.now() }])
        if (ev.type === 'completed') {
          setDownloadUrl(String(ev.download_url))
          setOutputName(String(ev.output_filename))
          setSummary({
            total: Number(ev.total_records || 0),
            added: Number(ev.added || 0),
            updated: Number(ev.updated || 0),
            review: Number(ev.review_required || 0),
          })
          setStatus('done')
        }
        if (ev.type === 'error') {
          setErrorMsg(String(ev.message))
          setStatus('error')
        }
      }
      // Si el stream cerró sin completed ni error
      setStatus(s => (s === 'running' ? 'error' : s))
      setErrorMsg(prev => prev ?? (status === 'running' ? 'El servidor cerró la conexión sin completar.' : prev))
    } catch (e) {
      setStatus('error')
      setErrorMsg(e instanceof Error ? e.message : 'Error desconocido')
    }
  }

  const canProcess = files.length > 0 && instruction.trim().length > 0 && status === 'idle'

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-slate-300 hover:text-white transition text-sm">
            <ArrowLeft className="w-4 h-4" />
            Volver
          </Link>
          <p className="text-sm text-slate-400">{profile.email}</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Sparkles className="w-7 h-7 text-fuchsia-400" />
            Extracción Universal
          </h1>
          <p className="text-slate-400 mt-2">
            Sube cualquier archivo (PDF, Word, Excel, CSV, imagen) y dime qué información extraer.
            La IA te devuelve un Excel limpio con todo encontrado.
          </p>
        </div>

        {status === 'idle' && (
          <>
            <div
              {...inputDz.getRootProps()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition ${
                inputDz.isDragActive
                  ? 'border-fuchsia-500 bg-fuchsia-500/10'
                  : 'border-slate-700 bg-slate-900/50 hover:border-slate-500'
              }`}
            >
              <input {...inputDz.getInputProps()} />
              <FileStack className="w-10 h-10 text-slate-500 mx-auto mb-3" />
              <p className="text-white font-medium">
                {inputDz.isDragActive
                  ? 'Suelta los archivos'
                  : files.length > 0
                  ? `${files.length} archivo(s) listo(s) — agrega más o cambia`
                  : 'Arrastra archivos o haz click'}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                xlsx, xls, csv, docx, pdf, jpg, png — hasta 50 MB cada uno
              </p>
              {files.length > 0 && (
                <ul className="mt-4 text-left text-xs text-slate-400 max-w-md mx-auto space-y-1">
                  {files.map((f, i) => (
                    <li key={i} className="truncate">
                      • {f.name} ({(f.size / 1024 / 1024).toFixed(2)} MB)
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <label className="text-sm font-medium text-slate-300 mb-2 block">
                ¿Qué información quieres extraer?
              </label>
              <textarea
                value={instruction}
                onChange={e => setInstruction(e.target.value)}
                placeholder={ROTATING_PLACEHOLDERS[placeholderIdx]}
                rows={3}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:border-fuchsia-500 focus:outline-none resize-none"
              />
            </div>

            <div
              {...masterDz.getRootProps()}
              className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition ${
                masterDz.isDragActive
                  ? 'border-amber-500 bg-amber-500/10'
                  : 'border-slate-800 bg-slate-900/30 hover:border-slate-600'
              }`}
            >
              <input {...masterDz.getInputProps()} />
              <FileSpreadsheet className="w-7 h-7 text-slate-500 mx-auto mb-2" />
              <p className="text-slate-300 text-sm font-medium">
                {masterFile
                  ? `Maestro: ${masterFile.name}`
                  : '¿Tienes un Excel maestro para actualizar? (opcional)'}
              </p>
              <p className="text-xs text-slate-500 mt-1">Solo .xlsx — usaremos sus columnas como esquema</p>
            </div>

            <button
              onClick={handleProcess}
              disabled={!canProcess}
              className="w-full bg-fuchsia-500 hover:bg-fuchsia-600 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-4 transition flex items-center justify-center gap-2"
            >
              <Upload className="w-5 h-5" />
              Procesar
            </button>
          </>
        )}

        {(status === 'running' || status === 'done' || status === 'error') && (
          <>
            <StreamingProgress events={events} />

            {status === 'done' && downloadUrl && summary && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-6">
                <div className="flex items-start gap-3 mb-4">
                  <CheckCircle2 className="w-8 h-8 text-green-400 shrink-0" />
                  <div>
                    <h2 className="text-xl font-semibold text-white">¡Listo!</h2>
                    <p className="text-slate-300 text-sm mt-1">
                      Procesé {files.length} archivo(s). Encontré {summary.total} registros.{' '}
                      Agregué {summary.added} nuevos, actualicé {summary.updated},{' '}
                      dejé {summary.review} en revisión.
                    </p>
                  </div>
                </div>
                <a
                  href={downloadUrl}
                  download={outputName || undefined}
                  className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl px-5 py-3 transition"
                >
                  <Download className="w-5 h-5" />
                  Descargar {outputName}
                </a>
                <div className="mt-4">
                  <button onClick={handleReset} className="text-sm text-slate-400 hover:text-white">
                    Procesar otra extracción
                  </button>
                </div>
              </div>
            )}

            {status === 'error' && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6">
                <div className="flex items-start gap-3 mb-4">
                  <AlertCircle className="w-8 h-8 text-red-400 shrink-0" />
                  <div>
                    <h2 className="text-xl font-semibold text-white">Hubo un error</h2>
                    <p className="text-slate-300 text-sm mt-1">{errorMsg}</p>
                  </div>
                </div>
                <button
                  onClick={handleReset}
                  className="bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-lg px-4 py-2 transition"
                >
                  Intentar de nuevo
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
