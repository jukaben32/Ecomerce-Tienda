// direcciones.js
// Libreta de direcciones del cliente (pestaña "Direcciones" del perfil)
// y funciones para que el checkout pueda leerlas y guardarlas.
import { db } from './supabaseClient.js';
import { escaparHtml, mostrarToast, mensajeDeError } from './util.js';

/** Lista las direcciones del cliente (la principal primero). */
export async function listarDirecciones(clienteId) {
  const { data, error } = await db
    .from('direcciones')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('es_principal', { ascending: false })
    .order('creado_en', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Texto de una sola línea para guardar en la orden. */
export function direccionEnTexto(d) {
  return [d.direccion, d.barrio, d.ciudad].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
}

/** Crea o actualiza una dirección. Si es principal, quita la marca a las demás primero. */
export async function guardarDireccion(clienteId, datos, id = null) {
  if (datos.es_principal) {
    // El índice único solo permite una principal: primero desmarcamos las demás
    const { error: e1 } = await db.from('direcciones').update({ es_principal: false }).eq('cliente_id', clienteId);
    if (e1) throw e1;
  }
  const fila = { ...datos, cliente_id: clienteId };
  const { data, error } = id
    ? await db.from('direcciones').update(fila).eq('id', id).select().single()
    : await db.from('direcciones').insert(fila).select().single();
  if (error) throw error;
  return data;
}

export async function borrarDireccion(id) {
  const { error } = await db.from('direcciones').delete().eq('id', id);
  if (error) throw error;
}

/** Lee el formulario de dirección y devuelve el objeto listo para guardar. */
export function leerFormularioDireccion(f) {
  return {
    etiqueta: f.etiqueta.value.trim() || 'Casa',
    direccion: f.direccion.value.trim(),
    barrio: f.barrio.value.trim() || null,
    ciudad: f.ciudad.value.trim(),
    referencias: f.referencias.value.trim() || null,
    telefono: f.telefono.value.trim() || null,
    es_principal: f.es_principal ? f.es_principal.checked : false
  };
}

// ---------------------------------------------------------------
// Pestaña "Direcciones" del perfil
// ---------------------------------------------------------------
let direccionesPerfil = [];

function pintarLibreta(contenedor) {
  contenedor.innerHTML = direccionesPerfil.length
    ? direccionesPerfil
        .map(
          (d) => `
        <article class="rounded-2xl border border-tinta/15 bg-white/50 p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h3 class="font-display text-lg font-bold">${escaparHtml(d.etiqueta)}
                ${d.es_principal ? '<span class="ml-1 rounded-full bg-salvia px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider text-white">Principal</span>' : ''}</h3>
              <p class="text-sm">${escaparHtml(direccionEnTexto(d))}</p>
              ${d.referencias ? `<p class="text-xs text-tinta/60">${escaparHtml(d.referencias)}</p>` : ''}
              ${d.telefono ? `<p class="text-xs text-tinta/60">Tel. ${escaparHtml(d.telefono)}</p>` : ''}
            </div>
            <div class="flex shrink-0 flex-col items-end gap-1 text-sm">
              <button type="button" data-dir-editar="${d.id}" class="underline underline-offset-4 hover:text-arcilla">Editar</button>
              ${d.es_principal ? '' : `<button type="button" data-dir-principal="${d.id}" class="underline underline-offset-4 hover:text-arcilla">Hacer principal</button>`}
              <button type="button" data-dir-borrar="${d.id}" class="text-tinta/60 underline underline-offset-4 hover:text-arcilla">Eliminar</button>
            </div>
          </div>
        </article>`
        )
        .join('')
    : '<p class="text-tinta/60">Aún no tienes direcciones guardadas.</p>';
}

/** Carga y muestra la libreta. Se llama al abrir el perfil. */
export async function cargarLibreta(clienteId) {
  const lista = document.getElementById('listaDirecciones');
  lista.innerHTML = '<p class="text-tinta/60">Cargando…</p>';
  try {
    direccionesPerfil = await listarDirecciones(clienteId);
    pintarLibreta(lista);
  } catch (err) {
    lista.innerHTML = `<p class="text-arcilla">${escaparHtml(mensajeDeError(err))}</p>`;
  }
}

function limpiarFormulario() {
  const f = document.getElementById('formDireccion');
  f.reset();
  f.dir_id.value = '';
  document.getElementById('tituloFormDireccion').textContent = 'Nueva dirección';
}

/** Conecta los eventos de la pestaña. `obtenerClienteId` devuelve el id del usuario con sesión. */
export function conectarLibreta(obtenerClienteId) {
  const lista = document.getElementById('listaDirecciones');
  const form = document.getElementById('formDireccion');

  lista.addEventListener('click', async (ev) => {
    const editar = ev.target.closest('[data-dir-editar]');
    const principal = ev.target.closest('[data-dir-principal]');
    const borrar = ev.target.closest('[data-dir-borrar]');
    const cliente = obtenerClienteId();
    try {
      if (editar) {
        const d = direccionesPerfil.find((x) => x.id === Number(editar.dataset.dirEditar));
        if (!d) return;
        form.dir_id.value = d.id;
        form.etiqueta.value = d.etiqueta;
        form.direccion.value = d.direccion;
        form.barrio.value = d.barrio ?? '';
        form.ciudad.value = d.ciudad;
        form.referencias.value = d.referencias ?? '';
        form.telefono.value = d.telefono ?? '';
        form.es_principal.checked = d.es_principal;
        document.getElementById('tituloFormDireccion').textContent = 'Editar dirección';
        form.direccion.focus();
      } else if (principal) {
        const d = direccionesPerfil.find((x) => x.id === Number(principal.dataset.dirPrincipal));
        // Solo mandamos el campo que cambia (el id es autogenerado y no se reenvía)
        await guardarDireccion(cliente, { es_principal: true }, d.id);
        await cargarLibreta(cliente);
      } else if (borrar) {
        if (!window.confirm('¿Eliminar esta dirección?')) return;
        await borrarDireccion(Number(borrar.dataset.dirBorrar));
        await cargarLibreta(cliente);
      }
    } catch (err) {
      mostrarToast(mensajeDeError(err), true);
    }
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const boton = form.querySelector('button[type="submit"]');
    boton.disabled = true;
    try {
      const cliente = obtenerClienteId();
      const id = form.dir_id.value ? Number(form.dir_id.value) : null;
      await guardarDireccion(cliente, leerFormularioDireccion(form), id);
      limpiarFormulario();
      mostrarToast('Dirección guardada');
      await cargarLibreta(cliente);
    } catch (err) {
      mostrarToast(mensajeDeError(err), true);
    } finally {
      boton.disabled = false;
    }
  });

  document.getElementById('btnLimpiarDireccion').addEventListener('click', limpiarFormulario);
}
