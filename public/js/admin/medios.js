// admin/medios.js
// Biblioteca de imágenes (Supabase Storage). Se suben aquí y luego se
// eligen desde Productos o Promociones.
import { escaparHtml, mostrarToast } from '../util.js';
import { $, seguro } from './nucleo.js';
import { listarMedios, subirMedio, borrarMedio } from './selectorMedios.js';

const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = 5 * 1024 * 1024;

export async function cargar() {
  const grid = $('gridMedios');
  grid.innerHTML = '<p class="col-span-full text-tinta/60">Cargando…</p>';
  const medios = await listarMedios();
  grid.innerHTML = medios.length
    ? medios
        .map(
          (m) => `
        <figure class="overflow-hidden rounded-2xl border border-tinta/15 bg-white/50">
          <img src="${escaparHtml(m.url)}" alt="${escaparHtml(m.nombre)}" loading="lazy" class="aspect-square w-full object-cover">
          <figcaption class="flex items-center justify-between gap-2 px-3 py-2 text-xs">
            <button type="button" data-copiar="${escaparHtml(m.url)}" class="underline underline-offset-4 hover:text-arcilla">Copiar URL</button>
            <button type="button" data-borrar="${escaparHtml(m.nombre)}" class="text-tinta/60 underline underline-offset-4 hover:text-arcilla">Eliminar</button>
          </figcaption>
        </figure>`
        )
        .join('')
    : '<p class="col-span-full text-tinta/60">Aún no hay imágenes. Sube la primera.</p>';
}

async function subirArchivos(archivos) {
  const validos = [...archivos].filter((a) => {
    if (!TIPOS.includes(a.type)) mostrarToast(`${a.name}: formato no permitido (usa JPG, PNG, WebP o GIF).`, true);
    else if (a.size > MAX_BYTES) mostrarToast(`${a.name}: supera los 5 MB.`, true);
    else return true;
    return false;
  });
  for (const archivo of validos) await subirMedio(archivo);
  if (validos.length) mostrarToast(`${validos.length} imagen(es) subida(s)`);
  await cargar();
}

export function montar() {
  $('panel-medios').innerHTML = `
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-tinta/60">Imágenes JPG, PNG, WebP o GIF de hasta 5 MB.</p>
      <label class="boton-principal cursor-pointer">Subir imágenes
        <input id="archivosMedios" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple class="hidden">
      </label>
    </div>
    <div id="gridMedios" class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"></div>`;

  $('archivosMedios').addEventListener('change', (ev) => {
    const archivos = ev.target.files;
    seguro(() => subirArchivos(archivos)).finally(() => {
      ev.target.value = '';
    });
  });
  $('gridMedios').addEventListener('click', (ev) => {
    const copiar = ev.target.closest('[data-copiar]');
    const borrar = ev.target.closest('[data-borrar]');
    if (copiar) {
      navigator.clipboard?.writeText(copiar.dataset.copiar).then(
        () => mostrarToast('URL copiada'),
        () => mostrarToast('No se pudo copiar. Cópiala manualmente.', true)
      );
    }
    if (borrar) {
      seguro(async () => {
        if (!window.confirm('¿Eliminar esta imagen? Si algún producto la usa, dejará de verse.')) return;
        await borrarMedio(borrar.dataset.borrar);
        mostrarToast('Imagen eliminada');
        await cargar();
      });
    }
  });
}
