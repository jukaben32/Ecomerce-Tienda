// admin/ia.js
// Asistente IA: base de conocimiento (contexto extra para el chat) e
// incidencias (preguntas que el asistente no supo responder).
// El chat en sí se conecta en la siguiente fase; estas tablas ya
// quedan listas para que el admin las gestione.
import { db } from '../supabaseClient.js';
import { formatearFecha, escaparHtml, mostrarToast } from '../util.js';
import { $, seguro, filaMensaje } from './nucleo.js';

let incidencias = [];
let conocimiento = [];

export async function cargar() {
  const [inc, con] = await Promise.all([
    db.from('incidencias_ia').select('*').order('creado_en', { ascending: false }).limit(200),
    db.from('conocimiento_ia').select('*').order('creado_en', { ascending: false })
  ]);
  if (inc.error) throw inc.error;
  if (con.error) throw con.error;
  incidencias = inc.data ?? [];
  conocimiento = con.data ?? [];
  pintar();
}

function pintar() {
  $('tbodyIncidencias').innerHTML = incidencias.length
    ? incidencias
        .map(
          (i) => `
        <tr>
          <td class="whitespace-nowrap">${escaparHtml(formatearFecha(i.creado_en))}</td>
          <td>${escaparHtml(i.pregunta)}</td>
          <td>${i.estado === 'resuelta'
              ? `<span class="text-salvia">Resuelta</span><div class="text-xs text-tinta/60">${escaparHtml(i.resolucion || '')}</div>`
              : `<button type="button" data-resolver="${i.id}" class="boton-sec !px-3 !py-1">Dar contexto</button>`}</td>
        </tr>`
        )
        .join('')
    : filaMensaje(3, 'Sin incidencias. Aquí verás lo que el asistente no pudo responder.');

  $('listaConocimiento').innerHTML = conocimiento.length
    ? conocimiento
        .map(
          (c) => `
        <li class="rounded-xl border border-tinta/15 bg-white/50 p-3 text-sm">
          <div class="flex items-start justify-between gap-3">
            <div><strong>${escaparHtml(c.titulo)}</strong><p class="mt-1 whitespace-pre-line text-tinta/70">${escaparHtml(c.contenido)}</p></div>
            <button type="button" data-borrar-conocimiento="${c.id}" class="shrink-0 text-xs text-tinta/60 underline hover:text-arcilla">Eliminar</button>
          </div>
        </li>`
        )
        .join('')
    : '<li class="text-sm text-tinta/60">Aún no hay contexto cargado.</li>';
}

async function agregarConocimiento(titulo, contenido) {
  const { error } = await db.from('conocimiento_ia').insert({ titulo, contenido });
  if (error) throw error;
}

export function montar() {
  $('panel-ia').innerHTML = `
    <p class="mb-5 rounded-xl bg-crema px-4 py-3 text-sm">El chat con IA se conecta en la siguiente fase. Desde ya puedes cargar el <strong>contexto</strong> que usará (políticas, tallas, tiempos de entrega…) y revisar las <strong>incidencias</strong> cuando haya conversaciones.</p>
    <div class="grid gap-6 lg:grid-cols-2">
      <section>
        <h2 class="mb-3 font-display text-xl font-bold">Incidencias</h2>
        <div class="overflow-x-auto rounded-2xl border border-tinta/15 bg-white/50">
          <table class="tabla w-full">
            <thead><tr><th>Fecha</th><th>Pregunta sin respuesta</th><th></th></tr></thead>
            <tbody id="tbodyIncidencias"></tbody>
          </table>
        </div>
      </section>
      <section>
        <h2 class="mb-3 font-display text-xl font-bold">Contexto para la IA</h2>
        <form id="formConocimiento" class="mb-4 space-y-3 rounded-2xl border border-tinta/15 bg-white/50 p-4">
          <label class="block text-sm font-medium">Tema <input name="titulo" required maxlength="120" placeholder="Cambios y devoluciones" class="campo"></label>
          <label class="block text-sm font-medium">Qué debe saber la IA <textarea name="contenido" required rows="3" maxlength="2000" class="campo"></textarea></label>
          <button type="submit" class="boton-principal">Agregar contexto</button>
        </form>
        <ul id="listaConocimiento" class="space-y-2"></ul>
      </section>
    </div>`;

  $('formConocimiento').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    seguro(async () => {
      await agregarConocimiento(f.titulo.value.trim(), f.contenido.value.trim());
      f.reset();
      mostrarToast('Contexto agregado');
      await cargar();
    });
  });

  $('listaConocimiento').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-borrar-conocimiento]');
    if (!b) return;
    seguro(async () => {
      if (!window.confirm('¿Eliminar este contexto?')) return;
      const { error } = await db.from('conocimiento_ia').delete().eq('id', Number(b.dataset.borrarConocimiento));
      if (error) throw error;
      await cargar();
    });
  });

  // Resolver incidencia: el admin escribe la respuesta correcta; se guarda
  // como contexto para que la IA no vuelva a fallar con esa pregunta.
  $('tbodyIncidencias').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-resolver]');
    if (!b) return;
    const incidencia = incidencias.find((i) => i.id === Number(b.dataset.resolver));
    seguro(async () => {
      const respuesta = window.prompt(`Pregunta: "${incidencia.pregunta}"\n\nEscribe la respuesta correcta (se guardará como contexto para la IA):`);
      if (!respuesta?.trim()) return;
      await agregarConocimiento(incidencia.pregunta.slice(0, 120), respuesta.trim().slice(0, 2000));
      const { error } = await db
        .from('incidencias_ia')
        .update({ estado: 'resuelta', resolucion: respuesta.trim().slice(0, 500) })
        .eq('id', incidencia.id);
      if (error) throw error;
      mostrarToast('Incidencia resuelta y contexto guardado');
      await cargar();
    });
  });
}
