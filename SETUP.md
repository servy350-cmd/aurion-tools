# SETUP — AURION Tools

## Variables de entorno

Las variables se cargan en este orden por Vite y `vercel dev`:

1. `.env.local` (no commit — local override)
2. `.env` (no commit — base local)

Plantilla en `.env.example`. Producción configurada en Vercel dashboard.

## `SUPABASE_SERVICE_ROLE_KEY` — manejo especial

Es el secreto raíz de Supabase. **No se obtiene vía MCP** (Supabase la mantiene fuera por seguridad). Es **opcional** en runtime: la app degrada en lugar de crashear.

### ¿Cuándo se necesita?

| Endpoint | Requiere service_role | Notas |
|---|---|---|
| `GET /api/health` | ❌ | Usa anon key |
| `GET /api/cron/cleanup` | ✅ | Borra storage + rows con bypass de RLS |
| `POST /api/operations/photo-extract` | ✅ | Crea operations row, sube outputs |
| `POST /api/operations/pdf-to-word` | ✅ | idem |
| `POST /api/operations/pdf-to-excel` | ✅ | idem |
| `POST /api/operations/word-to-pdf` | ✅ | idem |
| `POST /api/operations/excel-to-pdf` | ✅ | idem |
| `scripts/create-user.ts` | ✅ | Crea cuentas con admin API |

### Degradación elegante

Si la key no está configurada:

- `/api/health` responde 200 con `services.supabase.ok: true` (usa anon) y `service_role_configured: false`.
- Los endpoints que la requieren responden **503** con:
  ```json
  {"error":"SUPABASE_SERVICE_ROLE_KEY no configurada — endpoint deshabilitado. Ver SETUP.md."}
  ```
- El módulo `api/_lib/supabase.ts` usa init lazy (`getSupabaseAdmin()`), así que el resto del servidor sigue arriba.

### Cómo configurarla (manual, una sola vez)

1. https://supabase.com/dashboard/project/tqcjesaqermwkccgdtoz/settings/api
2. Sección **Project API Keys** → **service_role** → botón *Reveal*
3. Copiar el JWT (empieza por `eyJ…`, ~219 chars, 3 segmentos separados por `.`)
4. Añadir a `.env` **y** `.env.local` como una línea exacta:
   ```
   SUPABASE_SERVICE_ROLE_KEY=eyJxxxx...
   ```
   - Sin comillas, sin espacios, sin `#` delante
   - Si ya existe, reemplazarla (no duplicar)
5. Reiniciar `vercel dev`

En **Vercel Production** ya está configurada — verificar con `vercel env ls`. En **Preview/Development** falta (ver `TODO.md`).
