// supabase/functions/crear-pago/index.ts
// Crea una sesión de Stripe Checkout para pagar una orden y devuelve la URL.
//  - El cliente la usa para pagar su propia orden con tarjeta.
//  - El admin la usa para generar un "link de pago" de cualquier orden pendiente.
//
// El monto SIEMPRE se lee de la base de datos (nunca del navegador).
// Secretos necesarios: STRIPE_SECRET_KEY, (opcional) SITE_URLS.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function responder(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

/** Solo volvemos a sitios permitidos (evita redirecciones a dominios ajenos). */
function origenPermitido(req: Request): string {
  const permitidos = (Deno.env.get('SITE_URLS') ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const origen = (req.headers.get('Origin') ?? '').replace(/\/$/, '');
  return permitidos.includes(origen) ? origen : permitidos[0];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return responder({ error: 'Método no permitido' }, 405);

  const claveStripe = Deno.env.get('STRIPE_SECRET_KEY');
  if (!claveStripe) return responder({ error: 'El pago con tarjeta aún no está configurado.' }, 503);

  const url = Deno.env.get('SUPABASE_URL')!;
  const dbUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false }
  });
  const { data: sesion } = await dbUsuario.auth.getUser();
  const usuario = sesion?.user;
  if (!usuario) return responder({ error: 'Inicia sesión para pagar.' }, 401);

  const dbServicio = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false }
  });

  let ordenId: number;
  try {
    ordenId = Number((await req.json())?.orden_id);
  } catch {
    return responder({ error: 'Solicitud inválida.' }, 400);
  }
  if (!Number.isInteger(ordenId) || ordenId <= 0) return responder({ error: 'Orden inválida.' }, 400);

  const [{ data: orden }, { data: perfil }] = await Promise.all([
    dbServicio.from('ordenes').select('id, cliente_id, estado, total, metodo_pago').eq('id', ordenId).maybeSingle(),
    dbServicio.from('perfiles').select('rol, correo').eq('id', usuario.id).maybeSingle()
  ]);
  if (!orden) return responder({ error: 'La orden no existe.' }, 404);

  const esAdmin = perfil?.rol === 'admin';
  const esDueno = orden.cliente_id === usuario.id;
  if (!esAdmin && !esDueno) return responder({ error: 'No puedes pagar esta orden.' }, 403);
  if (orden.estado !== 'pendiente') return responder({ error: 'Esta orden ya no está pendiente de pago.' }, 409);
  // Un cliente solo paga en línea las órdenes que eligió pagar con tarjeta
  if (!esAdmin && orden.metodo_pago !== 'tarjeta') {
    return responder({ error: 'Esta orden no es de pago con tarjeta.' }, 400);
  }

  const centavos = Math.round(Number(orden.total) * 100); // COP usa 2 decimales en Stripe
  if (!Number.isFinite(centavos) || centavos <= 0) return responder({ error: 'Monto inválido.' }, 400);

  const origen = origenPermitido(req);
  const formulario = new URLSearchParams({
    mode: 'payment',
    success_url: `${origen}/?pago=exito&orden=${orden.id}`,
    cancel_url: `${origen}/?pago=cancelado&orden=${orden.id}`,
    client_reference_id: String(orden.id),
    // Marca propia: la cuenta de Stripe puede compartirse con otros proyectos
    'metadata[tienda]': 'modanueva',
    'metadata[orden_id]': String(orden.id),
    'payment_intent_data[metadata][tienda]': 'modanueva',
    'payment_intent_data[metadata][orden_id]': String(orden.id),
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'cop',
    'line_items[0][price_data][unit_amount]': String(centavos),
    'line_items[0][price_data][product_data][name]': `Pedido #${orden.id} · ModaNueva`
  });
  if (esDueno && perfil?.correo) formulario.set('customer_email', perfil.correo);

  const respuesta = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${claveStripe}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formulario
  });
  const datos = await respuesta.json();
  if (!respuesta.ok) {
    console.error('crear-pago: Stripe respondió', respuesta.status, datos?.error?.message);
    return responder({ error: 'No se pudo crear el pago. Intenta de nuevo.' }, 502);
  }

  await dbServicio.from('ordenes').update({ stripe_session_id: datos.id }).eq('id', orden.id);
  return responder({ url: datos.url, session_id: datos.id });
});
