// compras.js
// "Mis compras" del perfil: lista de pedidos con su detalle y la opción
// de calificar los pedidos ya entregados (una calificación por pedido).
import { db } from './supabaseClient.js';
import {
  formatearPrecio, formatearFecha, escaparHtml, mostrarToast,
  abrirDialogo, cerrarDialogo, mensajeDeError
} from './util.js';
import { ETIQUETAS_PAGO } from './configuracion.js';
import { irAPagar } from './api.js';

let usuarioActual = null;
let ordenACalificar = null;
let estrellasElegidas = 0;

const $ = (id) => document.getElementById(id);

function estrellas(n) {
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function tarjetaPedido(o, calificacion) {
  const lineas = (o.items_orden ?? [])
    .map((it) => `<li class="flex justify-between gap-3"><span>${it.cantidad} × ${escaparHtml(it.nombre_producto)}</span><span>${formatearPrecio(it.total_renglon)}</span></li>`)
    .join('');

  let pie = '';
  if (calificacion) {
    pie = `<p class="mt-3 text-sm"><span class="text-arcilla" aria-label="${calificacion.estrellas} de 5 estrellas">${estrellas(calificacion.estrellas)}</span> <span class="text-tinta/60">Tu calificación</span></p>`;
  } else if (o.estado === 'pendiente' && o.metodo_pago === 'tarjeta') {
    pie = `<button type="button" data-pagar="${o.id}" class="mt-3 rounded-full bg-arcilla px-4 py-1.5 text-sm font-medium text-white transition hover:brightness-110">Pagar ahora</button>`;
  } else if (o.estado === 'entregada') {
    pie = `<button type="button" data-calificar="${o.id}" class="mt-3 rounded-full border border-tinta px-4 py-1.5 text-sm font-medium transition hover:bg-tinta hover:text-papel">Calificar pedido</button>`;
  }

  return `
    <article class="rounded-2xl border border-tinta/15 bg-white/50 p-4">
      <header class="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h3 class="font-display text-lg font-bold">Pedido #${o.id}</h3>
          <p class="text-xs text-tinta/60">${escaparHtml(formatearFecha(o.realizada_en))} · <span class="font-medium capitalize">${escaparHtml(o.estado)}</span>
          ${o.metodo_pago ? ` · ${escaparHtml(ETIQUETAS_PAGO[o.metodo_pago] ?? o.metodo_pago)}` : ''}</p>
        </div>
        <p class="font-display text-xl font-bold">${formatearPrecio(o.total)}</p>
      </header>
      <ul class="space-y-1 text-sm">${lineas}</ul>
      ${Number(o.costo_envio) > 0 ? `<p class="mt-1 flex justify-between text-sm text-tinta/70"><span>Envío</span><span>${formatearPrecio(o.costo_envio)}</span></p>` : ''}
      ${o.direccion_entrega ? `<p class="mt-2 text-xs text-tinta/60">Entrega: ${escaparHtml(o.direccion_entrega)}</p>` : ''}
      ${pie}
    </article>`;
}

/** Carga y pinta los pedidos del cliente. */
export async function cargarMisCompras(usuario) {
  usuarioActual = usuario;
  const lista = $('listaCompras');
  if (!usuario) {
    lista.innerHTML = '<p class="text-tinta/60">Inicia sesión para ver tus compras.</p>';
    return;
  }
  lista.innerHTML = '<p class="text-tinta/60">Cargando…</p>';
  // .eq(cliente_id): un admin solo debe ver aquí SUS compras, no las de todos
  const [ordenes, califs] = await Promise.all([
    db.from('ordenes')
      .select('id, estado, total, costo_envio, metodo_pago, direccion_entrega, realizada_en, items_orden(nombre_producto, cantidad, total_renglon)')
      .eq('cliente_id', usuario.id)
      .order('realizada_en', { ascending: false }),
    db.from('calificaciones').select('orden_id, estrellas').eq('cliente_id', usuario.id)
  ]);
  const error = ordenes.error || califs.error;
  if (error) {
    lista.innerHTML = `<p class="text-arcilla">${escaparHtml(mensajeDeError(error))}</p>`;
    return;
  }
  if (!ordenes.data.length) {
    lista.innerHTML = '<p class="text-tinta/60">Aún no tienes compras.</p>';
    return;
  }
  const porOrden = new Map(califs.data.map((c) => [c.orden_id, c]));
  lista.innerHTML = ordenes.data.map((o) => tarjetaPedido(o, porOrden.get(o.id))).join('');
}

function pintarEstrellas() {
  $('estrellasElegir').querySelectorAll('[data-estrella]').forEach((b) => {
    const activa = Number(b.dataset.estrella) <= estrellasElegidas;
    b.textContent = activa ? '★' : '☆';
    b.setAttribute('aria-pressed', String(activa));
    b.classList.toggle('text-arcilla', activa);
  });
}

export function conectarCompras() {
  $('listaCompras').addEventListener('click', (ev) => {
    const pagar = ev.target.closest('[data-pagar]');
    if (pagar) {
      pagar.disabled = true;
      irAPagar(Number(pagar.dataset.pagar)).finally(() => {
        pagar.disabled = false;
      });
      return;
    }
    const b = ev.target.closest('[data-calificar]');
    if (!b) return;
    ordenACalificar = Number(b.dataset.calificar);
    estrellasElegidas = 0;
    $('tituloCalificar').textContent = `Califica el pedido #${ordenACalificar}`;
    $('formCalificar').reset();
    pintarEstrellas();
    abrirDialogo('dlgCalificar');
  });

  $('estrellasElegir').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-estrella]');
    if (!b) return;
    estrellasElegidas = Number(b.dataset.estrella);
    pintarEstrellas();
  });

  $('formCalificar').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!estrellasElegidas) {
      mostrarToast('Elige de 1 a 5 estrellas.', true);
      return;
    }
    const boton = ev.currentTarget.querySelector('button[type="submit"]');
    boton.disabled = true;
    try {
      const { error } = await db.from('calificaciones').insert({
        orden_id: ordenACalificar,
        cliente_id: usuarioActual.id,
        estrellas: estrellasElegidas,
        comentario: ev.currentTarget.comentario.value.trim() || null
      });
      if (error) throw error;
      cerrarDialogo('dlgCalificar');
      mostrarToast('¡Gracias por tu calificación!');
      await cargarMisCompras(usuarioActual);
    } catch (err) {
      mostrarToast(mensajeDeError(err), true);
    } finally {
      boton.disabled = false;
    }
  });
}
