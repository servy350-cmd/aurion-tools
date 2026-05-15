import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import { Profile, supabase } from '../../lib/supabase'
import {
  ArrowLeft,
  Upload,
  Loader2,
  Download,
  AlertCircle,
  CheckCircle2,
  FileText,
  FileSpreadsheet,
} from 'lucide-react'

const MAX_FILE_BYTES = 50 * 1024 * 1024

type Status = 'idle' | 'uploading' | 'processing' | 'done' | 'error'

function FileDropzone({
  label,
  accept,
  file,
  onFile,
  Icon,
}: {
  label: string
  accept: Record<string, string[]>
  file: File | null
  onFile: (f: File | null, err: string | null) => void
  Icon: typeof FileText
}) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept,
    multiple: false,
    maxSize: MAX_FILE_BYTES,
    onDrop: (accepted, rejected) => {
      if (rejected.length > 0) {
        const tooBig = rejected[0].errors.some(e => e.code === 'file-too-large')
        onFile(null, tooBig ? 'Archivo muy grande, máximo 50 MB.' : 'Tipo de archivo no válido.')
        return
      }
      if (accepted.length > 0) onFile(accepted[0], null)
    },
  })

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition ${
        isDragActive
          ? 'border-amber-500 bg-amber-500/10'
          : 'border-slate-700 bg-slate-900/50 hover:border-slate-500'
      }`}
    >
      <input {...getInputProps()} />
      <Icon className="w-10 h-10 text-slate-500 mx-auto mb-3" />
      <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">{label}</p>
      {file ? (
        <>
          <p className="text-white font-medium">{file.name}</p>
          <p className="text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
        </>
      ) : (
        <>
          <p className="text-white font-medium">
            {isDragActive ? 'Suelta el archivo' : 'Arrastra o haz click'}
          </p>
          <p className="text-xs text-slate-500 mt-1">{Object.values(accept).flat().join(', ')}</p>
        </>
      )}
    </div>
  )
}

export default function WordExcelFillPage({ profile }: { profile: Profile }) {
  const [wordFile, setWordFile] = useState<File | null>(null)
  const [excelFile, setExcelFile] = useState<File | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState('')
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [outputName, setOutputName] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  if (!profile) return <Navigate to="/login" replace />

  const handleProcess = async () => {
    if (!wordFile || !excelFile) return
    setStatus('uploading')
    setProgress('Subiendo archivos...')
    setErrorMsg(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sesión expirada. Vuelve a iniciar sesión.')
      const userId = session.user.id
      const ts = Date.now()

      const wordPath = `${userId}/inputs/${ts}_word.docx`
      const excelPath = `${userId}/inputs/${ts}_excel.xlsx`

      const [u1, u2] = await Promise.all([
        supabase.storage.from('files').upload(wordPath, wordFile, {
          contentType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          upsert: false,
        }),
        supabase.storage.from('files').upload(excelPath, excelFile, {
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: false,
        }),
      ])
      if (u1.error) throw new Error(`Error subiendo Word: ${u1.error.message}`)
      if (u2.error) throw new Error(`Error subiendo Excel: ${u2.error.message}`)

      setStatus('processing')
      setProgress('Procesando con IA, esto puede tardar 30s a 2 min...')

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 180_000)

      let res: Response
      try {
        res = await fetch('/api/operations/word-excel-fill', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            word_path: wordPath,
            word_filename: wordFile.name,
            excel_path: excelPath,
            excel_filename: excelFile.name,
          }),
          signal: controller.signal,
        })
      } catch (fetchErr) {
        if (fetchErr instanceof DOMException && fetchErr.name === 'AbortError') {
          throw new Error('Tiempo de espera agotado, intenta de nuevo.')
        }
        throw fetchErr
      } finally {
        clearTimeout(timeoutId)
      }

      if (res.status === 503) {
        const err = await res.json().catch(() => ({}))
        throw new Error(
          err.error ||
          'Esta operación está deshabilitada porque falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor. Contacta al administrador.'
        )
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Error ${res.status}`)
      }

      const result = await res.json()
      setDownloadUrl(result.download_url)
      setOutputName(result.output_filename)
      setStatus('done')
      setProgress('')
    } catch (e) {
      setStatus('error')
      setErrorMsg(e instanceof Error ? e.message : 'Error desconocido')
    }
  }

  const handleReset = () => {
    setWordFile(null)
    setExcelFile(null)
    setStatus('idle')
    setErrorMsg(null)
    setDownloadUrl(null)
    setOutputName(null)
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2 text-slate-300 hover:text-white transition text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver
          </Link>
          <p className="text-sm text-slate-400">{profile.email}</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-white mb-2">
          Rellenar Excel desde fotos en Word
        </h1>
        <p className="text-slate-400 mb-8">
          Sube un Word con imágenes y un Excel cuya primera fila define las columnas. La IA
          extrae los datos de cada imagen y los pega como filas del Excel.
        </p>

        {status === 'idle' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <FileDropzone
                label="Word con imágenes"
                accept={{
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                    ['.docx'],
                }}
                file={wordFile}
                onFile={(f, err) => {
                  setWordFile(f)
                  setErrorMsg(err)
                }}
                Icon={FileText}
              />
              <FileDropzone
                label="Excel con headers"
                accept={{
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
                    '.xlsx',
                  ],
                }}
                file={excelFile}
                onFile={(f, err) => {
                  setExcelFile(f)
                  setErrorMsg(err)
                }}
                Icon={FileSpreadsheet}
              />
            </div>

            {errorMsg && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-xl px-4 py-3 mb-4">
                {errorMsg}
              </div>
            )}

            <button
              onClick={handleProcess}
              disabled={!wordFile || !excelFile}
              className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-4 transition flex items-center justify-center gap-2"
            >
              <Upload className="w-5 h-5" />
              Procesar
            </button>
          </>
        )}

        {(status === 'uploading' || status === 'processing') && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center">
            <Loader2 className="w-12 h-12 text-amber-500 mx-auto mb-4 animate-spin" />
            <p className="text-white font-medium">{progress}</p>
            <p className="text-sm text-slate-400 mt-2">
              Una imagen por llamada — el tiempo depende del número de imágenes.
            </p>
          </div>
        )}

        {status === 'done' && downloadUrl && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">¡Listo!</h2>
            <p className="text-slate-300 mb-6">Excel rellenado.</p>
            <a
              href={downloadUrl}
              download={outputName || undefined}
              className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl px-6 py-3 transition"
            >
              <Download className="w-5 h-5" />
              Descargar {outputName}
            </a>
            <div className="mt-6">
              <button onClick={handleReset} className="text-sm text-slate-400 hover:text-white">
                Procesar otro par de archivos
              </button>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-8">
            <AlertCircle className="w-10 h-10 text-red-400 mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">Hubo un error</h2>
            <p className="text-slate-300 mb-6">{errorMsg}</p>
            <button
              onClick={handleReset}
              className="bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-lg px-4 py-2 transition"
            >
              Intentar de nuevo
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
