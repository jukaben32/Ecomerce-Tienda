// admin/productos.js
// Productos: listado, crear/editar, desactivar, descuento masivo e
// importación masiva desde Excel (.xlsx) o CSV con vista previa.
import { db } from '../supabaseClient.js';
import {
  formatearPrecio, escaparHtml, mostrarToast, abrirDialogo, cerrarDialogo, urlSegura
} from '../util.js';
import { $, seguro, numeroOnull, textoOnull, filaMensaje } from './nucleo.js';
import { elegirMedio } from './selectorMedios.js';
import { descuentoMasivo, listaCategorias } from './categorias.js';
import { prepararImportacion, confirmarImportacion, plantillaCsv } from './importar.js';

let productos = [];

export async function cargar() {
  const tbody = $('tbodyProductos');
  tbody.innerHTML = filaMensaje(6, 'Cargando…');
  const { data, error } = await db.from('productos').select('*').order('nombre');
  if (error) throw error;
  productos = data ?? [];
  await rellenarCategorias();
  pintar();
}

async function rellenarCategorias() {
  const categorias = await listaCategorias();
  $('selCategoria').innerHTML =
    '<option value="">(Sin categoría)</option>' +
    categorias.map((c) => `<option value="${c.id}">${escaparHtml(c.nombre)}</option>`).join('');
}

function pintar() {
  const q = $('busquedaProductos').value.trim().toLowerCase();
  const lista = q ? productos.filter((p) => `${p.nombre} ${p.sku}`.toLowerCase().includes(q)) : productos;
  $('tbodyProductos').innerHTML = lista.length
    ? lista
        .map(
          (p) => `
        <tr>
          <td class="text-tinta/60">${escaparHtml(p.sku)}</td>
          <td class="font-medium">${escaparHtml(p.nombre)}</td>
          <td class="text-right">${formatearPrecio(p.precio)}${p.descuento_activo ? `<div class="text-xs text-arcilla">-${Number(p.descuento_pct ?? 0)}%</div>` : ''}</td>
          <td class="text-right ${p.existencias <= 3 ? 'font-bold text-arcilla' : ''}">${p.existencias}</td>
          <td>${p.activo ? 'Sí' : '<span class="text-tinta/50">No</span>'}</td>
          <td class="whitespace-nowrap text-right">
            <button type="button" data-editar-producto="${p.id}" class="boton-sec !px-3 !py-1">Editar</button>
            ${p.activo ? `<button type="button" data-desactivar="${p.id}" class="ml-1 text-sm text-tinta/60 underline-offset-4 hover:text-arcilla hover:underline">Desactivar</button>` : ''}
          </td>
        </tr>`
        )
        .join('')
    : filaMensaje(6, 'Sin productos.');
}

function abrirFormulario(producto) {
  const f = $('formProducto');
  f.reset();
  $('tituloProducto').textContent = producto ? 'Editar producto' : 'Nuevo producto';
  f.id.value = producto?.id ?? '';
  if (producto) {
    f.sku.value = producto.sku;
    f.nombre.value = producto.nombre;
    f.descripcion.value = producto.descripcion ?? '';
    f.categoria_id.value = producto.categoria_id ?? '';
    f.precio.value = producto.precio;
    f.existencias.value = producto.existencias;
    f.activo.value = producto.activo ? '1' : '0';
    f.descuento_pct.value = producto.descuento_pct ?? '';
    f.descuento_activo.value = producto.descuento_activo ? '1' : '0';
    f.imagen_url.value = producto.imagen_url ?? '';
  }
  actualizarVistaImagen();
  abrirDialogo('dlgProducto');
}

function actualizarVistaImagen() {
  const url = urlSegura($('formProducto').imagen_url.value);
  $('vistaImagenProducto').innerHTML = url
    ? `<img src="${escaparHtml(url)}" alt="Vista previa" class="h-24 w-20 rounded-xl object-cover">`
    : '';
}

async function guardar(f) {
  const id = f.id.value ? Number(f.id.value) : null;
  const datos = {
    sku: f.sku.value.trim(),
    nombre: f.nombre.value.trim(),
    descripcion: textoOnull(f.descripcion.value),
    categoria_id: f.categoria_id.value ? Number(f.categoria_id.value) : null,
    precio: Number(f.precio.value),
    existencias: Number(f.existencias.value),
    activo: f.activo.value === '1',
    descuento_pct: numeroOnull(f.descuento_pct.value),
    descuento_activo: f.descuento_activo.value === '1',
    imagen_url: textoOnull(f.imagen_url.value)
  };
  const { error } = id
    ? await db.from('productos').update(datos).eq('id', id)
    : await db.from('productos').insert(datos);
  if (error) throw error;
  mostrarToast(id ? 'Producto actualizado' : 'Producto creado');
  cerrarDialogo('dlgProducto');
  await cargar();
}

