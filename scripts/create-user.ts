/**
 * scripts/create-user.ts
 *
 * Crea un usuario piloto en Supabase Auth + deja su profile en el plan correcto.
 *
 * Uso:
 *   npm run create-user -- <email> <password> <FLEX|PRIME> <true|false>
 *
 * Ejemplo:
 *   npm run create-user -- piloto@empresa.com Temp1234 PRIME false
 *
 * Requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno
 * (el script npm los carga vía --env-file=.env).
 */
import { createClient } from '@supabase/supabase-js'

const [email, password, plan, isAdminStr] = process.argv.slice(2)

const USAGE = 'Uso: npm run create-user -- <email> <password> <FLEX|PRIME> <true|false>'

if (!email || !password || !plan || !isAdminStr) {
  console.error(USAGE)
  process.exit(1)
}
if (plan !== 'FLEX' && plan !== 'PRIME') {
  console.error('plan debe ser FLEX o PRIME')
  process.exit(1)
}
if (isAdminStr !== 'true' && isAdminStr !== 'false') {
  console.error('is_admin debe ser true o false')
  process.exit(1)
}
const isAdmin = isAdminStr === 'true'

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.')
  console.error('Asegúrate de tenerlos en .env y de correr vía `npm run create-user`.')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
})

if (error || !data.user) {
  console.error(`createUser falló: ${error?.message || 'sin user en respuesta'}`)
  process.exit(1)
}

const userId = data.user.id
console.log(`✓ Usuario creado: ${email} (id=${userId})`)

// El trigger handle_new_user debió crear la fila en profiles. Update plan/admin.
const { data: updated, error: updErr } = await admin
  .from('profiles')
  .update({ plan, is_admin: isAdmin })
  .eq('id', userId)
  .select()
  .maybeSingle()

if (!updErr && updated) {
  console.log(`✓ Profile listo: plan=${plan} is_admin=${isAdmin}`)
  process.exit(0)
}

// Fallback: el trigger no corrió, intentar insert directo.
const { error: insErr } = await admin
  .from('profiles')
  .insert({ id: userId, email, plan, is_admin: isAdmin })

if (insErr) {
  console.error(`No se pudo dejar el profile en estado correcto: ${insErr.message}`)
  console.error(`El usuario auth EXISTE (id=${userId}) pero su profile no.`)
  process.exit(1)
}

console.log(`✓ Profile creado manualmente: plan=${plan} is_admin=${isAdmin}`)
