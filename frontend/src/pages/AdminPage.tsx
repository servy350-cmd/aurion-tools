import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Profile, supabase, Operation } from '../lib/supabase'
import {
  ArrowLeft,
  Crown,
  ShieldCheck,
  Camera,
  Users,
  Sigma,
  DollarSign,
  Activity,
} from 'lucide-react'

type OperationType =
  | 'photo_extract'
  | 'pdf_to_word'
  | 'pdf_to_excel'
  | 'word_to_pdf'
  | 'excel_to_pdf'
  | 'word_excel_fill'
  | 'universal_extract'

const OPERATION_TYPES: OperationType[] = [
  'photo_extract',
  'pdf_to_word',
  'pdf_to_excel',
  'word_to_pdf',
  'excel_to_pdf',
  'word_excel_fill',
  'universal_extract',
]

const OP_LABELS: Record<OperationType, string> = {
  photo_extract: 'Fotos',
  pdf_to_word: 'PDF → Word',
  pdf_to_excel: 'PDF → Excel',
  word_to_pdf: 'Word → PDF',
  excel_to_pdf: 'Excel → PDF',
  word_excel_fill: 'Word+Excel Fill',
  universal_extract: 'Extracción Universal',
}

const OP_BADGE: Record<OperationType, string> = {
  photo_extract: 'bg-purple-500/20 text-purple-300',
  pdf_to_word: 'bg-blue-500/20 text-blue-300',
  pdf_to_excel: 'bg-emerald-500/20 text-emerald-300',
  word_to_pdf: 'bg-orange-500/20 text-orange-300',
  excel_to_pdf: 'bg-yellow-500/20 text-yellow-300',
  word_excel_fill: 'bg-violet-500/20 text-violet-300',
  universal_extract: 'bg-fuchsia-500/20 text-fuchsia-300',
}

const STATUS_BADGE: Record<string, string> = {
  completed: 'bg-green-500/20 text-green-300',
  failed: 'bg-red-500/20 text-red-300',
  processing: 'bg-amber-500/20 text-amber-300',
  pending: 'bg-slate-500/20 text-slate-300',
}

const CLAUDE_COST_PER_PHOTO_USD = 0.1

type OpCounts = Record<OperationType, number>

type UserRow = {
  id: string
  email: string
  plan: 'FLEX' | 'PRIME'
  is_admin: boolean
  created_at: string
  last_activity: string | null
  by_type: OpCounts
  total: number
}

type RecentOp = Operation & { user_email: string }

type MonthStats = {
  total: number
  by_type: OpCounts
  claude_cost: number
  conversions: number
}

const ZERO_COUNTS = (): OpCounts => ({
  photo_extract: 0,
  pdf_to_word: 0,
  pdf_to_excel: 0,
  word_to_pdf: 0,
  excel_to_pdf: 0,
  word_excel_fill: 0,
  universal_extract: 0,
})

