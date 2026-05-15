import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from './_lib/supabase'

type ServiceStatus = 'ok' | string

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const services: Record<'supabase' | 'libreoffice' | 'anthropic', ServiceStatus> = {
    supabase: 'unknown',
    libreoffice: 'unknown',
    anthropic: 'unknown',
  }
  let ok = true

  // Supabase: head-count en profiles (no trae filas)
  try {
    const { error } = await supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
    if (error) {
      services.supabase = `error: ${error.message}`
      ok = false
    } else {
      services.supabase = 'ok'
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    services.supabase = `error: ${msg}`
    ok = false
  }

  // LibreOffice service /health
  try {
    const url = process.env.LIBREOFFICE_SERVICE_URL || 'http://localhost:3001'
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) })
    if (r.ok) {
      services.libreoffice = 'ok'
    } else {
      services.libreoffice = `error: HTTP ${r.status}`
      ok = false
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    services.libreoffice = `error: ${msg}`
    ok = false
  }

  // Anthropic: solo verifica que la key esté presente
  if (process.env.ANTHROPIC_API_KEY) {
    services.anthropic = 'ok'
  } else {
    services.anthropic = 'missing ANTHROPIC_API_KEY'
    ok = false
  }

  return res.status(ok ? 200 : 503).json({ ok, services })
}
