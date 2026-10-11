// admin/dashboard.js
// Panel de resumen: ventas, pedidos, ticket promedio, ventas por día,
// por medio de pago, estados y productos más vendidos.
// Los números los calcula la función SQL resumen_ventas (solo admin).
import { db } from '../supabaseClient.js';
import { formatearPrecio, escaparHtml } from '../util.js';
import { ETIQUETAS_PAGO } from '../configuracion.js';
import { $, seguro, fechaISO } from './nucleo.js';

const RANGOS = [
  { id: 'hoy', texto: 'Hoy', dias: 0 },
  { id: '7', texto: '7 días', dias: 6 },
  { id: '30', texto: '30 días', dias: 29 }
];

function tarjetaKpi(titulo, valor, nota = '') {
  return `
    <div class="rounded-2xl border border-tinta/15 bg-white/50 p-5">
      <p class="text-xs font-bold uppercase tracking-widest text-tinta/60">${escaparHtml(titulo)}</p>
      <p class="mt-2 font-display text-3xl font-bold">${valor}</p>
      ${nota ? `<p class="mt-1 text-xs text-tinta/60">${nota}</p>` : ''}
    </div>`;
}

/** Barras verticales con CSS puro (sin librerías). */
function graficoDias(filas) {
  if (!filas.length) return '<p class="text-sm text-tinta/60">Sin ventas en este rango.</p>';
  const max = Math.max(...filas.map((f) => Number(f.ventas)), 1);
  const paso = Math.ceil(filas.length / 12); // no saturar las etiquetas
  return `
    <div class="flex h-48 items-end gap-1" role="img" aria-label="Ventas por día">
      ${filas
        .map((f) => {
          const alto = Math.max((Number(f.ventas) / max) * 100, 2);
          const [, mes, dia] = String(f.dia).split('-');
          return `<div class="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title="${escaparHtml(`${dia}/${mes}: ${formatearPrecio(f.ventas)} (${f.pedidos} pedidos)`)}">
            <div class="w-full max-w-12 rounded-t bg-arcilla transition hover:brightness-110" style="height:${alto}%"></div>
          </div>`;
        })
        .join('')}
    </div>
    <div class="mt-1 flex gap-1 text-[10px] text-tinta/60">
      ${filas
        .map((f, i) => {
          const [, mes, dia] = String(f.dia).split('-');
          return `<span class="min-w-0 flex-1 truncate text-center">${i % paso === 0 ? `${dia}/${mes}` : ''}</span>`;
        })
        .join('')}
    </div>`;
}

/** Lista con barra horizontal proporcional. */
function listaBarras(filas, etiqueta, valor, formato) {
  if (!filas.length) return '<p class="text-sm text-tinta/60">Sin datos.</p>';
  const max = Math.max(...filas.map((f) => Number(valor(f))), 1);
  return `<ul class="space-y-3">${filas
    .map(
      (f) => `
      <li>
        <div class="flex justify-between gap-3 text-sm"><span class="truncate capitalize">${escaparHtml(etiqueta(f))}</span><span class="shrink-0 font-medium">${formato(f)}</span></div>
        <div class="mt-1 h-2 rounded-full bg-crema"><div class="h-2 rounded-full bg-tinta" style="width:${(Number(valor(f)) / max) * 100}%"></div></div>
      </li>`
    )
    .join('')}</ul>`;
}

function pintar(r) {
  $('kpisDashboard').innerHTML = [
    tarjetaKpi('Ventas', formatearPrecio(r.ventas), 'Sin contar canceladas ni reembolsadas'),
    tarjetaKpi('Pedidos', r.pedidos),
    tarjetaKpi('Ticket promedio', formatearPrecio(r.ticket_promedio)),
    tarjetaKpi('Pendientes', r.pendientes, 'Por gestionar'),
    tarjetaKpi('Calificación', r.calificacion_promedio ? `${r.calificacion_promedio} ★` : '—', 'Promedio de clientes')
  ].join('');
  $('graficoDias').innerHTML = graficoDias(r.por_dia);
  $('graficoMetodos').innerHTML = listaBarras(r.por_metodo, (f) => ETIQUETAS_PAGO[f.metodo] ?? f.metodo, (f) => f.ventas, (f) => formatearPrecio(f.ventas));
  $('graficoEstados').innerHTML = listaBarras(r.por_estado, (f) => f.estado, (f) => f.cantidad, (f) => f.cantidad);
  $('graficoTop').innerHTML = listaBarras(r.top_productos, (f) => f.nombre, (f) => f.unidades, (f) => `${f.unidades} u. · ${formatearPrecio(f.ventas)}`);
}

export async function cargar() {
  const { data, error } = await db.rpc('resumen_ventas', {
    p_desde: $('dashDesde').value,
    p_hasta: $('dashHasta').value
  });
  if (error) throw error;
  pintar(data);
}

export function montar() {
  const seccion = $('panel-dashboard');
  seccion.innerHTML = `
    <div class="mb-5 flex flex-wrap items-end gap-3">
      <div class="flex gap-2" id="rangosDashboard">
        ${RANGOS.map((r) => `<button type="button" data-rango="${r.id}" class="boton-sec">${r.texto}</button>`).join('')}
      </div>
      <label class="text-xs font-medium">Desde <input id="dashDesde" type="date" class="campo !mt-0"></label>
      <label class="text-xs font-medium">Hasta <input id="dashHasta" type="date" class="campo !mt-0"></label>
      <button id="btnDashboard" type="button" class="boton-principal">Ver</button>
    </div>
    <div id="kpisDashboard" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"></div>
    <div class="mt-6 grid gap-6 lg:grid-cols-3">
      <section class="rounded-2xl border border-tinta/15 bg-white/50 p-5 lg:col-span-2">
        <h3 class="mb-4 font-display text-xl font-bold">Ventas por día</h3>
        <div id="graficoDias"></div>
      </section>
      <section class="rounded-2xl border border-tinta/15 bg-white/50 p-5">
        <h3 class="mb-4 font-display text-xl font-bold">Medios de pago</h3>
        <div id="graficoMetodos"></div>
      </section>
      <section class="rounded-2xl border border-tinta/15 bg-white/50 p-5 lg:col-span-2">
        <h3 class="mb-4 font-display text-xl font-bold">Más vendidos</h3>
        <div id="graficoTop"></div>
      </section>
      <section class="rounded-2xl border border-tinta/15 bg-white/50 p-5">
        <h3 class="mb-4 font-display text-xl font-bold">Estados</h3>
        <div id="graficoEstados"></div>
      </section>
    </div>`;

  $('dashDesde').value = fechaISO(-29);
  $('dashHasta').value = fechaISO(0);

  $('rangosDashboard').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-rango]');
    if (!b) return;
    const rango = RANGOS.find((r) => r.id === b.dataset.rango);
    $('dashDesde').value = fechaISO(-rango.dias);
    $('dashHasta').value = fechaISO(0);
    seguro(cargar);
  });
  $('btnDashboard').addEventListener('click', () => seguro(cargar));
}
