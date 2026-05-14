import { createClient } from '@supabase/supabase-js'
import type { VercelRequest } from '@vercel/node'

const supabaseUrl = process.env.SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Cliente con permisos de admin (para operaciones del backend)
export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

export async function authenticateUser(req: VercelRequest): Promise<{
  userId: string
  email: string
}> {
  const auth = req.headers.authorization
  const token = auth?.replace(/^Bearer\s+/i, '')
  if (!token) throw new Error('No token provided')

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data.user) throw new Error('Invalid token')

  return { userId: data.user.id, email: data.user.email || '' }
}

export async function checkQuota(userId: string): Promise<{
  allowed: boolean
  plan: string
  used: number
  limit: number | null
}> {
  // Leer el plan del usuario
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .single()

  const plan = profile?.plan || 'FLEX'
  const limit = plan === 'PRIME' ? null : 4

  // Contar operaciones de los últimos 30 días
  const { data: count } = await supabaseAdmin.rpc('count_recent_operations', { p_user_id: userId })
  const used = count || 0

  if (limit === null) {
    return { allowed: true, plan, used, limit: null }
  }
  return { allowed: used < limit, plan, used, limit }
}

export async function createOperation(
  userId: string,
  type: string,
  inputPath: string,
  inputFilename: string
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('operations')
    .insert({
      user_id: userId,
      operation_type: type,
      status: 'processing',
      input_file: inputPath,
      input_filename: inputFilename,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(`No se pudo crear la operación: ${error?.message}`)
  return data.id
}

export async function completeOperation(
  opId: string,
  outputPath: string,
  outputFilename: string,
  metadata: any = {}
): Promise<void> {
  await supabaseAdmin
    .from('operations')
    .update({
      status: 'completed',
      output_file: outputPath,
      output_filename: outputFilename,
      metadata,
      completed_at: new Date().toISOString(),
    })
    .eq('id', opId)
}

export async function failOperation(opId: string, errorMessage: string): Promise<void> {
  await supabaseAdmin
    .from('operations')
    .update({
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq('id', opId)
}

export async function getSignedDownloadUrl(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabaseAdmin.storage
    .from('files')
    .createSignedUrl(path, expiresIn)
  if (error || !data) throw new Error(`No se pudo crear URL firmada: ${error?.message}`)
  return data.signedUrl
}

export async function downloadFromStorage(path: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage.from('files').download(path)
  if (error || !data) throw new Error(`No se pudo descargar: ${error?.message}`)
  const arrayBuffer = await data.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export async function uploadToStorage(
  path: string,
  content: Buffer,
  contentType: string
): Promise<void> {
  const { error } = await supabaseAdmin.storage.from('files').upload(path, content, {
    contentType,
    upsert: false,
  })
  if (error) throw new Error(`No se pudo subir: ${error.message}`)
}
