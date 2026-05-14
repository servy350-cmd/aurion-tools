import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase, Profile } from './lib/supabase'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import OperationPage from './pages/OperationPage'
import HistoryPage from './pages/HistoryPage'

export default function App() {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()
        setProfile(data)
      }
      setLoading(false)
    }
    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()
        setProfile(data)
      } else {
        setProfile(null)
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

  return (
    <Routes>
      <Route path="/login" element={profile ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/" element={profile ? <DashboardPage profile={profile} /> : <Navigate to="/login" />} />
      <Route path="/op/:type" element={profile ? <OperationPage profile={profile} /> : <Navigate to="/login" />} />
      <Route path="/history" element={profile ? <HistoryPage profile={profile} /> : <Navigate to="/login" />} />
    </Routes>
  )
}
