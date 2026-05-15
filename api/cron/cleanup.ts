/**
 * Cron diario que borra archivos del bucket `files` y rows de `operations`
 * con `created_at` más viejo que RETENTION_DAYS.
 *
 * Vercel cron envía:  Authorization: Bearer $CRON_SECRET
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_lib/supabase'

const RETENTION_DAYS = 7

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const expected = process.env.CRON_SECRET
  const auth = req.headers.authorization
  if (!expected || auth !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: oldOps, error: listErr } = await supabaseAdmin
    .from('operations')
    .select('id, input_file, output_file')
    .lt('created_at', cutoff)

  if (listErr) {
    return res.status(500).json({ error: `list failed: ${listErr.message}` })
  }

  const paths: string[] = []
  for (const op of oldOps || []) {
    if (op.input_file) paths.push(op.input_file)
    if (op.output_file) paths.push(op.output_file)
  }

  let filesDeleted = 0
  if (paths.length > 0) {
    const { data: rmData, error: rmErr } = await supabaseAdmin.storage
      .from('files')
      .remove(paths)
    if (rmErr) {
      return res.status(500).json({ error: `storage remove: ${rmErr.message}` })
    }
    filesDeleted = rmData?.length || 0
  }

  const { error: deleteErr, count } = await supabaseAdmin
    .from('operations')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff)

  if (deleteErr) {
    return res.status(500).json({ error: `db delete: ${deleteErr.message}` })
  }

  return res.status(200).json({
    ok: true,
    operations_deleted: count || 0,
    files_deleted: filesDeleted,
    cutoff,
  })
}
