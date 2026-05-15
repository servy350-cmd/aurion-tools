/**
 * Helpers para evitar que el nombre del archivo del usuario (con tildes, ñ,
 * espacios, emojis) acabe en headers HTTP que solo aceptan ISO-8859-1.
 *
 * - asciiExt(): extrae la extensión y la limpia a [a-z0-9]{1,8}.
 * - toAnonBlob(): devuelve un Blob (no File) con los mismos bytes y mime,
 *   pero SIN propiedad `name`. supabase-js storage.upload(path, blob) ya no
 *   puede incluir el nombre original en Content-Disposition multipart.
 */
export function asciiExt(filename: string, fallback = 'bin'): string {
  const dot = filename.lastIndexOf('.')
  const raw = dot >= 0 ? filename.slice(dot + 1) : ''
  const clean = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
  return clean.slice(0, 8) || fallback
}

export function toAnonBlob(file: File): Blob {
  return new Blob([file], { type: file.type || 'application/octet-stream' })
}
