# 🚀 INSTRUCCIONES PARA CLAUDE CODE

Kurosh: abre Claude Code en la carpeta donde descomprimiste este ZIP y pégale este mensaje:

---

```
Hola Claude Code. Este es AURION Tools — proyecto NUEVO e INDEPENDIENTE
(no relacionado con AURION SaaS ni con el pipeline de correo anterior).

Es una plataforma web tipo iLovePDF con IA. Mis clientes podrán hacer
extracción de datos de fotos con IA y conversiones PDF↔Word↔Excel.

Por favor:

1. Lee CLAUDE.md COMPLETO para entender contexto y reglas.
2. Verifica Node.js 20+, npm, git, gh (GitHub CLI). Si falta algo, instálalo.
3. Crea un repo nuevo PRIVADO en mi GitHub llamado "aurion-tools".
   - Usa `gh auth status` para confirmar login. Si no estoy logueado,
     guíame con `gh auth login`.
   - `gh repo create aurion-tools --private --source . --remote origin --push`
4. Setup Supabase (NUEVA cuenta, separada de cualquier otra):
   - Abre Chrome y ve a https://supabase.com/dashboard
   - Si no tengo cuenta, guíame para crearla con juanpablocespedes21@gmail.com
   - Crea proyecto "aurion-tools", región US East
   - Toma Project URL, anon key, service_role key → guarda en .env
   - SQL Editor → ejecuta supabase/schema.sql
   - Storage → crea bucket "files" privado
5. Setup Vercel (NUEVA cuenta o el plan Hobby gratis):
   - Abre Chrome y ve a https://vercel.com
   - Login con GitHub
   - Import "aurion-tools" repo
   - Agrega TODAS las variables del .env como Environment Variables
   - Deploy
6. Mi API key de Claude está en C:\Users\usuario\Desktop\aurion-pipeline\.env
   → cópiala al nuevo .env de este proyecto.
7. Crea los usuarios piloto en Supabase Authentication:
   - Pregúntame los correos de mis 2 clientes piloto
   - Crea sus cuentas con contraseña temporal
   - Marca a juanpablocespedes21@gmail.com como is_admin = true
8. (Opcional MVP) Si necesitas el servicio de LibreOffice para
   conversiones, déjalo local por ahora apuntando al LibreOffice
   que ya instalé. Después lo deployamos a Railway.
9. Cuando termines, dame:
   - URL pública de la app en Vercel
   - Confirmación que todo funciona
   - Si algo falla, error exacto y siguiente paso

Reglas:
- Habla en español.
- No me hagas preguntas técnicas innecesarias.
- Si necesitas algo de mí (login, click), pídelo UNA vez claro.
- Asumo que ya tienes acceso a Chrome, mi terminal y mi sistema de archivos.
```

---

## ❓ Lo único que Claude Code te puede pedir

1. **Login en GitHub** (una vez, vía `gh auth login` — abre Chrome solo)
2. **Click en "Permitir"** cuando Supabase/Vercel te pidan login con Google
3. **Correos de los 2 clientes piloto** (Bay Air ya lo sabe, falta el 2do)

Todo lo demás (instalar dependencias, crear proyectos, deployar, configurar) lo hace Claude Code automáticamente.

## 📍 Cuando termine el setup

Tendrás:
- ✅ Repo público en `github.com/[tu-usuario]/aurion-tools`
- ✅ App corriendo en `https://aurion-tools.vercel.app` (o tu URL custom)
- ✅ 2 cuentas de cliente creadas
- ✅ Tu cuenta de admin
- ✅ Todo conectado y funcionando

## 🎯 Cómo probarlo después del setup

1. Abre la URL de Vercel
2. Login con tu correo admin
3. Subes una foto de prueba (puedes usar la del proyecto Bay Air anterior)
4. Click en "Extraer datos de fotos"
5. Espera ~30 segundos
6. Descarga el Excel resultante

Si todo funciona, le mandas a tu cliente Bay Air su login y contraseña para que empiece a usarla.
