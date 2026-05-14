# AURION Tools

Plataforma web tipo iLovePDF con IA. Permite a clientes registrados:

- 📷 **Extraer datos de fotos** con Claude Vision (placas HVAC u otros datos estructurados)
- 🔄 **Convertir PDF → Word**
- 🔄 **Convertir PDF → Excel**
- 🔄 **Convertir Word → PDF**
- 🔄 **Convertir Excel → PDF**

## 🏗️ Stack

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Vercel Serverless Functions (Node.js + TypeScript)
- **Auth + DB + Storage**: Supabase
- **IA**: Claude API (Anthropic)
- **Conversiones**: LibreOffice (via servicio Node.js, en Railway o local)

## 🚀 Setup

**👉 Abre `INSTRUCCIONES_PARA_CLAUDE_CODE.md` y pásale el bloque inicial a Claude Code en tu terminal. Él hace TODO el setup.**

Si quieres entender los pasos manuales, mira el README dentro de cada subcarpeta.

## 📁 Estructura

```
aurion-tools/
├── frontend/                    # React app (Vercel)
├── api/                         # Serverless functions (Vercel)
├── libreoffice-service/         # Microservicio para conversiones (Railway)
├── supabase/                    # Schema SQL + seeds
├── CLAUDE.md                    # Contexto para Claude Code
├── INSTRUCCIONES_PARA_CLAUDE_CODE.md
├── vercel.json
├── .gitignore
└── README.md
```

## 💰 Costos

| Servicio | Plan | Costo |
|---|---|---|
| Vercel | Hobby | $0 |
| Supabase | Free | $0 |
| Railway (LibreOffice) | Hobby | $5/mes |
| Claude API | Pay-as-you-go | ~$0.10-0.50 por operación |
| **Total fijo** | | **~$5 USD/mes** |

Con 2 clientes haciendo 20 operaciones al mes: **~$10-15 USD/mes total**.

## 👥 Clientes piloto (MVP)

Los crea el admin manualmente desde el dashboard de Supabase. No hay registro público.

## 🔒 Seguridad

- Auth con Supabase (JWT)
- Row Level Security en cada tabla
- Cada cliente ve solo sus archivos
- URLs firmadas para descarga (1h expiración)
- Archivos auto-eliminados después de 7 días (cron job)
