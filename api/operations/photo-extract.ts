/**
 * POST /api/operations/photo-extract
 * Body: { input_path: string, input_filename: string }
 *
 * Lee imágenes del archivo subido, usa Claude Vision para extraer datos,
 * genera un Excel y lo guarda en Storage.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import ExcelJS from 'exceljs'
import {
  authenticateUser,
  checkQuota,
  createOperation,
  completeOperation,
  failOperation,
  downloadFromStorage,
  uploadToStorage,
  getSignedDownloadUrl,
} from '../_lib/supabase'
import { extractEquipmentFromImages } from '../_lib/claude'
import {
  extractImagesFromDocx,
  extractImagesFromPdf,
  imageBufferToBase64,
} from '../_lib/images'

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

    // Crear operación en BD
    opId = await createOperation(userId, 'photo_extract', input_path, input_filename)

    // Descargar archivo
    const buffer = await downloadFromStorage(input_path)
    const ext = input_filename.split('.').pop()?.toLowerCase() || ''

    // Extraer imágenes según tipo de archivo
    let images: { mediaType: string; base64: string }[] = []
    if (ext === 'pdf') {
      images = await extractImagesFromPdf(buffer)
    } else if (ext === 'docx' || ext === 'doc') {
      images = await extractImagesFromDocx(buffer)
    } else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      const mt = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
      images = [await imageBufferToBase64(buffer, mt)]
    } else {
      throw new Error(`Tipo de archivo no soportado: ${ext}`)
    }

    if (images.length === 0) {
      throw new Error('No se encontraron imágenes en el archivo')
    }

    // Extraer datos con Claude
    const equipos = await extractEquipmentFromImages(images)

    if (equipos.length === 0) {
      throw new Error('No se detectaron equipos en las fotos')
    }

    // Generar Excel
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Main')
    ws.columns = [
      { header: 'UNIT ID #', key: 'unit_id', width: 18 },
      { header: 'Equipment Type', key: 'equipment_type', width: 22 },
      { header: 'Make', key: 'make', width: 14 },
      { header: 'Model #', key: 'model', width: 26 },
      { header: 'Serial #', key: 'serial', width: 18 },
      { header: 'Voltage', key: 'voltage', width: 10 },
      { header: 'Phase', key: 'phase', width: 8 },
      { header: 'Mnf. Year', key: 'year', width: 12 },
      { header: 'Size', key: 'size', width: 16 },
      { header: 'Location', key: 'location', width: 16 },
      { header: 'Condition', key: 'condition', width: 12 },
    ]
    ws.getRow(1).font = { bold: true }
    for (const eq of equipos) {
      ws.addRow(eq)
    }

    const xlsxBuffer = Buffer.from(await wb.xlsx.writeBuffer())

    // Subir Excel
    const outputFilename = `${input_filename.replace(/\.[^/.]+$/, '')}_equipos.xlsx`
    const outputPath = `${userId}/outputs/${Date.now()}_${outputFilename}`
    await uploadToStorage(
      outputPath,
      xlsxBuffer,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )

    // Completar operación
    await completeOperation(opId, outputPath, outputFilename, {
      equipos_count: equipos.length,
      images_count: images.length,
    })

    const downloadUrl = await getSignedDownloadUrl(outputPath)
    return res.status(200).json({
      success: true,
      output_filename: outputFilename,
      download_url: downloadUrl,
      equipos_count: equipos.length,
    })
  } catch (e: any) {
    console.error('photo-extract error:', e)
    if (opId) await failOperation(opId, e.message || 'Error desconocido').catch(() => {})
    return res.status(500).json({ error: e.message || 'Error desconocido' })
  }
}
