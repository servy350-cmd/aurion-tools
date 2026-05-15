/**
 * Helper para Claude API (Vision): extrae datos de fotos.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { ImageBlockParam, TextBlockParam } from '@anthropic-ai/sdk/resources/messages'

type MessageContentBlock = ImageBlockParam | TextBlockParam

const apiKey = process.env.ANTHROPIC_API_KEY!
const model = process.env.CLAUDE_MODEL || 'claude-opus-4-7'

const NO_INFO = 'Informacion no disponible en foto'

const PROMPT = `Eres un experto en lectura de placas de equipos y documentos técnicos.

Analiza TODAS las imágenes del documento adjunto y extrae los datos de cada equipo
o ítem que veas.

REGLAS ESTRICTAS:

1. Identifica cada equipo único por su UNIT ID (ej: AC-9, CH-1, RTU-3).
   Si la misma unidad aparece en varias fotos, agrúpalas y produce UNA SOLA fila por UNIT ID.

2. Para cada equipo extrae:
   - unit_id
   - equipment_type
   - make (marca)
   - model
   - serial
   - voltage
   - phase
   - year
   - size
   - location

3. CUANDO UN DATO NO SE PUEDE LEER de la foto (borroso, ilegible, fuera de cuadro, o
   la placa no muestra ese campo) → pon EXACTAMENTE:
   "${NO_INFO}"

4. NO inventes datos.

5. Condición: year >= 2015 → "GOOD"; resto → "FAIR"; default si no se sabe → "FAIR".

6. Devuelve SOLO JSON válido con esta estructura, sin markdown:
{
  "equipos": [
    {
      "unit_id": "...",
      "equipment_type": "...",
      "make": "...",
      "model": "...",
      "serial": "...",
      "voltage": "...",
      "phase": "...",
      "year": "...",
      "size": "...",
      "location": "...",
      "condition": "FAIR"
    }
  ]
}
`

export type Equipment = {
  unit_id: string
  equipment_type: string
  make: string
  model: string
  serial: string
  voltage: string
  phase: string
  year: string
  size: string
  location: string
  condition: string
}

export async function extractEquipmentFromImages(
  images: { mediaType: string; base64: string }[]
): Promise<Equipment[]> {
  const client = new Anthropic({ apiKey })
  const allEquipment: Record<string, Equipment> = {}

  const BATCH = 15
  for (let i = 0; i < images.length; i += BATCH) {
    const batch = images.slice(i, i + BATCH)
    const content: MessageContentBlock[] = batch.map<ImageBlockParam>(img => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType as ImageBlockParam['source']['media_type'],
        data: img.base64,
      },
    }))
    content.push({ type: 'text', text: PROMPT })

    const resp = await client.messages.create({
      model,
      max_tokens: 4000,
      messages: [{ role: 'user', content }],
    })

    let text = ''
    for (const block of resp.content) {
      if (block.type === 'text') text += block.text
    }
    text = text.trim()
    if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim()
    }

    try {
      const data = JSON.parse(text)
      for (const eq of data.equipos || []) {
        const uid = eq.unit_id || ''
        if (!uid) continue
        if (allEquipment[uid]) {
          // merge: si lo nuevo tiene info útil donde antes había NO_INFO, sobreescribe
          for (const k of Object.keys(eq)) {
            const key = k as keyof Equipment
            if (allEquipment[uid][key] === NO_INFO && eq[key] !== NO_INFO) {
              allEquipment[uid][key] = eq[key]
            }
          }
        } else {
          allEquipment[uid] = eq as Equipment
        }
      }
    } catch (e) {
      console.error('Error parseando respuesta de Claude:', e, 'texto:', text.slice(0, 200))
    }
  }

  return Object.values(allEquipment)
}
