import { useNavigate, Link } from 'react-router-dom'
import { Profile, supabase } from '../lib/supabase'
import { Camera, FileText, FileSpreadsheet, FileOutput, Sparkles, History, LogOut, Crown, ShieldCheck } from 'lucide-react'

const OPERATIONS = [
  {
    type: 'photo_extract',
    title: 'Extraer datos de fotos',
    description: 'Sube fotos de placas o documentos. Claude lee los datos y te entrega un Excel.',
    icon: Camera,
    color: 'from-purple-500 to-pink-500',
  },
  {
    type: 'pdf_to_word',
    title: 'PDF → Word',
    description: 'Convierte un PDF a un documento Word editable.',
    icon: FileText,
    color: 'from-blue-500 to-cyan-500',
  },
  {
    type: 'pdf_to_excel',
    title: 'PDF → Excel',
    description: 'Extrae tablas de un PDF a una hoja Excel.',
    icon: FileSpreadsheet,
    color: 'from-emerald-500 to-teal-500',
  },
  {
    type: 'word_to_pdf',
    title: 'Word → PDF',
    description: 'Convierte un Word a PDF.',
    icon: FileOutput,
    color: 'from-orange-500 to-red-500',
  },
  {
    type: 'excel_to_pdf',
    title: 'Excel → PDF',
    description: 'Convierte una hoja Excel a PDF.',
    icon: FileOutput,
    color: 'from-yellow-500 to-amber-500',
  },
  {
    type: 'word_excel_fill',
    title: 'Rellenar Excel desde fotos en Word',
    description: 'Sube un Word con imágenes y un Excel con la tabla destino. La IA llena el Excel con los datos de cada foto.',
    icon: Sparkles,
    color: 'from-fuchsia-500 to-violet-500',
  },
]

export default function DashboardPage({ profile }: { profile: Profile }) {
  const navigate = useNavigate()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
              <Crown className="w-5 h-5 text-white" />
            </div>
            <span className="text-white font-bold text-lg">AURION Tools</span>
          </div>
          <div className="flex items-center gap-4">
            {profile.is_admin && (
              <Link
                to="/admin"
                className="flex items-center gap-2 text-amber-400 hover:text-amber-300 transition text-sm"
              >
                <ShieldCheck className="w-4 h-4" />
                Admin
              </Link>
            )}
            <Link
              to="/history"
              className="flex items-center gap-2 text-slate-300 hover:text-white transition text-sm"
            >
              <History className="w-4 h-4" />
              Historial
            </Link>
            <div className="text-right">
              <p className="text-sm text-slate-300">{profile.email}</p>
              <p className="text-xs text-slate-500">
                Plan {profile.plan} {profile.is_admin && '· Admin'}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
              title="Cerrar sesión"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-white">¿Qué quieres hacer hoy?</h1>
          <p className="text-slate-400 mt-2">
            Elige una operación. Sube tu archivo y deja que la IA haga el trabajo.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {OPERATIONS.map(op => {
            const Icon = op.icon
            return (
              <Link
                key={op.type}
                to={`/op/${op.type}`}
                className="group bg-slate-900 border border-slate-800 rounded-2xl p-6 hover:border-slate-600 transition"
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${op.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{op.title}</h3>
                <p className="text-sm text-slate-400">{op.description}</p>
              </Link>
            )
          })}
        </div>
      </main>
    </div>
  )
}
