// admin/ordenes.js
// Órdenes: filtros por estado, búsqueda por cliente, cambio de estado,
// detalle (dirección, pago, notas) e impresión de ticket.
import { db } from '../supabaseClient.js';
import { formatearPrecio, formatearFecha, escaparHtml, mostrarToast } from '../util.js';
import { cargarConfiguracion, ETIQUETAS_PAGO } from '../configuracion.js';
import { $, seguro, filaMensaje } from './nucleo.js';

const ESTADOS = ['pendiente', 'pagada', 'enviada', 'entregada', 'cancelada', 'reembolsada'];
const CERRADOS = ['cancelada', 'reembolsada'];
// Cada filtro de la pantalla equivale a uno o varios estados reales
const FILTROS_ESTADO = {
  pendiente: ['pendiente'],
  procesando: ['pagada', 'enviada'],
  terminada: ['entregada'],
  todas: null
};

let filtroEstado = 'pendiente';
let ordenes = [];

function pintarFiltros() {
  $('filtrosEstado').querySelectorAll('[data-estado]').forEach((b) => {
    const activo = b.dataset.estado === filtroEstado;
    b.className = `pildora ${activo ? 'border-tinta bg-tinta text-papel' : 'border-tinta/30 hover:border-tinta'}`;
  });
}

export async function cargar() {
  const tbody = $('tbodyOrdenes');
  tbody.innerHTML = filaMensaje(6, 'Cargando…');
  let consulta = db
    .from('ordenes')
    .select(`id, estado, total, subtotal, costo_envio, metodo_pago, canal, direccion_entrega, telefono_contacto, notas,
             fuera_de_horario, realizada_en,
             perfiles(nombre, apellido, correo),
             items_orden(sku, nombre_producto, precio_unitario, cantidad, total_renglon)`)
    .order('realizada_en', { ascending: false })
    .limit(300);
  const estados = FILTROS_ESTADO[filtroEstado];
  if (estados) consulta = consulta.in('estado', estados);
  const { data, error } = await consulta;
  if (error) throw error;
  ordenes = data ?? [];
  pintar();
}

function pintar() {
  const tbody = $('tbodyOrdenes');
  const q = $('busquedaOrdenes').value.trim().toLowerCase();
  const lista = q
    ? ordenes.filter((o) => [o.perfiles?.nombre, o.perfiles?.apellido, o.perfiles?.correo].filter(Boolean).join(' ').toLowerCase().includes(q))
    : ordenes;

  if (!lista.length) {
    tbody.innerHTML = filaMensaje(6, 'No hay órdenes.');
    return;
  }
  tbody.innerHTML = lista
    .map((o) => {
      const cliente = [o.perfiles?.nombre, o.perfiles?.apellido].filter(Boolean).join(' ') || '(sin nombre)';
      const cerrada = CERRADOS.includes(o.estado);
      const items = (o.items_orden ?? [])
        .map((it) => `<li class="flex justify-between gap-4"><span>${it.cantidad} × ${escaparHtml(it.nombre_producto)} <span class="text-tinta/50">(${escaparHtml(it.sku)})</span></span><span>${formatearPrecio(it.total_renglon)}</span></li>`)
        .join('');
      return `
        <tr>
          <td class="font-medium">${o.id}${o.canal !== 'web' ? `<div class="text-[10px] uppercase text-tinta/50">${escaparHtml(o.canal)}</div>` : ''}</td>
          <td>${escaparHtml(cliente)}<div class="text-xs text-tinta/60">${escaparHtml(o.perfiles?.correo || '')}</div></td>
          <td>
            <select data-estado-orden="${o.id}" ${cerrada ? 'disabled' : ''} class="campo !mt-0 !w-auto capitalize" aria-label="Estado de la orden ${o.id}">
              ${ESTADOS.map((e) => `<option value="${e}" ${e === o.estado ? 'selected' : ''}>${e}</option>`).join('')}
            </select>
            ${o.fuera_de_horario && o.estado === 'pendiente' ? '<div class="mt-1 text-[10px] font-bold uppercase text-arcilla">Fuera de horario</div>' : ''}
          </td>
          <td class="whitespace-nowrap">${escaparHtml(formatearFecha(o.realizada_en))}</td>
          <td class="font-medium">${formatearPrecio(o.total)}</td>
          <td class="whitespace-nowrap text-right">
            <button type="button" data-ticket="${o.id}" class="boton-sec !px-3 !py-1">Ticket</button>
            <button type="button" data-detalle="${o.id}" class="boton-sec !px-3 !py-1" aria-expanded="false">Ver</button>
          </td>
        </tr>
        <tr class="hidden" data-fila-detalle="${o.id}">
          <td colspan="6" class="bg-crema/50">
            <ul class="space-y-1 text-sm">${items || '<li>Sin ítems</li>'}</ul>
            <dl class="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div><dt class="inline text-tinta/60">Entrega: </dt><dd class="inline">${escaparHtml(o.direccion_entrega || '—')}</dd></div>
              <div><dt class="inline text-tinta/60">Teléfono: </dt><dd class="inline">${escaparHtml(o.telefono_contacto || '—')}</dd></div>
              <div><dt class="inline text-tinta/60">Pago: </dt><dd class="inline">${escaparHtml(ETIQUETAS_PAGO[o.metodo_pago] ?? '—')}</dd></div>
              <div><dt class="inline text-tinta/60">Envío: </dt><dd class="inline">${formatearPrecio(o.costo_envio)}</dd></div>
              ${o.notas ? `<div class="sm:col-span-2"><dt class="inline text-tinta/60">Notas: </dt><dd class="inline">${escaparHtml(o.notas)}</dd></div>` : ''}
            </dl>
          </td>
        </tr>`;
    })
    .join('');
}

