// admin/selectorMedios.js
// Ventana para ELEGIR una imagen de la biblioteca de medios (bucket
// "medios" de Supabase Storage). La usan productos y promociones.
import { db } from '../supabaseClient.js';
import { escaparHtml } from '../util.js';
import { $ } from './nucleo.js';

const BUCKET = 'medios';

/** Lista los archivos de la biblioteca (más nuevos primero) con su URL pública. */
export async function listarMedios() {
  const { data, error } = await db.storage
    .from(BUCKET)
    .list('', { limit: 200, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) throw error;
  return (data ?? [])
    .filter((f) => f.name && f.id) // ignora carpetas y marcadores
    // El nombre empieza con la hora de subida (Date.now), así que ordenar
    // por nombre descendente deja los más nuevos primero de forma estable.
    .sort((a, b) => b.name.localeCompare(a.name))
    .map((f) => ({
      nombre: f.name,
      tamano: f.metadata?.size ?? 0,
      url: db.storage.from(BUCKET).getPublicUrl(f.name).data.publicUrl
    }));
}

/** Sube un archivo con nombre seguro y único. Devuelve la URL pública. */
export async function subirMedio(archivo) {
  const limpio = archivo.name.toLowerCase().replace(/[^a-z0-9.\-_]+/g, '-').replace(/-+/g, '-').slice(-80);
  const ruta = `${Date.now()}-${limpio}`;
  const { error } = await db.storage.from(BUCKET).upload(ruta, archivo, {
    cacheControl: '31536000',
    upsert: false,
    contentType: archivo.type
  });
  if (error) throw error;
  return db.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;
}

export async function borrarMedio(nombre) {
  const { error } = await db.storage.from(BUCKET).remove([nombre]);
  if (error) throw error;
}

/**
 * Abre el selector y devuelve una promesa con la URL elegida
 * (o null si la persona cierra la ventana sin elegir).
 */
export function elegirMedio() {
  const dlg = $('dlgMedios');
  const grid = $('gridSelectorMedios');
  return new Promise((resolver) => {
    let elegido = null;
    const alElegir = (ev) => {
      const b = ev.target.closest('[data-url]');
      if (!b) return;
      elegido = b.dataset.url;
      dlg.close();
    };
    grid.addEventListener('click', alElegir);
    dlg.addEventListener(
      'close',
      () => {
        grid.removeEventListener('click', alElegir);
        resolver(elegido);
      },
      { once: true }
    );

    grid.innerHTML = '<p class="col-span-full text-tinta/60">Cargando…</p>';
    dlg.showModal();
    listarMedios()
      .then((medios) => {
        grid.innerHTML = medios.length
          ? medios
              .map(
                (m) => `
              <button type="button" data-url="${escaparHtml(m.url)}" class="overflow-hidden rounded-xl border border-tinta/15 transition hover:border-arcilla focus-visible:outline focus-visible:outline-2 focus-visible:outline-arcilla" title="${escaparHtml(m.nombre)}">
                <img src="${escaparHtml(m.url)}" alt="${escaparHtml(m.nombre)}" loading="lazy" class="aspect-square w-full object-cover">
              </button>`
              )
              .join('')
          : '<p class="col-span-full text-tinta/60">No hay imágenes. Súbelas en la pestaña "Medios".</p>';
      })
      .catch((err) => {
        grid.innerHTML = `<p class="col-span-full text-arcilla">${escaparHtml(err.message)}</p>`;
      });
  });
}
