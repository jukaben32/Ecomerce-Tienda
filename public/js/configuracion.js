// configuracion.js
// Lee la configuración de la tienda (horario, envío, medios de pago) y
// ofrece funciones para mostrarla. El SERVIDOR es quien decide de verdad
// si un pedido está dentro del horario; aquí solo lo mostramos al cliente.
import { db } from './supabaseClient.js';

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export const ETIQUETAS_PAGO = {
  efectivo: 'Efectivo contra entrega',
  transferencia: 'Transferencia bancaria',
  tarjeta: 'Tarjeta (datáfono al entregar)',
  link_pago: 'Link de pago'
};

let cache = null;

/** Trae la configuración una sola vez y la reutiliza. */
export async function cargarConfiguracion(forzar = false) {
  if (cache && !forzar) return cache;
  const { data, error } = await db.from('configuracion').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  cache = data;
  return cache;
}

/** "08:00:00" -> "8:00 a. m." */
export function horaLegible(hora) {
  const [h, m] = String(hora || '00:00').split(':').map(Number);
  const sufijo = h >= 12 ? 'p. m.' : 'a. m.';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${sufijo}`;
}

/** Texto como "lunes a sábado, 8:00 a. m. – 6:00 p. m." */
export function textoHorario(cfg) {
  if (!cfg) return '';
  const dias = [...cfg.dias_atencion].sort((a, b) => a - b);
  const seguidos = dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
  const tramo = !dias.length
    ? 'sin días de atención'
    : seguidos && dias.length > 2
      ? `${DIAS[dias[0]]} a ${DIAS[dias[dias.length - 1]]}`
      : dias.map((d) => DIAS[d]).join(', ');
  return `${tramo}, ${horaLegible(cfg.hora_inicio)} – ${horaLegible(cfg.hora_fin)}`;
}

/** ¿Estamos ahora dentro del horario de domicilios? (solo informativo) */
export function estaEnHorario(cfg) {
  if (!cfg) return true;
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: cfg.zona_horaria, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const valor = (tipo) => partes.find((p) => p.type === tipo)?.value;
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(valor('weekday'));
  const ahora = `${valor('hour')}:${valor('minute')}`;
  return cfg.dias_atencion.includes(dia) && ahora >= cfg.hora_inicio.slice(0, 5) && ahora <= cfg.hora_fin.slice(0, 5);
}

/** Costo de envío para un subtotal (misma regla que la función SQL). */
export function calcularEnvio(cfg, subtotal) {
  if (!cfg) return 0;
  const gratis = cfg.envio_gratis_desde !== null && subtotal >= Number(cfg.envio_gratis_desde);
  return gratis ? 0 : Number(cfg.costo_envio);
}
