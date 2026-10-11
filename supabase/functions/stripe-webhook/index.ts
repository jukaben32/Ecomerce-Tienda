// supabase/functions/stripe-webhook/index.ts
// Recibe los avisos de Stripe y marca la orden como "pagada".
//
// Seguridad:
//  - Verifica la firma HMAC (cabecera Stripe-Signature) con STRIPE_WEBHOOK_SECRET.
//    Sin firma válida no se hace nada.
//  - Comprueba que el monto pagado coincide con el total de la orden.
//  - Es idempotente: si Stripe reenvía el aviso, no pasa nada la segunda vez.
// Esta función se despliega SIN verificación JWT (Stripe no envía JWT).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const TOLERANCIA_SEGUNDOS = 300;

const respuesta = (cuerpo: unknown, estado = 200): Response =>
  new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'Content-Type': 'application/json' } });

const aHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Comparación en tiempo constante para no filtrar información por tiempos. */
function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

async function firmaValida(cuerpo: string, cabecera: string, secreto: string): Promise<boolean> {
  const partes = Object.fromEntries(
    cabecera.split(',').map((p) => {
      const [k, ...v] = p.split('=');
      return [k.trim(), v.join('=')];
    })
  );
  const t = Number(partes.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > TOLERANCIA_SEGUNDOS) return false;
  // Puede haber varias firmas v1 (rotación de secretos)
  const candidatas = cabecera
    .split(',')
    .filter((p) => p.trim().startsWith('v1='))
    .map((p) => p.trim().slice(3));
  if (!candidatas.length) return false;

  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const esperada = aHex(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(`${t}.${cuerpo}`)));
  return candidatas.some((c) => iguales(c, esperada));
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return respuesta({ error: 'Método no permitido' }, 405);

  const secreto = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secreto) return respuesta({ error: 'Webhook no configurado' }, 503);

  const cuerpo = await req.text();
  const cabecera = req.headers.get('stripe-signature') ?? '';
  if (!(await firmaValida(cuerpo, cabecera, secreto))) return respuesta({ error: 'Firma inválida' }, 400);

  let evento: { type: string; data: { object: Record<string, unknown> } };
  try {
    evento = JSON.parse(cuerpo);
  } catch {
    return respuesta({ error: 'JSON inválido' }, 400);
  }

  const tipos = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
  if (!tipos.includes(evento.type)) return respuesta({ recibido: true, ignorado: evento.type });

  const sesion = evento.data.object as {
    id: string;
    payment_status?: string;
    amount_total?: number;
    currency?: string;
    metadata?: { orden_id?: string };
    client_reference_id?: string;
  };
  if (sesion.payment_status !== 'paid') return respuesta({ recibido: true, nota: 'aún sin pagar' });

  const ordenId = Number(sesion.metadata?.orden_id ?? sesion.client_reference_id);
  if (!Number.isInteger(ordenId) || ordenId <= 0) return respuesta({ error: 'Sin orden asociada' }, 400);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false }
  });

  // Defensa extra: el monto cobrado debe ser el total de la orden
  const { data: orden } = await db.from('ordenes').select('total').eq('id', ordenId).maybeSingle();
  if (!orden) return respuesta({ error: 'Orden inexistente' }, 404);
  const esperado = Math.round(Number(orden.total) * 100);
  if (sesion.currency !== 'cop' || sesion.amount_total !== esperado) {
    console.error('stripe-webhook: monto no coincide', { ordenId, esperado, recibido: sesion.amount_total, moneda: sesion.currency });
    return respuesta({ error: 'Monto no coincide' }, 400);
  }

  const { data: marcada, error } = await db.rpc('marcar_orden_pagada', { p_orden: ordenId, p_session: sesion.id });
  if (error) {
    console.error('stripe-webhook: error al marcar pagada', error.message);
    return respuesta({ error: 'No se pudo actualizar la orden' }, 500); // Stripe reintentará
  }
  return respuesta({ recibido: true, orden: ordenId, actualizada: Boolean(marcada) });
});
