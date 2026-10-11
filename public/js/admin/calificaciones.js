// admin/calificaciones.js
// Calificaciones que dejan los clientes sobre sus pedidos entregados.
import { db } from '../supabaseClient.js';
import { formatearFecha, escaparHtml } from '../util.js';
import { $, filaMensaje } from './nucleo.js';

export async function cargar() {
  const tbody = $('tbodyCalificaciones');
  tbody.innerHTML = filaMensaje(5, 'Cargando…');
  const { data, error } = await db
    .from('calificaciones')
    .select('id, orden_id, estrellas, comentario, creado_en, perfiles(nombre, apellido)')
    .order('creado_en', { ascending: false })
    .limit(200);
  if (error) throw error;

  const promedio = data.length ? (data.reduce((s, c) => s + c.estrellas, 0) / data.length).toFixed(2) : null;
  $('promedioCalificaciones').textContent = promedio ? `${promedio} ★ (${data.length} calificaciones)` : 'Sin calificaciones todavía';

  tbody.innerHTML = data.length
    ? data
        .map(
          (c) => `
        <tr>
          <td class="whitespace-nowrap">${escaparHtml(formatearFecha(c.creado_en))}</td>
          <td>#${c.orden_id}</td>
          <td>${escaparHtml([c.perfiles?.nombre, c.perfiles?.apellido].filter(Boolean).join(' ') || '—')}</td>
          <td class="whitespace-nowrap text-arcilla" aria-label="${c.estrellas} de 5">${'★'.repeat(c.estrellas)}${'☆'.repeat(5 - c.estrellas)}</td>
          <td>${escaparHtml(c.comentario || '')}</td>
        </tr>`
        )
        .join('')
    : filaMensaje(5, 'Aún no hay calificaciones.');
}

export function montar() {
  $('panel-calificaciones').innerHTML = `
    <p id="promedioCalificaciones" class="mb-4 font-display text-2xl font-bold"></p>
    <div class="overflow-x-auto rounded-2xl border border-tinta/15 bg-white/50">
      <table class="tabla w-full">
        <thead><tr><th>Fecha</th><th>Pedido</th><th>Cliente</th><th>Calificación</th><th>Comentario</th></tr></thead>
        <tbody id="tbodyCalificaciones"></tbody>
      </table>
    </div>`;
}
