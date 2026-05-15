// Genera test-assets/word-con-foto.docx (2 imágenes embebidas con texto
// simulando placas HVAC) y test-assets/tabla-vacia.xlsx con headers.
// Uso: node scripts/gen-test-assets.mjs
import { Jimp, loadFont } from 'jimp'
import { SANS_32_WHITE, SANS_16_WHITE } from 'jimp/fonts'
import { Document, Packer, Paragraph, ImageRun } from 'docx'
import ExcelJS from 'exceljs'
import * as fs from 'fs/promises'
import * as path from 'path'

const OUT_DIR = path.resolve('test-assets')
await fs.mkdir(OUT_DIR, { recursive: true })

async function makePlate(line1, line2, out) {
  const img = new Jimp({ width: 800, height: 600, color: 0x888888ff })
  const big = await loadFont(SANS_32_WHITE)
  const small = await loadFont(SANS_16_WHITE)
  img.print({ font: big, x: 40, y: 60, text: line1 })
  img.print({ font: small, x: 40, y: 140, text: line2 })
  img.print({
    font: small,
    x: 40,
    y: 200,
    text: 'CARRIER / YORK PLACA SIMULADA — TEST FIXTURE',
  })
  await img.write(out)
}

const plate1 = path.join(OUT_DIR, 'placa1.png')
const plate2 = path.join(OUT_DIR, 'placa2.png')

await makePlate(
  'PLACA HVAC #001',
  'MARCA: CARRIER - SERIE: ABC123',
  plate1,
)
await makePlate(
  'PLACA HVAC #002',
  'MARCA: YORK - SERIE: XYZ789',
  plate2,
)

const img1 = await fs.readFile(plate1)
const img2 = await fs.readFile(plate2)

const doc = new Document({
  sections: [
    {
      children: [
        new Paragraph({
          children: [
            new ImageRun({
              data: img1,
              type: 'png',
              transformation: { width: 600, height: 450 },
            }),
          ],
        }),
        new Paragraph({
          children: [
            new ImageRun({
              data: img2,
              type: 'png',
              transformation: { width: 600, height: 450 },
            }),
          ],
        }),
      ],
    },
  ],
})

const docxBuf = await Packer.toBuffer(doc)
const docxPath = path.join(OUT_DIR, 'word-con-foto.docx')
await fs.writeFile(docxPath, docxBuf)

// Excel con headers solamente
const wb = new ExcelJS.Workbook()
const ws = wb.addWorksheet('Sheet1')
ws.columns = [
  { header: 'numero_placa', key: 'numero_placa', width: 22 },
  { header: 'marca', key: 'marca', width: 18 },
  { header: 'serie', key: 'serie', width: 22 },
]
ws.getRow(1).font = { bold: true }
const xlsxPath = path.join(OUT_DIR, 'tabla-vacia.xlsx')
await wb.xlsx.writeFile(xlsxPath)

// Limpieza de PNG intermedios
await fs.unlink(plate1)
await fs.unlink(plate2)

// Verificación: tamaños + lectura inversa
const docxStat = await fs.stat(docxPath)
const xlsxStat = await fs.stat(xlsxPath)

// Re-leer el xlsx
const wb2 = new ExcelJS.Workbook()
await wb2.xlsx.readFile(xlsxPath)
const headers = []
wb2.worksheets[0].getRow(1).eachCell({ includeEmpty: false }, c => {
  headers.push(String(c.value))
})

// Re-leer el docx contando media files
const zipLib = await import('@zip.js/zip.js')
const buf = await fs.readFile(docxPath)
const reader = new zipLib.ZipReader(new zipLib.BlobReader(new Blob([new Uint8Array(buf)])))
const entries = await reader.getEntries()
const media = entries.filter(
  e => !e.directory && e.filename.toLowerCase().startsWith('word/media/'),
)
await reader.close()

console.log(JSON.stringify({
  docx: { path: docxPath, bytes: docxStat.size, embedded_images: media.length, files: media.map(e => e.filename) },
  xlsx: { path: xlsxPath, bytes: xlsxStat.size, headers },
}, null, 2))
