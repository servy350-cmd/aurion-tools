# LibreOffice Service

Microservicio Node.js que recibe archivos y los convierte usando LibreOffice headless + poppler-utils.

## Endpoints

- `POST /convert` — Form-data: `file` + `target` (pdf/docx/xlsx). Devuelve el archivo convertido.
- `POST /pdf-to-images` — Form-data: `file` (PDF). Devuelve JSON con páginas como imágenes base64.
- `GET /health` — Healthcheck.

## Desarrollo local

Requiere LibreOffice y poppler-utils instalados:

```bash
# Linux (Ubuntu/Debian)
sudo apt install libreoffice poppler-utils

# macOS
brew install libreoffice poppler

# Windows
# Descarga LibreOffice de libreoffice.org y poppler de blog.alivate.com.au/poppler-windows
```

Luego:

```bash
cd libreoffice-service
npm install
npm run dev
# Servicio corriendo en http://localhost:3001
```

## Deploy a Railway

1. Crea un proyecto nuevo en Railway
2. Conéctalo a tu repo de GitHub `aurion-tools`
3. Configura el **Root Directory** como `libreoffice-service`
4. Railway detectará el Dockerfile y lo deployará
5. Toma la URL pública (`https://aurion-libreoffice-xxxx.up.railway.app`)
6. Pónla en el `.env` del proyecto principal como `LIBREOFFICE_SERVICE_URL`

## Costos

Plan Hobby de Railway: ~$5 USD/mes con el sleep automático cuando no se usa.
