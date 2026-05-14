/**
 * LibreOffice Service
 *
 * Microservicio Node.js que recibe archivos y los convierte usando LibreOffice
 * en modo headless. También convierte PDF a imágenes con poppler.
 *
 * Endpoints:
 *   POST /convert         — body: file + target (pdf/docx/xlsx)
 *   POST /pdf-to-images   — body: file (PDF) → returns { images: [{mediaType, base64}] }
 *
 * Para desarrollo local: ya tienes LibreOffice + poppler instalados (del pipeline anterior).
 * Para producción: deploya con Dockerfile a Railway/Render.
 */
import express from 'express'
import multer from 'multer'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import { randomUUID } from 'crypto'

const execAsync = promisify(exec)
const app = express()
const PORT = process.env.PORT || 3001

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
})

function findLibreOffice(): string {
  if (process.platform === 'win32') {
    return 'C:\\Program Files\\LibreOffice\\program\\soffice.exe'
  }
  if (process.platform === 'darwin') {
    return '/Applications/LibreOffice.app/Contents/MacOS/soffice'
  }
  return 'soffice' // Linux assumes it's in PATH
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'aurion-libreoffice' })
})

/**
 * POST /convert
 * Form-data:  file=archivo, target=pdf|docx|xlsx
 */
app.post('/convert', upload.single('file'), async (req, res) => {
  const target = req.body.target as string
  if (!req.file || !['pdf', 'docx', 'xlsx'].includes(target)) {
    return res.status(400).json({ error: 'Falta file o target inválido' })
  }

  const id = randomUUID()
  const tmpDir = path.join(os.tmpdir(), `loconv-${id}`)
  await fs.mkdir(tmpDir, { recursive: true })

  try {
    const inputPath = path.join(tmpDir, req.file.originalname)
    await fs.writeFile(inputPath, req.file.buffer)

    const soffice = findLibreOffice()
    const cmd = `"${soffice}" --headless --convert-to ${target} --outdir "${tmpDir}" "${inputPath}"`
    console.log('Running:', cmd)

    const { stdout, stderr } = await execAsync(cmd, { timeout: 120_000 })
    if (stderr && !stdout.includes('convert')) {
      console.warn('LibreOffice stderr:', stderr)
    }

    const baseName = req.file.originalname.replace(/\.[^/.]+$/, '')
    const outputName = `${baseName}.${target}`
    const outputPath = path.join(tmpDir, outputName)

    const outputBuffer = await fs.readFile(outputPath)
    const mime =
      target === 'pdf' ? 'application/pdf' :
      target === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

    res.setHeader('Content-Type', mime)
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`)
    res.send(outputBuffer)
  } catch (e: any) {
    console.error('Convert error:', e)
    res.status(500).json({ error: e.message || 'conversion failed' })
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
})

/**
 * POST /pdf-to-images
 * Form-data: file=PDF
 * Devuelve: { images: [{ mediaType: 'image/jpeg', base64: '...' }, ...] }
 */
app.post('/pdf-to-images', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Falta file' })
  }

  const id = randomUUID()
  const tmpDir = path.join(os.tmpdir(), `pdfimg-${id}`)
  await fs.mkdir(tmpDir, { recursive: true })

  try {
    const inputPath = path.join(tmpDir, 'input.pdf')
    await fs.writeFile(inputPath, req.file.buffer)

    // Usamos pdftoppm (de poppler-utils) para convertir páginas a JPEG
    const cmd = `pdftoppm -jpeg -r 150 "${inputPath}" "${path.join(tmpDir, 'page')}"`
    await execAsync(cmd, { timeout: 120_000 })

    const files = await fs.readdir(tmpDir)
    const pageFiles = files
      .filter(f => f.startsWith('page') && f.endsWith('.jpg'))
      .sort()

    const images = await Promise.all(
      pageFiles.slice(0, 50).map(async f => {
        const buf = await fs.readFile(path.join(tmpDir, f))
        return { mediaType: 'image/jpeg', base64: buf.toString('base64') }
      })
    )

    res.json({ images, count: images.length })
  } catch (e: any) {
    console.error('PDF→images error:', e)
    res.status(500).json({ error: e.message || 'pdf to images failed' })
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
})

app.listen(PORT, () => {
  console.log(`AURION LibreOffice service listening on :${PORT}`)
})
