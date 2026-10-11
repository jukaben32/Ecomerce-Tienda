// supabaseClient.js
// Crea UNA sola conexión a Supabase que usan la tienda y el admin.
// La librería se carga desde un CDN (no hay que instalar nada).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_CONFIGURADO } from './config.js';

// Si aún no hay credenciales usamos valores de relleno para que la página
// cargue sin romperse; las consultas fallarán y mostraremos el aviso.
export const db = createClient(
  SUPABASE_CONFIGURADO ? SUPABASE_URL : 'https://placeholder.supabase.co',
  SUPABASE_CONFIGURADO ? SUPABASE_ANON_KEY : 'placeholder'
);
