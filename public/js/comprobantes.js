// comprobantes.js
// Pago por transferencia bancaria: muestra los datos de la cuenta y deja que
// el cliente suba la foto (o PDF) de su comprobante. El archivo va a un
// bucket PRIVADO dentro de una carpeta con su propio id; el admin lo revisa
// y marca el pedido como pagado.
import { db } from './supabaseClient.js';
import { formatearPrecio, escaparHtml, mostrarToast, abrirDialogo, cerrarDialogo, mensajeDeError } from './util.js';
import { cargarConfiguracion } from './configuracion.js';

const BUCKET = 'comprobantes';
const MAX_BYTES = 5 * 1024 * 1024;
const EXTENSIONES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

let enlaces = null;       // { obtenerUsuario, alSubir }
let ordenActual = null;   // { ordenId, total }

const $ = (id) => document.getElementById(id);

/** Sube el archivo y lo asocia a la orden (la función SQL valida que sea del cliente). */
export async function subirComprobante(usuarioId, ordenId, archivo) {
  const extension = EXTENSIONES[archivo.type];
  if (!extension) throw new Error('Usa una foto (JPG, PNG, WebP) o un PDF.');
  if (archivo.size > MAX_BYTES) throw new Error('El archivo supera los 5 MB.');

  const ruta = `${usuarioId}/orden-${ordenId}-${Date.now()}.${extension}`;
  const { error } = await db.storage.from(BUCKET).upload(ruta, archivo, { contentType: archivo.type, upsert: false });
  if (error) throw error;
  const { error: errorOrden } = await db.rpc('adjuntar_comprobante', { p_orden: ordenId, p_ruta: ruta });
  if (errorOrden) throw errorOrden;
}

/** Enlace de WhatsApp para enviar el comprobante (solo si la tienda configuró su número). */
function enlaceWhatsapp(cfg, ordenId) {
  const digitos = String(cfg.whatsapp ?? '').replace(/\D/g, '');
  if (digitos.length < 8) return '';
  const texto = encodeURIComponent(`Hola, te envío el comprobante de transferencia del pedido #${ordenId}.`);
  return `https://wa.me/${digitos}?text=${texto}`;
}

/**
 * Abre la ventana con los datos de la transferencia y el selector del comprobante.
 * @param {{ordenId:number, total:number}} datos
 */
export async function abrirComprobante(datos) {
  ordenActual = datos;
  let cfg;
  try {
    cfg = await cargarConfiguracion();
  } catch (err) {
    mostrarToast(mensajeDeError(err), true);
    return;
  }
  $('tituloComprobante').textContent = `Pedido #${datos.ordenId}: falta tu transferencia`;
  const wa = enlaceWhatsapp(cfg, datos.ordenId);
  $('datosTransferencia').innerHTML = `
    <p>Transfiere <strong class="font-display text-xl">${formatearPrecio(datos.total)}</strong> y sube la foto del comprobante.</p>
    <div class="whitespace-pre-line rounded-xl bg-crema px-4 py-3">${escaparHtml(cfg.instrucciones_transferencia || 'Te enviaremos los datos de la cuenta por mensaje.')}</div>
    ${wa ? `<p class="text-xs text-tinta/70">¿Prefieres enviarlo por WhatsApp? <a href="${escaparHtml(wa)}" target="_blank" rel="noopener" class="font-medium text-arcilla underline underline-offset-4">Abrir WhatsApp</a></p>` : ''}
    <p class="text-xs text-tinta/60">Cuando verifiquemos el pago, tu pedido pasará a «pagada».</p>`;
  $('formComprobante').reset();
  abrirDialogo('dlgComprobante');
}

/**
 * Conecta la ventana de comprobantes.
 * @param {{obtenerUsuario:()=>object|null, alSubir:()=>void}} funciones
 */
export function conectarComprobantes(funciones) {
  enlaces = funciones;
  $('formComprobante').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const usuario = enlaces.obtenerUsuario();
    const archivo = $('archivoComprobante').files[0];
    if (!usuario || !archivo || !ordenActual) return;
    const boton = ev.currentTarget.querySelector('button[type="submit"]');
    boton.disabled = true;
    try {
      await subirComprobante(usuario.id, ordenActual.ordenId, archivo);
      cerrarDialogo('dlgComprobante');
      mostrarToast('¡Comprobante enviado! Lo revisaremos y confirmaremos tu pago.');
      enlaces.alSubir();
    } catch (err) {
      mostrarToast(mensajeDeError(err, 'No se pudo subir el comprobante.'), true);
    } finally {
      boton.disabled = false;
    }
  });
}
