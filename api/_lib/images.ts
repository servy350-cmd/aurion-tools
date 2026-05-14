/**
 * Convierte un PDF (buffer) a una lista de imágenes (base64 JPEG)
 * para alimentar a Claude Vision.
 *
 * En Vercel serverless usamos `pdf2pic`-style approach pero con `@napi-rs/canvas`
 * o `pdfjs-dist` no funciona bien en runtime serverless. La opción más simple es
 * delegar al LibreOffice service (que ya tiene poppler) un endpoint que renderice
 * PDF a PNG.
 *
 * Para mantener simple el MVP, asumimos que el archivo SUBIDO al pipeline ya tiene
 * imágenes embebidas (PDF de fotos, DOCX con imágenes) y las extraemos.
 */
import * as zip from '@zip.js/zip.js'

/**
 * Extrae las imágenes embebidas dentro de un DOCX (que es un ZIP).
 */
export async function extractImagesFromDocx(buffer: Buffer): Promise<{ mediaType: string; base64: string }[]> {
  const reader = new zip.ZipReader(new zip.BlobReader(new Blob([buffer])))
  const entries = await reader.getEntries()
  const images: { mediaType: string; base64: string }[] = []

  for (const entry of entries) {
    if (entry.directory) continue
    const name = entry.filename.toLowerCase()
    if (!name.startsWith('word/media/')) continue
    let mediaType = 'image/jpeg'
    if (name.endsWith('.png')) mediaType = 'image/png'
    else if (name.endsWith('.gif')) mediaType = 'image/gif'
    else if (name.endsWith('.webp')) mediaType = 'image/webp'

    const blob = await entry.getData!(new zip.BlobWriter())
    const arrayBuffer = await (blob as Blob).arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    images.push({ mediaType, base64 })
  }
  await reader.close()
  return images
}

/**
 * Para PDF, delegamos al LibreOffice service que devuelve las páginas como imágenes.
 */
export async function extractImagesFromPdf(buffer: Buffer): Promise<{ mediaType: string; base64: string }[]> {
  const url = process.env.LIBREOFFICE_SERVICE_URL || 'http://localhost:3001'
  const formData = new FormData()
  const blob = new Blob([buffer])
  formData.append('file', blob, 'input.pdf')

  const res = await fetch(`${url}/pdf-to-images`, { method: 'POST', body: formData })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`pdf-to-images error: ${errText}`)
  }
  const result = await res.json() as { images: { mediaType: string; base64: string }[] }
  return result.images
}

/**
 * Si el archivo es una sola imagen, la metemos directo.
 */
export async function imageBufferToBase64(buffer: Buffer, mimeType: string): Promise<{ mediaType: string; base64: string }> {
  return {
    mediaType: mimeType.startsWith('image/') ? mimeType : 'image/jpeg',
    base64: buffer.toString('base64'),
  }
}
