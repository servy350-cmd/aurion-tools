/**
 * Helper genérico para conversiones que delegan a LibreOffice service.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  authenticateUser,
  checkQuota,
  createOperation,
  completeOperation,
  failOperation,
  downloadFromStorage,
  uploadToStorage,
  getSignedDownloadUrl,
} from './supabase'
import { convertFile, ConvertTarget } from './libreoffice'

export async function handleConversion(
  req: VercelRequest,
  res: VercelResponse,
  operationType: string,
  target: ConvertTarget
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let opId: string | null = null
  try {
    const { userId } = await authenticateUser(req)
    const { input_path, input_filename } = req.body
    if (!input_path || !input_filename) {
      return res.status(400).json({ error: 'Faltan input_path o input_filename' })
    }

    // Verificar cuota
    const quota = await checkQuota(userId)
    if (!quota.allowed) {
      return res.status(403).json({
        error: `Has alcanzado tu límite de ${quota.limit} operaciones en 30 días. Plan: ${quota.plan}.`,
      })
    }

    opId = await createOperation(userId, operationType, input_path, input_filename)

    // Descargar archivo
    const buffer = await downloadFromStorage(input_path)

    // Convertir con LibreOffice
    const result = await convertFile(buffer, input_filename, target)

    // Subir resultado
    const outputPath = `${userId}/outputs/${Date.now()}_${result.filename}`
    const mimeMap: Record<ConvertTarget, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }
    await uploadToStorage(outputPath, result.buffer, mimeMap[target])

    await completeOperation(opId, outputPath, result.filename, {
      target,
    })

    const downloadUrl = await getSignedDownloadUrl(outputPath)
    return res.status(200).json({
      success: true,
      output_filename: result.filename,
      download_url: downloadUrl,
    })
  } catch (e) {
    console.error(`${operationType} error:`, e)
    const msg = e instanceof Error ? e.message : 'Error desconocido'
    if (opId) await failOperation(opId, msg).catch(() => {})
    return res.status(500).json({ error: msg })
  }
}
