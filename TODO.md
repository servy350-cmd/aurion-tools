# AURION Tools — TODO / blockers conocidos

## 🔐 SUPABASE_SERVICE_ROLE_KEY local

El `.env` local NO tiene la `service_role` key porque ningún MCP la expone (es el
secreto raíz de Supabase). Para que las funciones de backend funcionen con
`vercel dev` localmente, cópiala manualmente desde:

- Dashboard: https://supabase.com/dashboard/project/tqcjesaqermwkccgdtoz/settings/api
- Sección **Project API Keys** → **service_role** → botón *Reveal*.
- Pégala en `.env` después de `SUPABASE_SERVICE_ROLE_KEY=`.

En **producción** (Vercel) ya está configurada — verificado con `vercel env ls`.

## 🌿 Vercel — Preview environment vars no configuradas

Ninguna env var del proyecto está en el environment **Preview** de Vercel. Hoy
no hay branches de preview, pero el primer PR que abras va a fallar porque el
deploy preview no encontrará `SUPABASE_SERVICE_ROLE_KEY` ni el resto.

**Bug de Vercel CLI 54.0.0**: el comando
`vercel env add NAME preview --value X --yes` devuelve `action_required` aunque
es la sintaxis que el propio CLI sugiere.

**Workaround**: añadirlas desde el dashboard de Vercel
(https://vercel.com/servy350-cmds-projects/aurion-tools/settings/environment-variables),
marcando todos los environments (Preview + Production + Development) al crearlas.

Variables que faltan en Preview:

- `SUPABASE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `CLAUDE_MODEL`
- `LIBREOFFICE_SERVICE_URL`
- `CRON_SECRET`

## 🛠 CRON_SECRET en Vercel

El cron `/api/cron/cleanup` requiere el header `Authorization: Bearer $CRON_SECRET`.
Vercel lo manda automáticamente cuando configuras la var. Subirla al dashboard
de Vercel a los tres environments (Production + Preview + Development) con el
valor que está en `.env` local (`CRON_SECRET=...`).
