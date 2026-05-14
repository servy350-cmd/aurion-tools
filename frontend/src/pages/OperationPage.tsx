import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import { Profile, supabase } from '../lib/supabase'
import { ArrowLeft, Upload, Loader2, Download, AlertCircle, CheckCircle2 } from 'lucide-react'

const OPERATION_CONFIG: Record<string, { title: string; accept: Record<string, string[]>; description: string }> = {
  photo_extract: {
    title: 'Extraer datos de fotos',
    accept: {
      'application/pdf': ['.pdf'],
      'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    description: 'Sube un PDF/Word con fotos de placas, o imágenes directas. La IA leerá los datos.',
  },
  pdf_to_word: {
    title: 'PDF → Word',
    accept: { 'application/pdf': ['.pdf'] },
    description: 'Sube un PDF. Te devolveremos un Word editable.',
  },
  pdf_to_excel: {
    title: 'PDF → Excel',
    accept: { 'application/pdf': ['.pdf'] },
    description: 'Sube un PDF con tablas. Te devolveremos un Excel.',
  },
  word_to_pdf: {
    title: 'Word → PDF',
    accept: {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/msword': ['.doc'],
    },
    description: 'Sube un Word. Te devolveremos un PDF.',
  },
  excel_to_pdf: {
    title: 'Excel → PDF',
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    description: 'Sube un Excel. Te devolveremos un PDF.',
  },
}

export default function OperationPage({ profile }: { profile: Profile }) {
  const { type } = useParams<{ type: string }>()
  const navigate = useNavigate()
  const config = type ? OPERATION_CONFIG[type] : null

  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState('')
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [outputName, setOutputName] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: config?.accept,
    multiple: false,
    onDrop: accepted => {
      if (accepted.length > 0) {
        setFile(accepted[0])
        setStatus('idle')
        setErrorMsg(null)
        setDownloadUrl(null)
      }
    },
  })

  if (!config || !type) {
    return <Navigate />
  }

  const handleProcess = async () => {
    if (!file || !type) return
    setStatus('uploading')
    setProgress('Subiendo archivo…')
    setErrorMsg(null)

    try {
      // 1) Subir archivo a Supabase Storage
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        throw new Error('Sesión expirada. Vuelve a iniciar sesión.')
      }
      const userId = session.user.id
      const ts = Date.now()
      const ext = file.name.split('.').pop()
      const path = `${userId}/inputs/${ts}.${ext}`
      const { error: uploadErr } = await supabase.storage.from('files').upload(path, file, {
        contentType: file.type,
        upsert: false,
      })
      if (uploadErr) throw new Error(`Error subiendo: ${uploadErr.message}`)

      // 2) Llamar al endpoint del backend
      setStatus('processing')
      setProgress('Procesando con IA…')

      const res = await fetch(`/api/operations/${type.replace(/_/g, '-')}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          input_path: path,
          input_filename: file.name,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Error ${res.status}`)
      }

      const result = await res.json()
      setDownloadUrl(result.download_url)
      setOutputName(result.output_filename)
      setStatus('done')
      setProgress('')
    } catch (e: any) {
      setStatus('error')
      setErrorMsg(e.message || 'Error desconocido')
    }
  }

  const handleReset = () => {
    setFile(null)
    setStatus('idle')
    setErrorMsg(null)
    setDownloadUrl(null)
    setOutputName(null)
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-slate-300 hover:text-white transition text-sm">
            <ArrowLeft className="w-4 h-4" />
            Volver
          </Link>
          <p className="text-sm text-slate-400">{profile.email}</p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-white mb-2">{config.title}</h1>
        <p className="text-slate-400 mb-8">{config.description}</p>

        {/* Dropzone */}
        {status === 'idle' && (
          <>
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition ${
                isDragActive
                  ? 'border-amber-500 bg-amber-500/10'
                  : 'border-slate-700 bg-slate-900/50 hover:border-slate-500'
              }`}
            >
              <input {...getInputProps()} />
              <Upload className="w-12 h-12 text-slate-500 mx-auto mb-4" />
              {file ? (
                <>
                  <p className="text-white font-medium mb-1">{file.name}</p>
                  <p className="text-sm text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </>
              ) : (
                <>
                  <p className="text-white font-medium mb-1">
                    {isDragActive ? 'Suelta el archivo aquí' : 'Arrastra un archivo o haz click'}
                  </p>
                  <p className="text-sm text-slate-500">
                    Formatos aceptados: {Object.values(config.accept).flat().join(', ')}
                  </p>
                </>
              )}
            </div>

            {file && (
              <button
                onClick={handleProcess}
                className="mt-6 w-full bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl py-4 transition"
              >
                Procesar archivo
              </button>
            )}
          </>
        )}

        {/* Processing */}
        {(status === 'uploading' || status === 'processing') && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center">
            <Loader2 className="w-12 h-12 text-amber-500 mx-auto mb-4 animate-spin" />
            <p className="text-white font-medium">{progress}</p>
            <p className="text-sm text-slate-400 mt-2">
              Esto puede tomar entre 10 y 60 segundos.
            </p>
          </div>
        )}

        {/* Done */}
        {status === 'done' && downloadUrl && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">¡Listo!</h2>
            <p className="text-slate-300 mb-6">Tu archivo está procesado.</p>
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
                Procesar otro archivo
              </button>
            </div>
          </div>
        )}

        {/* Error */}
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

// Helper Navigate component
function Navigate() {
  const navigate = useNavigate()
  if (typeof window !== 'undefined') navigate('/')
  return null
}
