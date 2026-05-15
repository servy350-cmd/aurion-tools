import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase, Profile } from './lib/supabase'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import OperationPage from './pages/OperationPage'
import HistoryPage from './pages/HistoryPage'

async function loadOrRecoverProfile(
  userId: string,
  email: string,
): Promise<{ profile: Profile | null; error: string | null }> {
  const { data, error: fetchErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (data) return { profile: data as Profile, error: null }

  // No profile — el trigger handle_new_user falló. Intentar crear manualmente.
  const { data: created, error: insertErr } = await supabase
    .from('profiles')
    .insert({ id: userId, email })
    .select('*')
    .maybeSingle()

  if (created) return { profile: created as Profile, error: null }

  const reason = insertErr?.message || fetchErr?.message || 'razón desconocida'
  return {
    profile: null,
    error: `No se pudo cargar ni crear tu perfil (${reason}). Contacta a soporte.`,
  }
}

export default function App() {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const { profile, error } = await loadOrRecoverProfile(
          session.user.id,
          session.user.email || '',
        )
        setProfile(profile)
        setProfileError(error)
      }
      setLoading(false)
    }
    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        const { profile, error } = await loadOrRecoverProfile(
          session.user.id,
          session.user.email || '',
        )
        setProfile(profile)
        setProfileError(error)
      } else {
        setProfile(null)
        setProfileError(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-slate-400">Cargando…</div>
      </div>
    )
  }

  if (profileError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
        <div className="max-w-md w-full bg-slate-900 border border-red-500/30 rounded-2xl p-8 text-center">
          <h1 className="text-xl font-semibold text-white mb-3">No se pudo cargar tu cuenta</h1>
          <p className="text-slate-300 text-sm mb-6">{profileError}</p>
          <button
            onClick={() => supabase.auth.signOut()}
            className="bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={profile ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/" element={profile ? <DashboardPage profile={profile} /> : <Navigate to="/login" />} />
      <Route path="/op/:type" element={profile ? <OperationPage profile={profile} /> : <Navigate to="/login" />} />
      <Route path="/history" element={profile ? <HistoryPage profile={profile} /> : <Navigate to="/login" />} />
    </Routes>
  )
}
