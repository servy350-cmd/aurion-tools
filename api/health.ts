import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { isServiceRoleAvailable } from './_lib/supabase'

type ServiceCheck = { ok: boolean; detail?: string }

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const services: Record<'supabase' | 'libreoffice' | 'anthropic', ServiceCheck> = {
    supabase: { ok: false },
    libreoffice: { ok: false },
    anthropic: { ok: false },
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

  // Anthropic — ping trivial a /v1/messages. ok = API alcanzable + key autenticó.
  // Errores 4xx no-auth (validación, balance bajo, rate limit) cuentan como ok:
  // significan que llegamos al API y la key es válida. Solo 401/403 marcan failure.
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      services.anthropic = { ok: false, detail: 'missing ANTHROPIC_API_KEY' }
    } else {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const model = process.env.CLAUDE_MODEL || 'claude-opus-4-7'
      try {
        await client.messages.create(
          {
            model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          },
          { timeout: 8000 }
        )
        services.anthropic = { ok: true }
      } catch (apiErr) {
        if (apiErr instanceof Anthropic.APIError) {
          if (apiErr.status === 401 || apiErr.status === 403) {
            services.anthropic = { ok: false, detail: `auth: HTTP ${apiErr.status}` }
          } else {
            services.anthropic = { ok: true, detail: `api reachable (HTTP ${apiErr.status})` }
          }
        } else {
          throw apiErr
        }
      }
    }
  } catch (e) {
    services.anthropic = { ok: false, detail: e instanceof Error ? e.message : String(e) }
  }

  const ok = services.supabase.ok && services.libreoffice.ok && services.anthropic.ok
  return res.status(ok ? 200 : 503).json({
    ok,
    services,
    service_role_configured: isServiceRoleAvailable(),
  })
}
