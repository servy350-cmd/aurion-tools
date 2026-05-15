import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Bypass del Web Lock multi-tab. supabase-js usa navigator.locks para
    // serializar el auth token entre pestañas; cuando un proceso anterior no
    // libera el lock (crash, hot-reload, ventana zombie), getSession() queda
    // pending para siempre. Como Tools corre en una sola pestaña por usuario,
    // pasamos un lock no-op que llama a fn() directamente.
    lock: async (_name, _acquireTimeout, fn) => await fn(),
  },
})

export type Profile = {
  id: string
  email: string
  full_name: string | null
  company_name: string | null
  plan: 'FLEX' | 'PRIME'
  is_admin: boolean
  created_at: string
}

export type Operation = {
  id: string
  user_id: string
  operation_type: 'photo_extract' | 'pdf_to_word' | 'pdf_to_excel' | 'word_to_pdf' | 'excel_to_pdf'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  input_filename: string | null
  output_file: string | null
  output_filename: string | null
  metadata: Record<string, unknown> | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}