async function cambiarEstado(id, estado) {
  const { error } = await db.from('ordenes').update({ estado }).eq('id', id);
  if (error) throw error;
  mostrarToast(`Orden #${id} → ${estado}`);
  await cargar();
}

/** Imprime el ticket de una orden en un iframe oculto (sin ventanas emergentes). */
async function imprimirTicket(id) {
  const o = ordenes.find((x) => x.id === id);
  if (!o) return;
  const cfg = await cargarConfiguracion();
  const cliente = [o.perfiles?.nombre, o.perfiles?.apellido].filter(Boolean).join(' ');
  const filas = (o.items_orden ?? [])
    .map((it) => `<tr><td>${it.cantidad} × ${escaparHtml(it.nombre_producto)}</td><td style="text-align:right">${formatearPrecio(it.total_renglon)}</td></tr>`)
    .join('');
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ticket #${o.id}</title>
    <style>
      body{font:12px/1.4 "Courier New",monospace;width:72mm;margin:0 auto;padding:4mm;color:#000}
      h1{font-size:15px;text-align:center;margin:0 0 2mm} p{margin:1mm 0} table{width:100%;border-collapse:collapse}
      td{padding:1mm 0;vertical-align:top} hr{border:0;border-top:1px dashed #000;margin:3mm 0} .c{text-align:center}
    </style></head><body>
    <h1>${escaparHtml(cfg.ticket_encabezado)}</h1>
    ${cfg.direccion ? `<p class="c">${escaparHtml(cfg.direccion)}</p>` : ''}${cfg.telefono ? `<p class="c">Tel. ${escaparHtml(cfg.telefono)}</p>` : ''}
    <hr>
    <p>Pedido #${o.id} · ${escaparHtml(formatearFecha(o.realizada_en))}</p>
    <p>Cliente: ${escaparHtml(cliente)}</p>
    <p>Entrega: ${escaparHtml(o.direccion_entrega || '—')}</p>
    <p>Tel: ${escaparHtml(o.telefono_contacto || '—')}</p>
    <p>Pago: ${escaparHtml(ETIQUETAS_PAGO[o.metodo_pago] ?? '—')}</p>
    <hr><table>${filas}
      <tr><td>Subtotal</td><td style="text-align:right">${formatearPrecio(o.subtotal)}</td></tr>
      <tr><td>Envío</td><td style="text-align:right">${formatearPrecio(o.costo_envio)}</td></tr>
      <tr><td><strong>TOTAL</strong></td><td style="text-align:right"><strong>${formatearPrecio(o.total)}</strong></td></tr>
    </table>
    ${o.notas ? `<hr><p>Notas: ${escaparHtml(o.notas)}</p>` : ''}
    <hr><p class="c">${escaparHtml(cfg.ticket_pie)}</p></body></html>`;

  const marco = document.createElement('iframe');
  marco.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden';
  marco.srcdoc = html;
  marco.onload = () => {
    marco.contentWindow.focus();
    marco.contentWindow.print();
    setTimeout(() => marco.remove(), 2000);
  };
  document.body.appendChild(marco);
}

export function montar() {
  $('panel-ordenes').innerHTML = `
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div id="filtrosEstado" class="flex flex-wrap gap-2">
        <button type="button" data-estado="pendiente" class="pildora">Pendientes</button>
        <button type="button" data-estado="procesando" class="pildora">Procesando</button>
        <button type="button" data-estado="terminada" class="pildora">Terminadas</button>
        <button type="button" data-estado="todas" class="pildora">Todas</button>
      </div>
      <div class="flex gap-2">
        <input id="busquedaOrdenes" type="search" placeholder="Buscar cliente…" class="campo !mt-0 w-56" aria-label="Buscar órdenes por cliente">
        <button id="btnRefrescar" type="button" class="boton-sec">Actualizar</button>
      </div>
    </div>
    <div class="overflow-x-auto rounded-2xl border border-tinta/15 bg-white/50">
      <table class="tabla w-full">
        <thead><tr><th>#</th><th>Cliente</th><th>Estado</th><th>Fecha</th><th>Total</th><th></th></tr></thead>
        <tbody id="tbodyOrdenes"></tbody>
      </table>
    </div>`;
  pintarFiltros();

  $('filtrosEstado').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-estado]');
    if (!b) return;
    filtroEstado = b.dataset.estado;
    pintarFiltros();
    seguro(cargar);
  });
  $('busquedaOrdenes').addEventListener('input', pintar);
  $('btnRefrescar').addEventListener('click', () => seguro(cargar));
  $('tbodyOrdenes').addEventListener('click', (ev) => {
    const verDetalle = ev.target.closest('[data-detalle]');
    const ticket = ev.target.closest('[data-ticket]');
    if (verDetalle) {
      const fila = document.querySelector(`[data-fila-detalle="${verDetalle.dataset.detalle}"]`);
      const oculto = fila.classList.toggle('hidden');
      verDetalle.setAttribute('aria-expanded', String(!oculto));
      verDetalle.textContent = oculto ? 'Ver' : 'Ocultar';
    }
    if (ticket) seguro(() => imprimirTicket(Number(ticket.dataset.ticket)));
  });
  $('tbodyOrdenes').addEventListener('change', (ev) => {
    const s = ev.target.closest('[data-estado-orden]');
    if (!s) return;
    if (CERRADOS.includes(s.value) && !window.confirm(`¿Marcar la orden como "${s.value}"? El stock se devolverá y no podrá reactivarse.`)) {
      seguro(cargar);
      return;
    }
    seguro(() => cambiarEstado(Number(s.dataset.estadoOrden), s.value));
  });
}
