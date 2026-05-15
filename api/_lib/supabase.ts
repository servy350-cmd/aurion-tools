import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

let _admin: SupabaseClient | null = null

export function isServiceRoleAvailable(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY no configurada (ver SETUP.md).')
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _admin
}

export function requireServiceRole(res: VercelResponse): boolean {
  if (isServiceRoleAvailable()) return true
  res.status(503).json({
    error:
      'SUPABASE_SERVICE_ROLE_KEY no configurada — endpoint deshabilitado. Ver SETUP.md.',
  })
  return false
}

export async function authenticateUser(req: VercelRequest): Promise<{
  userId: string
  email: string
}> {
  const auth = req.headers.authorization
  const token = auth?.replace(/^Bearer\s+/i, '')
  if (!token) throw new Error('No token provided')

  const { data, error } = await getSupabaseAdmin().auth.getUser(token)
  if (error || !data.user) throw new Error('Invalid token')

  return { userId: data.user.id, email: data.user.email || '' }
}

export async function checkQuota(userId: string): Promise<{
  allowed: boolean
  plan: string
  used: number
  limit: number | null
}> {
  const admin = getSupabaseAdmin()
  const { data: profile } = await admin
    .from('profiles')
    .select('plan')
    .eq('id', userId)
    .single()

  const plan = profile?.plan || 'FLEX'
  const limit = plan === 'PRIME' ? null : 4

  const { data: count } = await admin.rpc('count_recent_operations', { p_user_id: userId })
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
  const { data, error } = await getSupabaseAdmin()
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
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await getSupabaseAdmin()
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
  await getSupabaseAdmin()
    .from('operations')
    .update({
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq('id', opId)
}

export async function getSignedDownloadUrl(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await getSupabaseAdmin().storage
    .from('files')
    .createSignedUrl(path, expiresIn)
  if (error || !data) throw new Error(`No se pudo crear URL firmada: ${error?.message}`)
  return data.signedUrl
}

export async function downloadFromStorage(path: string): Promise<Buffer> {
  const { data, error } = await getSupabaseAdmin().storage.from('files').download(path)
  if (error || !data) throw new Error(`No se pudo descargar: ${error?.message}`)
  const arrayBuffer = await data.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export async function uploadToStorage(
  path: string,
  content: Buffer,
  contentType: string
): Promise<void> {
  const { error } = await getSupabaseAdmin().storage.from('files').upload(path, content, {
    contentType,
    upsert: false,
  })
  if (error) throw new Error(`No se pudo subir: ${error.message}`)
}
