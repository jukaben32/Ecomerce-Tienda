// checkout.js
// Ventana de "Finalizar compra": dirección de entrega, medio de pago,
// notas y resumen con envío. Al confirmar llama a la función SQL
// crear_orden, que valida todo de nuevo en el servidor.
import { db } from './supabaseClient.js';
import {
  formatearPrecio, escaparHtml, mostrarToast, abrirDialogo, cerrarDialogo, mensajeDeError
} from './util.js';
import {
  cargarConfiguracion, ETIQUETAS_PAGO, calcularEnvio, estaEnHorario, textoHorario
} from './configuracion.js';
import { listarDirecciones, guardarDireccion, direccionEnTexto } from './direcciones.js';
import { irAPagar } from './api.js';

let contexto = null;        // { usuario, perfil, carrito, subtotal } al abrir
let direcciones = [];
let cfg = null;

const $ = (id) => document.getElementById(id);

const CLASE_OPCION =
  'flex cursor-pointer items-start gap-3 rounded-xl border border-tinta/20 bg-white/50 p-3 text-sm transition';
// Clases que se añaden a la opción elegida (lo hacemos con JS porque
// el selector CSS :has(:checked) no siempre se repinta bien al cambiar de radio)
const CLASES_ELEGIDA = ['border-arcilla', 'bg-arcilla/5'];
const CLASES_NORMAL = ['border-tinta/20', 'bg-white/50'];

function opcionDireccion(d, marcada) {
  return `
    <label class="${CLASE_OPCION}">
      <input type="radio" name="dir_sel" value="${d.id}" class="mt-1 accent-arcilla" ${marcada ? 'checked' : ''}>
      <span><strong>${escaparHtml(d.etiqueta)}</strong><br>${escaparHtml(direccionEnTexto(d))}</span>
    </label>`;
}

function pintarCheckout() {
  const principal = direcciones.find((d) => d.es_principal) ?? direcciones[0];
  const hayDirecciones = direcciones.length > 0;
  const subtotal = contexto.subtotal;
  const envio = calcularEnvio(cfg, subtotal);
  const fuera = !estaEnHorario(cfg);

  $('formCheckout').innerHTML = `
    <div class="flex items-center justify-between border-b border-tinta/15 px-6 py-4">
      <h2 class="font-display text-2xl font-bold">Finalizar compra</h2>
      <button type="button" data-cerrar class="rounded-full px-3 py-1 text-sm hover:bg-crema" aria-label="Cerrar">✕</button>
    </div>

    <div class="max-h-[70vh] space-y-6 overflow-y-auto px-6 py-5">
      ${fuera ? `<p class="rounded-xl bg-arcilla/10 px-4 py-3 text-sm text-arcilla">${escaparHtml(cfg.mensaje_fuera_horario)}</p>` : ''}

      <fieldset class="space-y-2">
        <legend class="mb-2 text-sm font-bold uppercase tracking-widest text-tinta/60">1 · Dirección de entrega</legend>
        ${direcciones.map((d) => opcionDireccion(d, d.id === principal?.id)).join('')}
        <label class="${CLASE_OPCION}">
          <input type="radio" name="dir_sel" value="nueva" class="mt-1 accent-arcilla" ${hayDirecciones ? '' : 'checked'}>
          <span><strong>Usar otra dirección</strong></span>
        </label>

        <div id="bloqueNueva" class="${hayDirecciones ? 'hidden' : ''} space-y-3 rounded-xl border border-dashed border-tinta/25 p-4">
          <div class="grid grid-cols-2 gap-3">
            <label class="block text-sm font-medium">Etiqueta <input name="etiqueta" maxlength="40" value="Casa" class="campo"></label>
            <label class="block text-sm font-medium">Ciudad <input name="ciudad" maxlength="80" class="campo"></label>
          </div>
          <label class="block text-sm font-medium">Dirección <input name="direccion" maxlength="200" placeholder="Calle 10 # 5-20, apto 301" class="campo"></label>
          <div class="grid grid-cols-2 gap-3">
            <label class="block text-sm font-medium">Barrio <input name="barrio" maxlength="80" class="campo"></label>
            <label class="block text-sm font-medium">Referencias <input name="referencias" maxlength="200" placeholder="Portón verde…" class="campo"></label>
          </div>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="guardar" checked class="accent-arcilla"> Guardar para próximas compras</label>
        </div>
      </fieldset>

      <label class="block text-sm font-medium">Teléfono de contacto
        <input name="telefono_contacto" type="tel" required maxlength="30" value="${escaparHtml(contexto.perfil?.telefono ?? '')}" class="campo">
      </label>

      <fieldset class="space-y-2">
        <legend class="mb-2 text-sm font-bold uppercase tracking-widest text-tinta/60">2 · Medio de pago</legend>
        ${cfg.medios_pago
          .map(
            (m, i) => `
          <label class="${CLASE_OPCION}">
            <input type="radio" name="pago" value="${escaparHtml(m)}" class="mt-1 accent-arcilla" ${i === 0 ? 'checked' : ''}>
            <span>${escaparHtml(ETIQUETAS_PAGO[m] ?? m)}</span>
          </label>`
          )
          .join('')}
        <p id="notaTransferencia" class="hidden whitespace-pre-line rounded-xl bg-crema px-4 py-3 text-sm">${escaparHtml(cfg.instrucciones_transferencia ?? 'Te enviaremos los datos de la cuenta para transferir.')}</p>
      </fieldset>

      <label class="block text-sm font-medium">Notas para el pedido (opcional)
        <textarea name="notas" rows="2" maxlength="500" class="campo"></textarea>
      </label>

      <dl class="space-y-1 border-t border-tinta/15 pt-4 text-sm">
        <div class="flex justify-between"><dt>Subtotal</dt><dd>${formatearPrecio(subtotal)}</dd></div>
        <div class="flex justify-between"><dt>Envío</dt><dd>${envio === 0 ? 'Gratis' : formatearPrecio(envio)}</dd></div>
        <div class="flex justify-between font-display text-2xl font-bold"><dt>Total</dt><dd>${formatearPrecio(subtotal + envio)}</dd></div>
      </dl>
      ${cfg.pedido_minimo > 0 ? `<p class="text-xs text-tinta/60">Pedido mínimo: ${formatearPrecio(cfg.pedido_minimo)}.</p>` : ''}
      <p class="text-xs text-tinta/60">Domicilios: ${escaparHtml(textoHorario(cfg))}.</p>
    </div>

    <div class="border-t border-tinta/15 px-6 py-4">
      <button type="submit" class="boton-principal">Confirmar pedido</button>
    </div>`;

  actualizarVisibilidad();
}

