# test-assets/

Carpeta con archivos para el smoke test del MVP. **`test-assets/` está en
`.gitignore`** (los archivos no se commitean — son datos de prueba locales).

Pon en esta carpeta los siguientes archivos antes de correr el smoke test:

| Archivo | Tipo | Para qué se usa | Origen sugerido |
|---|---|---|---|
| `placa.jpg` | Foto JPEG | Operación **photo_extract** (Claude Vision lee la placa HVAC) | Foto del proyecto Bay Air anterior, o cualquier placa real de equipo |
| `pdf-corto.pdf` | PDF (1-3 páginas) | Operaciones **pdf_to_word** y **pdf_to_excel** | Cualquier PDF corto con texto y/o una tabla |
| `word-corto.docx` | Word (DOCX) | Operación **word_to_pdf** | Cualquier DOCX corto |
| `excel-corto.xlsx` | Excel (XLSX) | Operación **excel_to_pdf** | Cualquier XLSX corto |

## Checklist por archivo

- [ ] **placa.jpg** — debe ser legible, con UNIT ID visible. Tamaño < 10 MB.
- [ ] **pdf-corto.pdf** — texto seleccionable (si es escaneo de imágenes, el
      flujo `pdf_to_word` va a producir un PDF con imágenes embebidas). Tamaño
      < 20 MB.
- [ ] **word-corto.docx** — DOCX moderno (no DOC clásico de Office 97).
      Tamaño < 10 MB.
- [ ] **excel-corto.xlsx** — XLSX moderno con al menos una hoja con datos.
      Tamaño < 10 MB.

## Resultado esperado del smoke test

1. **photo_extract(placa.jpg)** → Excel con 1 fila por equipo extraído.
2. **pdf_to_word(pdf-corto.pdf)** → DOCX con texto editable.
3. **pdf_to_excel(pdf-corto.pdf)** → XLSX con tablas extraídas.
4. **word_to_pdf(word-corto.docx)** → PDF.
5. **excel_to_pdf(excel-corto.xlsx)** → PDF.

Todas las operaciones suben el resultado a Supabase Storage y devuelven una
URL firmada con expiración de 1 hora.
