/**
 * Helper de visión usando OpenAI (gpt-4o-mini): extrae datos de fotos de equipos.
 * Reemplaza la implementación previa con Claude Vision.
 */
import { getOpenAI } from './openai'

const MODEL = 'gpt-4o-mini'
const NO_INFO = 'Informacion no disponible en foto'

const PROMPT = `Eres un experto en lectura de placas de equipos y documentos técnicos.

Analiza TODAS las imágenes adjuntas y extrae los datos de cada equipo o ítem que veas.

REGLAS ESTRICTAS:

1. Identifica cada equipo único por su UNIT ID (ej: AC-9, CH-1, RTU-3).
   Si la misma unidad aparece en varias fotos, agrúpalas y produce UNA SOLA entrada por UNIT ID.

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

6. Responde SOLO un objeto JSON válido. Sin markdown ni texto adicional. Estructura:
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
}`

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
  const client = getOpenAI()
  const allEquipment: Record<string, Equipment> = {}

  const BATCH = 10
  for (let i = 0; i < images.length; i += BATCH) {
    const batch = images.slice(i, i + BATCH)
    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    > = batch.map(img => ({
      type: 'image_url' as const,
      image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
    }))
    content.push({ type: 'text', text: PROMPT })

    const completion = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: 'json_object' },
      max_tokens: 2000,
      messages: [{ role: 'user', content }],
    })

    const text = completion.choices[0]?.message?.content || '{}'

    try {
      const data = JSON.parse(text)
      for (const eq of data.equipos || []) {
        const uid = eq.unit_id || ''
        if (!uid) continue
        if (allEquipment[uid]) {
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
      console.error('Error parseando respuesta de OpenAI:', e, 'texto:', text.slice(0, 200))
    }
  }

  return Object.values(allEquipment)
}
