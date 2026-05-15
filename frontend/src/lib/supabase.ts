import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
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