function startOfMonthISO(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AdminPage({ profile }: { profile: Profile }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [users, setUsers] = useState<UserRow[]>([])
  const [recent, setRecent] = useState<RecentOp[]>([])
  const [monthStats, setMonthStats] = useState<MonthStats>({
    total: 0,
    by_type: ZERO_COUNTS(),
    claude_cost: 0,
    conversions: 0,
  })

  useEffect(() => {
    const load = async () => {
      setError(null)

      const [profilesRes, opsRes, recentRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, email, plan, is_admin, created_at')
          .order('created_at', { ascending: true }),
        supabase
          .from('operations')
          .select('id, user_id, operation_type, created_at')
          .order('created_at', { ascending: false })
          .limit(5000),
        supabase
          .from('operations')
          .select('*, profiles!user_id(email)')
          .order('created_at', { ascending: false })
          .limit(100),
      ])

      if (profilesRes.error) {
        setError(`No se pudieron cargar usuarios: ${profilesRes.error.message}`)
        setLoading(false)
        return
      }
      if (opsRes.error) {
        setError(`No se pudieron cargar operaciones: ${opsRes.error.message}`)
        setLoading(false)
        return
      }
      if (recentRes.error) {
        setError(`No se pudieron cargar las últimas operaciones: ${recentRes.error.message}`)
        setLoading(false)
        return
      }

      type LiteOp = {
        id: string
        user_id: string
        operation_type: string
        created_at: string
      }
      const profiles = (profilesRes.data || []) as Pick<
        Profile,
        'id' | 'email' | 'plan' | 'is_admin' | 'created_at'
      >[]
      const ops = (opsRes.data || []) as LiteOp[]

      // Agrupar ops por usuario y por tipo
      const userRows: UserRow[] = profiles.map(p => {
        const userOps = ops.filter(o => o.user_id === p.id)
        const byType = ZERO_COUNTS()
        for (const o of userOps) {
          const t = o.operation_type as OperationType
          if (t in byType) byType[t] += 1
        }
        // ops ya viene DESC, la primera es la última actividad
        const last = userOps[0]?.created_at || null
        return {
          id: p.id,
          email: p.email,
          plan: p.plan,
          is_admin: p.is_admin,
          created_at: p.created_at,
          last_activity: last,
          by_type: byType,
          total: userOps.length,
        }
      })
      setUsers(userRows)

      // Stats del mes
      const since = startOfMonthISO()
      const monthOps = ops.filter(o => o.created_at >= since)
      const monthByType = ZERO_COUNTS()
      for (const o of monthOps) {
        const t = o.operation_type as OperationType
        if (t in monthByType) monthByType[t] += 1
      }
      setMonthStats({
        total: monthOps.length,
        by_type: monthByType,
        claude_cost: monthByType.photo_extract * CLAUDE_COST_PER_PHOTO_USD,
        conversions:
          monthByType.pdf_to_word +
          monthByType.pdf_to_excel +
          monthByType.word_to_pdf +
          monthByType.excel_to_pdf,
      })

      // Últimas 100 con email embebido
      type WithProfile = Operation & { profiles?: { email: string } | null }
      const recentRows: RecentOp[] = ((recentRes.data || []) as WithProfile[]).map(r => ({
        ...r,
        user_email: r.profiles?.email || '—',
      }))
      setRecent(recentRows)

      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
              <Crown className="w-5 h-5 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-white font-bold text-lg">AURION Tools</p>
              <p className="text-xs text-amber-400 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> Admin
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/"
              className="flex items-center gap-2 text-slate-300 hover:text-white transition text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Dashboard de operaciones
            </Link>
            <p className="text-sm text-slate-400 hidden sm:block">{profile.email}</p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-10">
        <div>
          <h1 className="text-3xl font-bold text-white">Panel de administración</h1>
          <p className="text-slate-400 mt-2">Métricas de uso de todos los clientes.</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {/* Stats del mes */}
        <section>
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
            Este mes
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={<Sigma className="w-5 h-5" />}
              label="Operaciones totales"
              value={monthStats.total.toLocaleString('es-CO')}
              tint="from-slate-600 to-slate-700"
            />
            <StatCard
              icon={<Camera className="w-5 h-5" />}
              label="Extracción con Claude"
              value={monthStats.by_type.photo_extract.toLocaleString('es-CO')}
              tint="from-purple-500 to-pink-500"
            />
            <StatCard
              icon={<DollarSign className="w-5 h-5" />}
              label="Costo Claude estimado"
              value={`$${monthStats.claude_cost.toFixed(2)} USD`}
              tint="from-amber-500 to-amber-600"
            />
            <StatCard
              icon={<Activity className="w-5 h-5" />}
              label="Conversiones LibreOffice"
              value={monthStats.conversions.toLocaleString('es-CO')}
              tint="from-blue-500 to-cyan-500"
            />
          </div>
        </section>

        {/* Usuarios */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Usuarios ({users.length})
            </h2>
          </div>
          {loading && <p className="text-slate-500 text-sm">Cargando…</p>}
          {!loading && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/80 border-b border-slate-800">
                    <tr className="text-left text-slate-400">
                      <th className="px-4 py-3 font-medium">Email</th>
                      <th className="px-4 py-3 font-medium">Plan</th>
                      <th className="px-4 py-3 font-medium">Alta</th>
                      <th className="px-4 py-3 font-medium">Última actividad</th>
                      <th className="px-4 py-3 font-medium text-center" title="Fotos">Fotos</th>
                      <th className="px-4 py-3 font-medium text-center" title="PDF → Word">P→W</th>
                      <th className="px-4 py-3 font-medium text-center" title="PDF → Excel">P→E</th>
                      <th className="px-4 py-3 font-medium text-center" title="Word → PDF">W→P</th>
                      <th className="px-4 py-3 font-medium text-center" title="Excel → PDF">E→P</th>
                      <th className="px-4 py-3 font-medium text-center" title="Word + Excel Fill">W+E</th>
                      <th className="px-4 py-3 font-medium text-center" title="Extracción Universal">Univ</th>
                      <th className="px-4 py-3 font-medium text-center">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {users.map(u => (
                      <tr key={u.id} className="hover:bg-slate-800/40 transition">
                        <td className="px-4 py-3 text-white whitespace-nowrap">
                          {u.email}
                          {u.is_admin && (
                            <span className="ml-2 text-xs text-amber-400">· admin</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs px-2 py-1 rounded ${
                              u.plan === 'PRIME'
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-slate-700/60 text-slate-300'
                            }`}
                          >
                            {u.plan}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{fmtDate(u.created_at)}</td>
                        <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{fmtDate(u.last_activity)}</td>
                        {OPERATION_TYPES.map(t => (
                          <td key={t} className="px-4 py-3 text-center text-slate-300">
                            {u.by_type[t] || '—'}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-center font-semibold text-white">
                          {u.total}
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={12} className="px-4 py-6 text-center text-slate-500">
                          Sin usuarios todavía.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* Últimas operaciones */}
        <section>
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
            Últimas operaciones ({recent.length})
          </h2>
          {!loading && recent.length === 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center text-slate-400 text-sm">
              Todavía no se han registrado operaciones.
            </div>
          )}
          {!loading && recent.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/80 border-b border-slate-800">
                    <tr className="text-left text-slate-400">
                      <th className="px-4 py-3 font-medium">Usuario</th>
                      <th className="px-4 py-3 font-medium">Operación</th>
                      <th className="px-4 py-3 font-medium">Archivo</th>
                      <th className="px-4 py-3 font-medium">Estado</th>
                      <th className="px-4 py-3 font-medium">Fecha</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {recent.map(op => {
                      const t = op.operation_type as OperationType
                      const opColor = OP_BADGE[t] || 'bg-slate-700/40 text-slate-300'
                      const stColor =
                        STATUS_BADGE[op.status] || 'bg-slate-700/40 text-slate-300'
                      return (
                        <tr key={op.id} className="hover:bg-slate-800/40 transition">
                          <td className="px-4 py-3 text-slate-300 whitespace-nowrap">
                            {op.user_email}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded ${opColor}`}>
                              {OP_LABELS[t] || op.operation_type}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-400 truncate max-w-xs">
                            {op.input_filename || '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-1 rounded ${stColor}`}>
                              {op.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                            {fmtDate(op.created_at)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  tint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tint: string
}) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
      <div
        className={`w-9 h-9 rounded-lg bg-gradient-to-br ${tint} flex items-center justify-center text-white mb-3`}
      >
        {icon}
      </div>
      <p className="text-sm text-slate-400">{label}</p>
      <p className="text-2xl font-bold text-white mt-1">{value}</p>
    </div>
  )
}