async function desactivar(id) {
  if (!window.confirm('¿Desactivar este producto? Dejará de verse en la tienda.')) return;
  const { error } = await db.from('productos').update({ activo: false }).eq('id', id);
  if (error) throw error;
  mostrarToast('Producto desactivado');
  await cargar();
}

/** Resumen de la vista previa de importación. */
function pintarVistaPrevia(r) {
  $('resumenImportacion').innerHTML = `
    <p class="text-sm"><strong>${r.validas.length}</strong> productos listos
      (<strong>${r.nuevos}</strong> nuevos, <strong>${r.actualizan}</strong> actualizan un SKU existente).</p>
    ${r.errores.length ? `<div class="mt-3 max-h-40 overflow-y-auto rounded-xl bg-arcilla/10 p-3 text-sm text-arcilla">
      <p class="font-bold">${r.errores.length} filas con problemas (no se importarán):</p>
      <ul class="mt-1 list-disc pl-5">${r.errores.slice(0, 50).map((e) => `<li>${escaparHtml(e)}</li>`).join('')}</ul></div>` : ''}
    ${r.avisos.length ? `<p class="mt-3 text-xs text-tinta/60">${r.avisos.map(escaparHtml).join(' · ')}</p>` : ''}`;
  $('btnConfirmarImportacion').disabled = r.validas.length === 0;
}

