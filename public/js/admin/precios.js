// admin/precios.js
// Asistente de precios con IA. Escribes lo que quieres ("sube 10% los
// pantalones"), la IA lo convierte en una REGLA y el servidor calcula la
// vista previa. Nada cambia hasta que confirmas, y cada cambio queda en un
// historial que se puede deshacer.
import { db } from '../supabaseClient.js';
import { formatearPrecio, formatearFecha, escaparHtml, mostrarToast } from '../util.js';
import { invocarFuncion } from '../api.js';
import { $, seguro, filaMensaje } from './nucleo.js';

const EJEMPLOS = [
  'Sube 10% los pantalones',
  'Pon 15% de descuento en accesorios',
  'Baja 5% toda la categoría Mujer y redondea a 50',
  'Deja la gorra en 750 pesos',
  'Quita todos los descuentos'
];

let vistaPrevia = null; // { instruccion, resumen, cambios: [...] }
let seleccion = new Set(); // producto_id marcados para aplicar

const textoVariacion = (antes, despues) => {
  if (!antes) return '';
  const pct = ((despues - antes) / antes) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
};

function pintarVistaPrevia() {
  const zona = $('vistaPreviaPrecios');
  if (!vistaPrevia) {
    zona.innerHTML = '';
    return;
  }
  const { resumen, cambios } = vistaPrevia;
  zona.innerHTML = `
    <section class="rounded-2xl border border-tinta/15 bg-white/50 p-5">
      <p class="font-medium">${escaparHtml(resumen || 'Cambios propuestos')}</p>
      <p class="mt-1 text-xs text-tinta/60">Revisa y desmarca lo que no quieras cambiar. Los precios se calculan en el servidor, no por la IA.</p>
      <div class="mt-4 overflow-x-auto rounded-xl border border-tinta/15">
        <table class="tabla w-full">
          <thead><tr><th class="w-8"><input id="marcarTodosPrecios" type="checkbox" checked aria-label="Marcar todos" class="accent-arcilla"></th>
            <th>Producto</th><th class="text-right">Antes</th><th class="text-right">Después</th><th class="text-right">Cambio</th><th>Descuento</th></tr></thead>
          <tbody>
            ${cambios
              .map(
                (c) => `
              <tr>
                <td><input type="checkbox" data-fila-precio="${c.producto_id}" ${seleccion.has(c.producto_id) ? 'checked' : ''} aria-label="Aplicar a ${escaparHtml(c.nombre)}" class="accent-arcilla"></td>
                <td class="font-medium">${escaparHtml(c.nombre)}<div class="text-xs font-normal text-tinta/60">${escaparHtml(c.sku)}${c.categoria ? ` · ${escaparHtml(c.categoria)}` : ''}</div></td>
                <td class="text-right">${formatearPrecio(c.precio_actual)}</td>
                <td class="text-right font-bold ${c.precio_nuevo !== c.precio_actual ? 'text-arcilla' : ''}">${formatearPrecio(c.precio_nuevo)}</td>
                <td class="text-right text-xs">${c.precio_nuevo !== c.precio_actual ? textoVariacion(c.precio_actual, c.precio_nuevo) : '—'}</td>
                <td class="text-xs">${c.descuento_actual === null && c.descuento_nuevo === null ? '—' : `${c.descuento_actual !== null ? `${Number(c.descuento_actual)}%` : 'sin desc.'} → <strong>${c.descuento_nuevo !== null ? `${Number(c.descuento_nuevo)}%` : 'sin desc.'}</strong>`}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <button id="btnAplicarPrecios" type="button" class="boton-principal"></button>
        <button id="btnCancelarPrecios" type="button" class="boton-sec">Cancelar</button>
        ${vistaPrevia.sinCambio ? `<span class="text-xs text-tinta/60">${vistaPrevia.sinCambio} producto(s) ya estaban así y no aparecen.</span>` : ''}
      </div>
    </section>`;
  actualizarBotonAplicar();
}

function actualizarBotonAplicar() {
  const boton = $('btnAplicarPrecios');
  if (!boton) return;
  boton.textContent = `Aplicar ${seleccion.size} cambio${seleccion.size === 1 ? '' : 's'}`;
  boton.disabled = seleccion.size === 0;
}

async function pedirVistaPrevia(instruccion) {
  $('mensajePrecios').textContent = '';
  vistaPrevia = null;
  pintarVistaPrevia();
  const r = await invocarFuncion('ajustar-precios', { instruccion });
  if (r.mensaje) {
    $('mensajePrecios').textContent = r.mensaje;
    return;
  }
  vistaPrevia = { instruccion, resumen: r.resumen, cambios: r.cambios, sinCambio: r.sin_cambio };
  seleccion = new Set(r.cambios.map((c) => c.producto_id));
  pintarVistaPrevia();
}

async function aplicar() {
  const elegidos = vistaPrevia.cambios.filter((c) => seleccion.has(c.producto_id));
  if (!window.confirm(`¿Aplicar ${elegidos.length} cambio(s) de precio? Podrás deshacerlo después.`)) return;
  const { data, error } = await db.rpc('aplicar_cambios_precios', {
    p_instruccion: vistaPrevia.instruccion,
    p_cambios: elegidos.map((c) => ({
      producto_id: c.producto_id,
      precio_nuevo: c.precio_nuevo,
      descuento_pct: c.descuento_pct_nuevo,
      descuento_activo: c.descuento_activo_nuevo
    }))
  });
  if (error) throw error;
  mostrarToast(`${data.cambios} producto(s) actualizados`);
  vistaPrevia = null;
  pintarVistaPrevia();
  $('instruccionPrecios').value = '';
  await cargar();
}

export async function cargar() {
  const tbody = $('tbodyLotes');
  tbody.innerHTML = filaMensaje(4, 'Cargando…');
  const { data, error } = await db.from('lotes_precios').select('*').order('creado_en', { ascending: false }).limit(15);
  if (error) throw error;
  tbody.innerHTML = data.length
    ? data
        .map(
          (l) => `
        <tr>
          <td class="whitespace-nowrap">${escaparHtml(formatearFecha(l.creado_en))}</td>
          <td>${escaparHtml(l.instruccion)}</td>
          <td class="text-right">${l.cambios}</td>
          <td class="whitespace-nowrap text-right">${l.revertido_en
            ? `<span class="text-xs text-tinta/50">Deshecho ${escaparHtml(formatearFecha(l.revertido_en))}</span>`
            : `<button type="button" data-deshacer="${escaparHtml(l.id)}" class="boton-sec !px-3 !py-1">Deshacer</button>`}</td>
        </tr>`
        )
        .join('')
    : filaMensaje(4, 'Todavía no has cambiado precios con el asistente.');
}

async function deshacer(id) {
  if (!window.confirm('¿Deshacer este cambio de precios? Los productos que hayas editado después no se tocan.')) return;
  const { data, error } = await db.rpc('revertir_lote_precios', { p_lote: id });
  if (error) throw error;
  mostrarToast(`Revertidos ${data.revertidos}${data.omitidos ? ` · ${data.omitidos} omitidos (ya editados)` : ''}`);
  await cargar();
}

export function montar() {
  $('panel-precios').innerHTML = `
    <section class="rounded-2xl border border-tinta/15 bg-white/50 p-5">
      <h2 class="font-display text-xl font-bold">Asistente de precios <span class="ml-1 rounded-full bg-arcilla px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider text-white">IA</span></h2>
      <p class="mt-1 text-sm text-tinta/60">Dime qué quieres cambiar. Verás una vista previa y nada se modifica hasta que confirmes.</p>
      <form id="formPrecios" class="mt-3 flex flex-wrap gap-2">
        <input id="instruccionPrecios" required maxlength="500" placeholder="Ej: sube 10% los pantalones" class="campo !mt-0 min-w-[16rem] flex-1" aria-label="Instrucción de precios">
        <button type="submit" class="boton-principal">Ver cambios</button>
      </form>
      <div class="mt-3 flex flex-wrap gap-2">
        ${EJEMPLOS.map((e) => `<button type="button" data-ejemplo="${escaparHtml(e)}" class="pildora border-tinta/30 hover:border-tinta">${escaparHtml(e)}</button>`).join('')}
      </div>
      <p id="mensajePrecios" class="mt-3 text-sm text-arcilla" aria-live="polite"></p>
    </section>

    <div id="vistaPreviaPrecios" class="mt-6"></div>

    <h2 class="mb-3 mt-8 font-display text-xl font-bold">Historial de cambios</h2>
    <div class="overflow-x-auto rounded-2xl border border-tinta/15 bg-white/50">
      <table class="tabla w-full">
        <thead><tr><th>Fecha</th><th>Instrucción</th><th class="text-right">Productos</th><th></th></tr></thead>
        <tbody id="tbodyLotes"></tbody>
      </table>
    </div>`;

  const enviar = (texto) => {
    const boton = $('formPrecios').querySelector('button[type="submit"]');
    boton.disabled = true;
    boton.textContent = 'Pensando…';
    seguro(() => pedirVistaPrevia(texto)).finally(() => {
      boton.disabled = false;
      boton.textContent = 'Ver cambios';
    });
  };

  $('formPrecios').addEventListener('submit', (ev) => {
    ev.preventDefault();
    enviar($('instruccionPrecios').value.trim());
  });
  document.querySelector('#panel-precios').addEventListener('click', (ev) => {
    const ejemplo = ev.target.closest('[data-ejemplo]');
    if (ejemplo) {
      $('instruccionPrecios').value = ejemplo.dataset.ejemplo;
      $('instruccionPrecios').focus();
    }
    if (ev.target.closest('#btnCancelarPrecios')) {
      vistaPrevia = null;
      pintarVistaPrevia();
    }
    if (ev.target.closest('#btnAplicarPrecios')) seguro(aplicar);
    const d = ev.target.closest('[data-deshacer]');
    if (d) seguro(() => deshacer(d.dataset.deshacer));
  });
  $('vistaPreviaPrecios').addEventListener('change', (ev) => {
    const fila = ev.target.closest('[data-fila-precio]');
    if (fila) {
      const id = Number(fila.dataset.filaPrecio);
      seleccion = fila.checked ? new Set([...seleccion, id]) : new Set([...seleccion].filter((x) => x !== id));
      actualizarBotonAplicar();
    }
    if (ev.target.id === 'marcarTodosPrecios') {
      seleccion = ev.target.checked ? new Set(vistaPrevia.cambios.map((c) => c.producto_id)) : new Set();
      pintarVistaPrevia();
    }
  });
}
