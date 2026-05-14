# CLAUDE.md — Guía para Claude Code

## Usuario

- **Kurosh**, founder de AURION, Colombia, no codea.
- Comunica en español.
- Quiere resultados rápidos sin preguntas innecesarias.
- Ya tiene Claude Code instalado, Chrome con MCP browser disponible, GitHub CLI (`gh`) y Python.

## Proyecto

**AURION Tools** — Plataforma web independiente (NO relacionada con AURION SaaS principal).

Es un MVP estilo iLovePDF con IA: permite a clientes registrados subir archivos y aplicar operaciones (extracción de datos con IA + conversiones de formato).

## Stack

- Frontend: **React + TypeScript + Vite + Tailwind CSS**
- Backend: **Vercel Serverless Functions** (TypeScript)
- Auth + DB + Storage: **Supabase**
- IA: **Claude API** (modelo `claude-opus-4-7`)
- Conversiones: **LibreOffice** (vía microservicio en Railway o local)

## Operaciones soportadas

1. `photo_extract` — Lee fotos con Claude Vision y devuelve datos estructurados (JSON o Excel).
2. `pdf_to_word` — Convierte PDF a DOCX con LibreOffice.
3. `pdf_to_excel` — Convierte PDF a XLSX con LibreOffice.
4. `word_to_pdf` — Convierte DOCX a PDF.
5. `excel_to_pdf` — Convierte XLSX a PDF.

## Reglas

- 2 clientes máximo al inicio (Bay Air + 1 a definir). Sin registro público.
- El admin (Kurosh, `juanpablocespedes21@gmail.com`) crea las cuentas desde el dashboard de Supabase.
- Cada cliente tiene plan FLEX (4 operaciones / 30 días rolling) o PRIME (ilimitado).
- Cuando un cliente excede su cuota, se le devuelve error pero NO se cobra extra.
- Donde haya datos no legibles → "Informacion no disponible en foto" (literal).

## Setup que tú (Claude Code) debes hacer

1. Verifica Node.js 20+ y npm instalados. Si falta, instálalos.
2. **GitHub**:
   - Pregúntale a Kurosh el nombre del repo que quiere (por defecto: `aurion-tools`).
   - Usa `gh auth status` para verificar que está logueado en GitHub CLI.
   - Si no lo está, ejecuta `gh auth login` y guíalo.
   - Crea repo nuevo (privado) con `gh repo create`.
   - Inicializa git en la carpeta del proyecto, hace primer commit y push.
3. **Supabase** (usa Chrome MCP):
   - Abre https://supabase.com/dashboard.
   - Si no tiene cuenta, guíalo a crearla con `juanpablocespedes21@gmail.com`.
   - Crea proyecto nuevo: `aurion-tools`, región más cercana (probablemente US East para Colombia).
   - Toma `Project URL` y `anon key` desde Settings > API.
   - Toma `service_role key` (la secreta) desde Settings > API.
   - Ejecuta `supabase/schema.sql` en el SQL Editor.
   - Crea bucket `files` en Storage (privado).
4. **Vercel** (usa Chrome MCP):
   - Abre https://vercel.com/.
   - Login con GitHub.
   - Import repo `aurion-tools`.
   - Configura variables de entorno (las que están en `.env.example`).
   - Deploy.
5. **Claude API**: Kurosh ya tiene la API key. Está en su `.env` del proyecto del pipeline anterior (`C:\Users\usuario\Desktop\aurion-pipeline\.env`). Cópiala al nuevo `.env` de este proyecto.
6. **LibreOffice Service** (opcional para MVP — solo si va a usar conversiones):
   - Si ya tiene LibreOffice local (del proyecto anterior), úsalo localmente en modo dev.
   - Para producción, deploy a Railway con el Dockerfile incluido.
7. **Crear los 2 usuarios piloto en Supabase**:
   - Authentication > Users > Invite user
   - `bert@bayair.com` (cliente Bay Air) — plan PRIME
   - Pregunta a Kurosh por el segundo email
8. **Marcar a Kurosh como admin** en la tabla `profiles`:
   - SQL Editor: `update profiles set is_admin = true where email = 'juanpablocespedes21@gmail.com';`
9. **Probar** la app:
   - Login con la cuenta de Kurosh
   - Subir una foto de prueba (la del proyecto Bay Air)
   - Ver que extrae datos
   - Ver que aparece en historial

## Estructura

```
aurion-tools/
├── frontend/        # React + Vite (deploy a Vercel como static)
├── api/             # Serverless functions (deploy a Vercel)
├── libreoffice-service/  # Microservicio Node.js + LibreOffice (Railway)
├── supabase/
│   └── schema.sql   # Schema completo de Supabase
├── vercel.json
└── ...
```

## Variables de entorno

Crea `.env` en la raíz del proyecto con:

```
# Supabase
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxxx...

# Claude API
ANTHROPIC_API_KEY=sk-ant-xxxxx
CLAUDE_MODEL=claude-opus-4-7

# LibreOffice Service
LIBREOFFICE_SERVICE_URL=http://localhost:3001
# En producción: https://aurion-libreoffice-xxxx.up.railway.app
```

## Comunicación con Kurosh

- Español, directo, sin filosofía.
- Si algo falla, muestra el error exacto y la solución.
- Si necesitas algo del usuario (login, click), pídelo claramente UNA vez.
- No me preguntes cosas que ya se decidieron en este archivo.
