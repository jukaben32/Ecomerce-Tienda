// api.js
// Llamadas a las Edge Functions de Supabase (chat con IA y pagos con Stripe).
// supabase-js envía solo el token de la sesión; ninguna llave secreta pasa por aquí.
import { db } from './supabaseClient.js';
import { mostrarToast } from './util.js';

/**
 * Invoca una Edge Function y devuelve su respuesta JSON.
 * Si falla, lanza un Error con el mensaje en español que mandó el servidor.
 */
export async function invocarFuncion(nombre, cuerpo) {
  const { data, error } = await db.functions.invoke(nombre, { body: cuerpo });
  if (!error) return data;

  let mensaje = '';
  try {
    mensaje = (await error.context.json()).error;
  } catch {
    // La respuesta no era JSON (por ejemplo, sin conexión): usamos el mensaje genérico
  }
  throw new Error(mensaje || 'No se pudo completar la solicitud. Intenta de nuevo.');
}

/** Pide a Stripe la página de pago de una orden y lleva al cliente hasta allá. */
export async function irAPagar(ordenId) {
  try {
    const { url } = await invocarFuncion('crear-pago', { orden_id: ordenId });
    if (!url || !/^https:\/\/checkout\.stripe\.com\//.test(url)) throw new Error('Respuesta de pago inesperada.');
    window.location.href = url;
  } catch (err) {
    mostrarToast(
      `${err.message} Tu pedido #${ordenId} quedó registrado; puedes pagarlo desde "Mis compras".`,
      true
    );
  }
}
