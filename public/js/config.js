// config.js
// Configuración de la tienda. Aquí pegas los datos de TU proyecto Supabase.
// Dónde encontrarlos: Supabase > Project Settings > API
//   - Project URL        -> SUPABASE_URL
//   - anon public key    -> SUPABASE_ANON_KEY
// La "anon key" es pública por diseño (la seguridad la dan las reglas RLS
// del esquema SQL). NUNCA pegues aquí la "service_role key".

export const SUPABASE_URL = 'https://izsyctepheeplmbpzljk.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6c3ljdGVwaGVlcGxtYnB6bGprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3NDUwNDYsImV4cCI6MjEwNzMyMTA0Nn0.ubwR_opQLMrPyr72XL2-4BGjf3FcQdXSL2uEwsk4x18';

// Datos de la marca y la moneda
export const NOMBRE_TIENDA = 'ModaNueva';
export const MONEDA = 'COP';
export const LOCALE = 'es-CO';

// ¿Ya configuraste Supabase? (sirve para mostrar un aviso si no)
export const SUPABASE_CONFIGURADO =
  !SUPABASE_URL.includes('TU-PROYECTO') && !SUPABASE_ANON_KEY.includes('TU-ANON-KEY');
