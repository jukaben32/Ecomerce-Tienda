// admin/sugerencias.js
// Bandeja de quejas, reclamos y sugerencias que envían los clientes desde la
// portada. El admin las marca como leídas o resueltas.
import { db } from '../supabaseClient.js';
import { formatearFecha, escaparHtml, mostrarToast } from '../util.js';
import { $, seguro, filaMensaje } from './nucleo.js';

const ESTADOS = ['nueva', 'leida', 'resuelta'];
const COLOR_TIPO = {
  queja: 'bg-arcilla/15 text-arcilla',
  reclamo: 'bg-tinta text-papel',
  sugerencia: 'bg-salvia/20 text-salvia'
};
let filtro = 'nueva'; // por defecto, las que faltan por revisar
let filas = [];

function pintarFiltros() {
  $('filtrosSugerencias').querySelectorAll('[data-filtro]').forEach((b) => {
    const activo = b.dataset.filtro === filtro;
    b.className = `pildora ${activo ? 'border-tinta bg-tinta text-papel' : 'border-tinta/30 hover:border-tinta'}`;
  });
}

export async function cargar() {
  $('tbodySugerencias').innerHTML = filaMensaje(5, 'Cargando…');
  let consulta = db
    .from('sugerencias')
    .select('id, tipo, mensaje, contacto, estado, creado_en, perfiles(nombre, apellido, correo, telefono)')
    .order('creado_en', { ascending: false })
    .limit(300);
  if (filtro !== 'todas') consulta = consulta.eq('estado', filtro);
  const { data, error } = await consulta;
  if (error) throw error;
  filas = data ?? [];
  pintar();
}

function pintar() {
  $('tbodySugerencias').innerHTML = filas.length
    ? filas
        .map((s) => {
          const nombre = [s.perfiles?.nombre, s.perfiles?.apellido].filter(Boolean).join(' ') || '(sin nombre)';
          const contacto = [s.contacto, s.perfiles?.telefono, s.perfiles?.correo].filter(Boolean);
          return `
          <tr>
            <td class="whitespace-nowrap">${escaparHtml(formatearFecha(s.creado_en))}</td>
            <td><span class="rounded-full px-2.5 py-1 text-xs font-bold uppercase ${COLOR_TIPO[s.tipo] ?? ''}">${escaparHtml(s.tipo)}</span></td>
            <td class="max-w-md whitespace-pre-line">${escaparHtml(s.mensaje)}</td>
            <td class="text-xs">
              <div class="font-medium">${escaparHtml(nombre)}</div>
              ${[...new Set(contacto)].map((c) => `<div class="text-tinta/60">${escaparHtml(c)}</div>`).join('')}
            </td>
            <td>
              <select data-estado-sug="${s.id}" class="campo !mt-0 !w-auto capitalize" aria-label="Estado del mensaje ${s.id}">
                ${ESTADOS.map((e) => `<option value="${e}" ${e === s.estado ? 'selected' : ''}>${e === 'leida' ? 'leída' : e}</option>`).join('')}
              </select>
            </td>
          </tr>`;
        })
        .join('')
    : filaMensaje(5, filtro === 'nueva' ? 'No hay mensajes nuevos. 🎉' : 'No hay mensajes con este filtro.');
}

async function cambiarEstado(id, estado) {
  const { error } = await db.from('sugerencias').update({ estado }).eq('id', id);
  if (error) throw error;
  mostrarToast(`Mensaje marcado como ${estado === 'leida' ? 'leído' : estado}`);
  await cargar();
}

export function montar() {
  $('panel-sugerencias').innerHTML = `
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div id="filtrosSugerencias" class="flex flex-wrap gap-2">
        <button type="button" data-filtro="nueva" class="pildora">Nuevas</button>
        <button type="button" data-filtro="leida" class="pildora">Leídas</button>
        <button type="button" data-filtro="resuelta" class="pildora">Resueltas</button>
        <button type="button" data-filtro="todas" class="pildora">Todas</button>
      </div>
      <button id="btnRefrescarSug" type="button" class="boton-sec">Actualizar</button>
    </div>
    <div class="overflow-x-auto rounded-2xl border border-tinta/15 bg-white/50">
      <table class="tabla w-full">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Mensaje</th><th>Cliente</th><th>Estado</th></tr></thead>
        <tbody id="tbodySugerencias"></tbody>
      </table>
    </div>`;
  pintarFiltros();

  $('filtrosSugerencias').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-filtro]');
    if (!b) return;
    filtro = b.dataset.filtro;
    pintarFiltros();
    seguro(cargar);
  });
  $('btnRefrescarSug').addEventListener('click', () => seguro(cargar));
  $('tbodySugerencias').addEventListener('change', (ev) => {
    const s = ev.target.closest('[data-estado-sug]');
    if (s) seguro(() => cambiarEstado(Number(s.dataset.estadoSug), s.value));
  });
}