/** Resalta la opción elegida de cada grupo de radios. */
function marcarSeleccion() {
  $('formCheckout').querySelectorAll('input[type="radio"]').forEach((radio) => {
    const etiqueta = radio.closest('label');
    // Quitamos/ponemos ambos juegos de clases para que no compitan entre sí
    CLASES_ELEGIDA.forEach((clase) => etiqueta.classList.toggle(clase, radio.checked));
    CLASES_NORMAL.forEach((clase) => etiqueta.classList.toggle(clase, !radio.checked));
  });
}

/** Muestra/oculta el formulario de dirección nueva y la nota de transferencia. */
function actualizarVisibilidad() {
  const f = $('formCheckout');
  marcarSeleccion();
  $('bloqueNueva').classList.toggle('hidden', f.dir_sel.value !== 'nueva');
  $('notaTransferencia').classList.toggle('hidden', f.pago.value !== 'transferencia');
}

/** Devuelve el texto de dirección elegido (y guarda la nueva si se pidió). */
async function resolverDireccion(f) {
  if (f.dir_sel.value !== 'nueva') {
    const d = direcciones.find((x) => x.id === Number(f.dir_sel.value));
    return direccionEnTexto(d);
  }
  const nueva = {
    etiqueta: f.etiqueta.value.trim() || 'Casa',
    direccion: f.direccion.value.trim(),
    barrio: f.barrio.value.trim() || null,
    ciudad: f.ciudad.value.trim(),
    referencias: f.referencias.value.trim() || null,
    telefono: f.telefono_contacto.value.trim() || null,
    es_principal: direcciones.length === 0
  };
  if (nueva.direccion.length < 5) throw new Error('Escribe la dirección de entrega.');
  if (!nueva.ciudad) throw new Error('Escribe la ciudad.');
  if (f.guardar.checked) await guardarDireccion(contexto.usuario.id, nueva);
  return direccionEnTexto(nueva) + (nueva.referencias ? ` (${nueva.referencias})` : '');
}

async function confirmar(ev) {
  ev.preventDefault();
  const f = ev.currentTarget;
  const boton = f.querySelector('button[type="submit"]');
  boton.disabled = true;
  try {
    const direccion = await resolverDireccion(f);
    const { data, error } = await db.rpc('crear_orden', {
      p_items: contexto.carrito,
      p_direccion: direccion,
      p_metodo_pago: f.pago.value,
      p_notas: f.notas.value.trim() || null,
      p_telefono: f.telefono_contacto.value.trim()
    });
    if (error) throw error;
    cerrarDialogo('dlgCheckout');
    contexto.alExito(data);
    // Pago con tarjeta: llevamos al cliente a la página segura de Stripe
    if (f.pago.value === 'tarjeta') await irAPagar(data.orden_id);
  } catch (err) {
    mostrarToast(mensajeDeError(err, 'No fue posible crear el pedido.'), true);
    contexto.alError?.();
  } finally {
    boton.disabled = false;
  }
}

/**
 * Abre el checkout.
 * @param {{usuario:object, perfil:object, carrito:Array, subtotal:number,
 *          alExito:(r:object)=>void, alError?:()=>void}} datos
 */
export async function abrirCheckout(datos) {
  contexto = datos;
  try {
    [cfg, direcciones] = await Promise.all([cargarConfiguracion(), listarDirecciones(datos.usuario.id)]);
  } catch (err) {
    mostrarToast(mensajeDeError(err), true);
    return;
  }
  pintarCheckout();
  abrirDialogo('dlgCheckout');
}

export function conectarCheckout() {
  const f = $('formCheckout');
  f.addEventListener('submit', confirmar);
  f.addEventListener('change', actualizarVisibilidad);
}
