/**
 * Cliente SSE para endpoints POST (EventSource no acepta body).
 * Uso:
 *   for await (const ev of streamSSE('/api/...', { method: 'POST', body: ..., headers: ... })) {
 *     console.log(ev)
 *   }
 */
export type SSEEvent = Record<string, unknown> & { type: string }

export async function* streamSSE(
  url: string,
  init: RequestInit & { signal?: AbortSignal },
): AsyncGenerator<SSEEvent, void, void> {
  const res = await fetch(url, init)
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`SSE request failed: HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''
      for (const block of parts) {
        const dataLines = block
          .split('\n')
          .filter(l => l.startsWith('data:'))
          .map(l => l.slice(5).trimStart())
        if (dataLines.length === 0) continue
        const raw = dataLines.join('\n')
        try {
          yield JSON.parse(raw) as SSEEvent
        } catch {
          yield { type: 'raw', raw }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
