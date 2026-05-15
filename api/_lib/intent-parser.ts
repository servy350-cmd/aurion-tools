/**
 * Convierte una instrucción en lenguaje natural a un schema de columnas.
 * Usa gpt-4o-mini (barato + rápido para parseo de intent).
 */
import { getOpenAI } from './openai.js'

export type IntentResult = {
  detected_schema: string[]
  confidence: 'high' | 'low'
  clarification_needed?: string
  raw?: string
}

const PROMPT = `Eres un asistente que convierte una instrucción del usuario en un esquema de columnas para una tabla.

Reglas:
- Devuelve solo JSON, sin markdown.
- Forma exacta: { "detected_schema": [string], "confidence": "high"|"low", "clarification_needed": string opcional }
- Los nombres de columna van en snake_case en español (ej. "nombre", "telefono", "correo", "numero_factura").
- Si la instrucción es ambigua ("datos importantes", "lo más relevante"), pon confidence: "low" y agrega "clarification_needed" con UNA pregunta corta al usuario.
- Si la instrucción es clara, confidence: "high" y omite "clarification_needed".
- Nunca inventes columnas no implícitas en la instrucción.
- Mínimo 1 columna, máximo 20.`

export async function parseIntent(instruction: string): Promise<IntentResult> {
  const client = getOpenAI()
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    max_tokens: 500,
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: instruction.trim() },
    ],
  })
  const text = completion.choices[0]?.message?.content || '{}'
  try {
    const parsed = JSON.parse(text) as Partial<IntentResult>
    const schema = Array.isArray(parsed.detected_schema)
      ? parsed.detected_schema.map(c => String(c).trim()).filter(Boolean)
      : []
    return {
      detected_schema: schema,
      confidence: parsed.confidence === 'low' ? 'low' : 'high',
      clarification_needed: parsed.clarification_needed,
      raw: text,
    }
  } catch {
    return {
      detected_schema: [],
      confidence: 'low',
      clarification_needed: 'No pude entender qué quieres extraer. Dame un ejemplo de las columnas.',
      raw: text,
    }
  }
}