export function montar() {
  $('panel-productos').innerHTML = `
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap gap-2">
        <button id="btnNuevoProducto" type="button" class="boton-principal">+ Nuevo producto</button>
        <button id="btnImportar" type="button" class="boton-sec">Importar Excel / CSV</button>
        <button id="btnPlantilla" type="button" class="boton-sec">Descargar plantilla</button>
        <input id="archivoImportar" type="file" accept=".xlsx,.xls,.csv" class="hidden">
      </div>
      <input id="busquedaProductos" type="search" placeholder="Buscar nombre o SKU…" class="campo !mt-0 w-56" aria-label="Buscar productos">
    </div>
    <form id="formDescuentoProductos" class="mb-4 flex flex-wrap items-center gap-2">
      <span class="text-sm text-tinta/60">Descuento a todos los productos:</span>
      <input name="porcentaje" type="number" min="0" max="100" step="0.01" placeholder="% desc." class="campo !mt-0 w-24" aria-label="Porcentaje de descuento">
      <select name="activar" class="campo !mt-0 w-32" aria-label="Acción"><option value="1">Activar</option><option value="0">Quitar</option></select>
      <button type="submit" class="boton-sec">Aplicar</button>
    </form>
    <div class="overflow-x-auto rounded-2xl border border-tinta/15 bg-white/50">
      <table class="tabla w-full">
        <thead><tr><th>SKU</th><th>Nombre</th><th class="text-right">Precio</th><th class="text-right">Stock</th><th>Activo</th><th></th></tr></thead>
        <tbody id="tbodyProductos"></tbody>
      </table>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="dlgProducto" class="m-auto w-[min(94vw,40rem)] rounded-3xl bg-papel p-0 text-tinta shadow-2xl">
      <form id="formProducto" class="space-y-4 p-6">
        <div class="flex items-center justify-between">
          <h2 id="tituloProducto" class="font-display text-2xl font-bold">Nuevo producto</h2>
          <button type="button" data-cerrar class="rounded-full px-3 py-1 text-sm hover:bg-crema" aria-label="Cerrar">✕</button>
        </div>
        <input type="hidden" name="id">
        <div class="grid gap-3 sm:grid-cols-3">
          <label class="block text-sm font-medium">SKU <input name="sku" required maxlength="64" class="campo"></label>
          <label class="block text-sm font-medium sm:col-span-2">Nombre <input name="nombre" required maxlength="200" class="campo"></label>
        </div>
        <label class="block text-sm font-medium">Descripción <textarea name="descripcion" rows="2" maxlength="600" class="campo"></textarea></label>
        <div class="grid gap-3 sm:grid-cols-3">
          <label class="block text-sm font-medium">Categoría <select name="categoria_id" id="selCategoria" class="campo"></select></label>
          <label class="block text-sm font-medium">Precio (RD$) <input name="precio" type="number" min="0" step="1" required class="campo"></label>
          <label class="block text-sm font-medium">Existencias <input name="existencias" type="number" min="0" step="1" required value="0" class="campo"></label>
        </div>
        <div class="grid gap-3 sm:grid-cols-3">
          <label class="block text-sm font-medium">Activo <select name="activo" class="campo"><option value="1">Sí</option><option value="0">No</option></select></label>
          <label class="block text-sm font-medium">Descuento % <input name="descuento_pct" type="number" min="0" max="100" step="0.01" class="campo"></label>
          <label class="block text-sm font-medium">Descuento <select name="descuento_activo" class="campo"><option value="0">Off</option><option value="1">On</option></select></label>
        </div>
        <div>
          <label class="block text-sm font-medium">Imagen (URL)
            <input name="imagen_url" type="url" placeholder="https://…" class="campo"></label>
          <div class="mt-2 flex items-center gap-3">
            <button id="btnElegirImagen" type="button" class="boton-sec !px-3 !py-1.5">Elegir de Medios</button>
            <div id="vistaImagenProducto"></div>
          </div>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" data-cerrar class="boton-sec">Cancelar</button>
          <button type="submit" class="boton-principal">Guardar producto</button>
        </div>
      </form>
    </dialog>

    <dialog id="dlgImportar" class="m-auto w-[min(94vw,34rem)] rounded-3xl bg-papel p-0 text-tinta shadow-2xl">
      <div class="space-y-4 p-6">
        <div class="flex items-center justify-between">
          <h2 class="font-display text-2xl font-bold">Importar productos</h2>
          <button type="button" data-cerrar class="rounded-full px-3 py-1 text-sm hover:bg-crema" aria-label="Cerrar">✕</button>
        </div>
        <p class="text-xs text-tinta/60">Columnas: <strong>sku, nombre, precio</strong> (obligatorias) y opcionales: descripcion, existencias, categoria (nombre o slug), activo (si/no), imagen_url. Si el SKU ya existe, se actualiza.</p>
        <div id="resumenImportacion"></div>
        <div class="flex justify-end gap-2">
          <button type="button" data-cerrar class="boton-sec">Cancelar</button>
          <button id="btnConfirmarImportacion" type="button" class="boton-principal">Importar</button>
        </div>
      </div>
    </dialog>`);

  let importacion = null;
  const f = $('formProducto');

  $('btnNuevoProducto').addEventListener('click', () => abrirFormulario(null));
  $('busquedaProductos').addEventListener('input', pintar);
  $('tbodyProductos').addEventListener('click', (ev) => {
    const e = ev.target.closest('[data-editar-producto]');
    const d = ev.target.closest('[data-desactivar]');
    if (e) abrirFormulario(productos.find((p) => p.id === Number(e.dataset.editarProducto)));
    if (d) seguro(() => desactivar(Number(d.dataset.desactivar)));
  });
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    seguro(() => guardar(f));
  });
  f.imagen_url.addEventListener('input', actualizarVistaImagen);
  $('btnElegirImagen').addEventListener('click', async () => {
    const url = await elegirMedio();
    if (url) {
      f.imagen_url.value = url;
      actualizarVistaImagen();
    }
  });
  $('formDescuentoProductos').addEventListener('submit', (ev) => {
    ev.preventDefault();
    seguro(async () => {
      await descuentoMasivo('productos', ev.currentTarget);
      await cargar();
    });
  });

  // Importación
  $('btnPlantilla').addEventListener('click', plantillaCsv);
  $('btnImportar').addEventListener('click', () => $('archivoImportar').click());
  $('archivoImportar').addEventListener('change', (ev) => {
    const archivo = ev.target.files[0];
    ev.target.value = '';
    if (!archivo) return;
    seguro(async () => {
      importacion = await prepararImportacion(archivo, productos);
      pintarVistaPrevia(importacion);
      abrirDialogo('dlgImportar');
    });
  });
  $('btnConfirmarImportacion').addEventListener('click', () => {
    const boton = $('btnConfirmarImportacion');
    boton.disabled = true;
    seguro(async () => {
      await confirmarImportacion(importacion.validas);
      mostrarToast(`${importacion.validas.length} productos importados`);
      cerrarDialogo('dlgImportar');
      await cargar();
    }).finally(() => {
      boton.disabled = false;
    });
  });
}
