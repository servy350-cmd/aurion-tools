import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { isServiceRoleAvailable } from './_lib/supabase'

type ServiceCheck = { ok: boolean; detail?: string }

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const services: Record<'supabase' | 'libreoffice' | 'openai', ServiceCheck> = {
    supabase: { ok: false },
    libreoffice: { ok: false },
    openai: { ok: false },
  }

  // Supabase — anon key, solo verifica conectividad (RLS filtrará la query)
  try {
    const url = process.env.SUPABASE_URL
    const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
    if (!url || !anon) {
      services.supabase = { ok: false, detail: 'missing SUPABASE_URL or anon key' }
    } else {
      const c = createClient(url, anon, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { error } = await c.from('profiles').select('id', { count: 'exact', head: true })
      services.supabase = error ? { ok: false, detail: error.message } : { ok: true }
    }
  } catch (e) {
    services.supabase = { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }

  // LibreOffice
  try {
    const url = process.env.LIBREOFFICE_SERVICE_URL || 'http://localhost:3001'
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) })
    services.libreoffice = r.ok ? { ok: true } : { ok: false, detail: `HTTP ${r.status}` }
  } catch (e) {
    services.libreoffice = { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }

  // OpenAI — ping a /v1/models con timeout 3s. 401 = auth fail; cualquier
  // otro error = API alcanzable + key válida (lo tratamos como ok).
  try {
    if (!process.env.OPENAI_API_KEY) {
      services.openai = { ok: false, detail: 'missing OPENAI_API_KEY' }
    } else {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 3000 })
      try {
        await client.models.list()
        services.openai = { ok: true }
      } catch (apiErr) {
        if (apiErr instanceof OpenAI.APIError) {
          if (apiErr.status === 401) {
            services.openai = { ok: false, detail: 'auth: HTTP 401' }
          } else {
            services.openai = { ok: true, detail: `api reachable (HTTP ${apiErr.status})` }
          }
        } else {
          throw apiErr
        }
      }
    }
  } catch (e) {
    services.openai = { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }

  const ok = services.supabase.ok && services.libreoffice.ok && services.openai.ok
  return res.status(ok ? 200 : 503).json({
    ok,
    services,
    service_role_configured: isServiceRoleAvailable(),
  })
}
