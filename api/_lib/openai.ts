import OpenAI from 'openai'

let _client: OpenAI | null = null

export function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY no configurada')
  }
  if (!_client) {
    _client = new OpenAI({ apiKey })
  }
  return _client
}

export function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY
}

/**
 * Si el error es un OpenAI APIError, devuelve { status, message } mapeado a 502
 * con un detalle útil. Si no es un error de OpenAI, devuelve null para que el
 * endpoint use su manejo genérico (500).
 */
export function mapOpenAIError(err: unknown): { status: number; message: string } | null {
  if (!(err instanceof OpenAI.APIError)) return null
  if (err.status === 401) return { status: 502, message: 'OpenAI: API key inválida' }
  if (err.status === 429)
    return { status: 502, message: 'OpenAI: límite de tasa o saldo insuficiente' }
  if (err.status && err.status >= 500)
    return { status: 502, message: 'OpenAI: error del proveedor' }
  return { status: 502, message: `OpenAI: ${err.message}` }
}
