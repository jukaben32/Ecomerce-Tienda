// admin/promociones.js
// Volantes / promociones que se muestran en la portada de la tienda.
import { db } from '../supabaseClient.js';
import { escaparHtml, mostrarToast, urlSegura } from '../util.js';
import { $, seguro, textoOnull, filaMensaje } from './nucleo.js';
import { elegirMedio } from './selectorMedios.js';

let promociones = [];

export async function cargar() {
  $('tbodyPromos').innerHTML = filaMensaje(5, 'Cargando…');
  const { data, error } = await db.from('promociones').select('*').order('orden').order('creado_en', { ascending: false });
  if (error) throw error;
  promociones = data ?? [];
  pintar();
}

function pintar() {
  $('tbodyPromos').innerHTML = promociones.length
    ? promociones
        .map((p) => {
          const img = urlSegura(p.imagen_url);
          return `
          <tr>
            <td>${img ? `<img src="${escaparHtml(img)}" alt="" class="h-12 w-20 rounded-lg object-cover">` : ''}</td>
            <td class="font-medium">${escaparHtml(p.titulo)}</td>
            <td>${p.orden}</td>
            <td>
              <button type="button" data-alternar="${p.id}" class="pildora ${p.activo ? 'border-salvia bg-salvia text-white' : 'border-tinta/30'}" aria-pressed="${p.activo}">${p.activo ? 'Activa' : 'Oculta'}</button>
            </td>
            <td class="whitespace-nowrap text-right">
              <button type="button" data-editar-promo="${p.id}" class="boton-sec !px-3 !py-1">Editar</button>
              <button type="button" data-borrar-promo="${p.id}" class="ml-1 text-sm text-tinta/60 underline-offset-4 hover:text-arcilla hover:underline">Eliminar</button>
            </td>
          </tr>`;
        })
        .join('')
    : filaMensaje(5, 'No hay promociones. Crea la primera.');
}

function limpiar() {
  const f = $('formPromo');
  f.reset();
  f.id.value = '';
  $('tituloPromo').textContent = 'Nueva promoción';
  vistaPrevia();
}

function vistaPrevia() {
  const url = urlSegura($('formPromo').imagen_url.value);
  $('vistaPromo').innerHTML = url ? `<img src="${escaparHtml(url)}" alt="Vista previa" class="mt-2 h-24 rounded-xl object-cover">` : '';
}

async function guardar(f) {
  const id = f.id.value ? Number(f.id.value) : null;
  const imagen = urlSegura(f.imagen_url.value);
  if (!imagen) throw new Error('Elige o pega una imagen válida (https://…).');
  const enlace = textoOnull(f.enlace.value);
  if (enlace && !urlSegura(enlace) && !enlace.startsWith('#')) throw new Error('El enlace debe empezar con https:// o #.');
  const datos = {
    titulo: f.titulo.value.trim(),
    descripcion: textoOnull(f.descripcion.value),
    imagen_url: imagen,
    enlace,
    activo: f.activo.value === '1',
    orden: Number(f.orden.value) || 0
  };
  const { error } = id
    ? await db.from('promociones').update(datos).eq('id', id)
    : await db.from('promociones').insert(datos);
  if (error) throw error;
  mostrarToast(id ? 'Promoción actualizada' : 'Promoción creada');
  limpiar();
  await cargar();
}

export function montar() {
  $('panel-promociones').innerHTML = `
    <div class="grid gap-6 lg:grid-cols-5">
      <div class="overflow-x-auto rounded-2xl border border-tinta/15 bg-white/50 lg:col-span-3">
        <table class="tabla w-full">
          <thead><tr><th></th><th>Título</th><th>Orden</th><th>Estado</th><th></th></tr></thead>
          <tbody id="tbodyPromos"></tbody>
        </table>
      </div>
      <form id="formPromo" class="space-y-3 rounded-2xl border border-tinta/15 bg-white/50 p-5 lg:col-span-2">
        <h2 id="tituloPromo" class="font-display text-xl font-bold">Nueva promoción</h2>
        <input type="hidden" name="id">
        <label class="block text-sm font-medium">Título <input name="titulo" required maxlength="120" class="campo"></label>
        <label class="block text-sm font-medium">Descripción <textarea name="descripcion" rows="2" maxlength="300" class="campo"></textarea></label>
        <label class="block text-sm font-medium">Imagen (URL) <input name="imagen_url" type="url" required placeholder="https://…" class="campo"></label>
        <button id="btnElegirPromo" type="button" class="boton-sec !px-3 !py-1.5">Elegir de Medios</button>
        <div id="vistaPromo"></div>
        <label class="block text-sm font-medium">Enlace (opcional) <input name="enlace" maxlength="300" placeholder="https://… o #catalogo" class="campo"></label>
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-sm font-medium">Estado <select name="activo" class="campo"><option value="1">Activa</option><option value="0">Oculta</option></select></label>
          <label class="block text-sm font-medium">Orden <input name="orden" type="number" value="0" class="campo"></label>
        </div>
        <div class="flex gap-2">
          <button type="submit" class="boton-principal">Guardar</button>
          <button id="btnLimpiarPromo" type="button" class="boton-sec">Limpiar</button>
        </div>
      </form>
    </div>`;

  const f = $('formPromo');
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    seguro(() => guardar(f));
  });
  f.imagen_url.addEventListener('input', vistaPrevia);
  $('btnLimpiarPromo').addEventListener('click', limpiar);
  $('btnElegirPromo').addEventListener('click', async () => {
    const url = await elegirMedio();
    if (url) {
      f.imagen_url.value = url;
      vistaPrevia();
    }
  });
  $('tbodyPromos').addEventListener('click', (ev) => {
    const editar = ev.target.closest('[data-editar-promo]');
    const borrar = ev.target.closest('[data-borrar-promo]');
    const alternar = ev.target.closest('[data-alternar]');
    if (editar) {
      const p = promociones.find((x) => x.id === Number(editar.dataset.editarPromo));
      f.id.value = p.id;
      f.titulo.value = p.titulo;
      f.descripcion.value = p.descripcion ?? '';
      f.imagen_url.value = p.imagen_url;
      f.enlace.value = p.enlace ?? '';
      f.activo.value = p.activo ? '1' : '0';
      f.orden.value = p.orden;
      $('tituloPromo').textContent = 'Editar promoción';
      vistaPrevia();
    }
    if (borrar) {
      seguro(async () => {
        if (!window.confirm('¿Eliminar esta promoción?')) return;
        const { error } = await db.from('promociones').delete().eq('id', Number(borrar.dataset.borrarPromo));
        if (error) throw error;
        await cargar();
      });
    }
    if (alternar) {
      const p = promociones.find((x) => x.id === Number(alternar.dataset.alternar));
      seguro(async () => {
        const { error } = await db.from('promociones').update({ activo: !p.activo }).eq('id', p.id);
        if (error) throw error;
        await cargar();
      });
    }
  });
}
