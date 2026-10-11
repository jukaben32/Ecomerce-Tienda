// admin/categorias.js
// Categorías: listado, crear/editar y descuentos. También expone
// helpers que usan productos e importación.
import { db } from '../supabaseClient.js';
import { escaparHtml, mostrarToast } from '../util.js';
import { $, seguro, numeroOnull, textoOnull, filaMensaje } from './nucleo.js';

let categorias = [];

/** Lista de categorías (las trae de Supabase si todavía no están en memoria). */
export async function listaCategorias(forzar = false) {
  if (!categorias.length || forzar) {
    const { data, error } = await db.from('categorias').select('*').order('nombre');
    if (error) throw error;
    categorias = data ?? [];
  }
  return categorias;
}

/** Aplica o quita un descuento a TODAS las filas de una tabla (productos o categorias). */
export async function descuentoMasivo(tabla, form) {
  const activar = form.activar.value === '1';
  const pct = numeroOnull(form.porcentaje.value);
  if (activar && (pct === null || pct < 0 || pct > 100)) {
    throw new Error('Escribe un porcentaje entre 0 y 100.');
  }
  const accion = activar ? `Aplicar ${pct}% de descuento` : 'Quitar el descuento';
  if (!window.confirm(`¿${accion} a TODOS los registros de ${tabla}?`)) return;
  // PostgREST exige un filtro en los UPDATE; "id >= 0" abarca todas las filas
  const { error } = await db
    .from(tabla)
    .update({ descuento_pct: activar ? pct : null, descuento_activo: activar })
    .gte('id', 0);
  if (error) throw error;
  mostrarToast('Descuento masivo aplicado');
}

function pintar() {
  $('tbodyCategorias').innerHTML = categorias.length
    ? categorias
        .map(
          (c) => `
        <tr>
          <td class="font-medium">${escaparHtml(c.nombre)}</td>
          <td class="text-tinta/60">${escaparHtml(c.slug)}</td>
          <td>${c.activo ? 'Sí' : 'No'}</td>
          <td>${c.descuento_activo ? `${Number(c.descuento_pct ?? 0)}%` : '—'}</td>
          <td class="text-right"><button type="button" data-editar-categoria="${c.id}" class="boton-sec !px-3 !py-1">Editar</button></td>
        </tr>`
        )
        .join('')
    : filaMensaje(5, 'Sin categorías.');
}

export async function cargar() {
  await listaCategorias(true);
  pintar();
}

function limpiarFormulario() {
  const f = $('formCategoria');
  f.reset();
  f.id.value = '';
  $('tituloFormCategoria').textContent = 'Nueva categoría';
}

function editar(id) {
  const c = categorias.find((x) => x.id === id);
  if (!c) return;
  const f = $('formCategoria');
  f.id.value = c.id;
  f.nombre.value = c.nombre;
  f.slug.value = c.slug;
  f.descripcion.value = c.descripcion ?? '';
  f.activo.value = c.activo ? '1' : '0';
  f.descuento_pct.value = c.descuento_pct ?? '';
  f.descuento_activo.value = c.descuento_activo ? '1' : '0';
  $('tituloFormCategoria').textContent = `Editar: ${c.nombre}`;
}

async function guardar(f) {
  const id = f.id.value ? Number(f.id.value) : null;
  const datos = {
    nombre: f.nombre.value.trim(),
    slug: f.slug.value.trim(),
    descripcion: textoOnull(f.descripcion.value),
    activo: f.activo.value === '1',
    descuento_pct: numeroOnull(f.descuento_pct.value),
    descuento_activo: f.descuento_activo.value === '1'
  };
  const { error } = id
    ? await db.from('categorias').update(datos).eq('id', id)
    : await db.from('categorias').insert(datos);
  if (error) throw error;
  mostrarToast(id ? 'Categoría actualizada' : 'Categoría creada');
  limpiarFormulario();
  await cargar();
}

export function montar() {
  $('panel-categorias').innerHTML = `
    <div class="grid gap-6 lg:grid-cols-5">
      <div class="lg:col-span-3">
        <form id="formDescuentoCategorias" class="mb-4 flex flex-wrap items-center gap-2">
          <span class="text-sm text-tinta/60">Descuento a todas las categorías:</span>
          <input name="porcentaje" type="number" min="0" max="100" step="0.01" placeholder="% desc." class="campo !mt-0 w-24" aria-label="Porcentaje de descuento">
          <select name="activar" class="campo !mt-0 w-32" aria-label="Acción"><option value="1">Activar</option><option value="0">Quitar</option></select>
          <button type="submit" class="boton-sec">Aplicar</button>
        </form>
        <div class="overflow-x-auto rounded-2xl border border-tinta/15 bg-white/50">
          <table class="tabla w-full">
            <thead><tr><th>Nombre</th><th>Slug</th><th>Activa</th><th>Desc.</th><th></th></tr></thead>
            <tbody id="tbodyCategorias"></tbody>
          </table>
        </div>
      </div>
      <form id="formCategoria" class="space-y-3 rounded-2xl border border-tinta/15 bg-white/50 p-5 lg:col-span-2">
        <h2 class="font-display text-xl font-bold" id="tituloFormCategoria">Nueva categoría</h2>
        <input type="hidden" name="id">
        <label class="block text-sm font-medium">Nombre <input name="nombre" required maxlength="100" class="campo"></label>
        <label class="block text-sm font-medium">Slug <input name="slug" required maxlength="100" pattern="[a-z0-9\\-]+" title="Solo minúsculas, números y guiones" class="campo"></label>
        <label class="block text-sm font-medium">Descripción <textarea name="descripcion" rows="2" maxlength="300" class="campo"></textarea></label>
        <div class="grid grid-cols-3 gap-2">
          <label class="block text-sm font-medium">Activa <select name="activo" class="campo"><option value="1">Sí</option><option value="0">No</option></select></label>
          <label class="block text-sm font-medium">Desc. % <input name="descuento_pct" type="number" min="0" max="100" step="0.01" class="campo"></label>
          <label class="block text-sm font-medium">Descuento <select name="descuento_activo" class="campo"><option value="0">Off</option><option value="1">On</option></select></label>
        </div>
        <div class="flex gap-2">
          <button type="submit" class="boton-principal">Guardar</button>
          <button id="btnNuevaCategoria" type="button" class="boton-sec">Limpiar</button>
        </div>
      </form>
    </div>`;

  $('tbodyCategorias').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-editar-categoria]');
    if (b) editar(Number(b.dataset.editarCategoria));
  });
  $('formCategoria').addEventListener('submit', (ev) => {
    ev.preventDefault();
    seguro(() => guardar(ev.currentTarget));
  });
  $('btnNuevaCategoria').addEventListener('click', limpiarFormulario);
  $('formDescuentoCategorias').addEventListener('submit', (ev) => {
    ev.preventDefault();
    seguro(async () => {
      await descuentoMasivo('categorias', ev.currentTarget);
      await cargar();
    });
  });
}
