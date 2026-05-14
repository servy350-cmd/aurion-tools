/**
 * Cliente para el microservicio LibreOffice que convierte archivos.
 * En desarrollo apunta a localhost:3001. En producción a Railway.
 */

const LIBREOFFICE_URL = process.env.LIBREOFFICE_SERVICE_URL || 'http://localhost:3001'

export type ConvertTarget = 'pdf' | 'docx' | 'xlsx'

export async function convertFile(
  inputBuffer: Buffer,
  inputFilename: string,
  target: ConvertTarget
): Promise<{ buffer: Buffer; filename: string }> {
  const formData = new FormData()
  // Buffer → Blob para fetch
  const blob = new Blob([inputBuffer])
  formData.append('file', blob, inputFilename)
  formData.append('target', target)

  const res = await fetch(`${LIBREOFFICE_URL}/convert`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`LibreOffice service error (${res.status}): ${errText}`)
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  const ext = target
  const baseName = inputFilename.replace(/\.[^/.]+$/, '')
  return { buffer, filename: `${baseName}.${ext}` }
}
