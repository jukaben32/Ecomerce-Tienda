// promos.js
// Volantes / promociones de la portada y barra de horario de domicilios.
import { db } from './supabaseClient.js';
import { escaparHtml, urlSegura } from './util.js';
import { estaEnHorario, textoHorario } from './configuracion.js';

/** Pinta los volantes activos (los administra el admin en "Promociones"). */
export async function cargarPromociones() {
  const seccion = document.getElementById('seccionPromos');
  const { data, error } = await db
    .from('promociones')
    .select('id, titulo, descripcion, imagen_url, enlace')
    .eq('activo', true)
    .order('orden')
    .order('creado_en', { ascending: false });
  if (error || !data?.length) {
    seccion.classList.add('hidden');
    return;
  }
  document.getElementById('gridPromos').innerHTML = data
    .map((p) => {
      const img = urlSegura(p.imagen_url);
      const enlace = urlSegura(p.enlace) || '#catalogo';
      return `
        <a href="${escaparHtml(enlace)}" class="group block overflow-hidden rounded-2xl border border-tinta/15 bg-crema transition hover:-translate-y-1 hover:shadow-xl">
          ${img ? `<img src="${escaparHtml(img)}" alt="${escaparHtml(p.titulo)}" loading="lazy" class="aspect-[16/10] w-full object-cover transition duration-500 group-hover:scale-105">` : ''}
          <div class="p-4">
            <h3 class="font-display text-xl font-bold">${escaparHtml(p.titulo)}</h3>
            ${p.descripcion ? `<p class="mt-1 text-sm text-tinta/70">${escaparHtml(p.descripcion)}</p>` : ''}
          </div>
        </a>`;
    })
    .join('');
  seccion.classList.remove('hidden');
}

/** Barra superior con el horario; avisa si estamos fuera de horario. */
export function pintarBannerHorario(cfg) {
  const banner = document.getElementById('bannerHorario');
  if (!cfg) return;
  const abierto = estaEnHorario(cfg);
  banner.className =
    'px-4 py-2 text-center text-sm ' + (abierto ? 'bg-salvia text-white' : 'bg-tinta text-papel');
  banner.textContent = abierto
    ? `Domicilios activos · ${textoHorario(cfg)}`
    : `Fuera de horario de domicilios (${textoHorario(cfg)}). Puedes pedir y lo gestionamos en el próximo horario de atención.`;
}

/** Datos de contacto en el pie de página. */
export function pintarDatosTienda(cfg) {
  const el = document.getElementById('datosTienda');
  if (!cfg || !el) return;
  el.textContent = [cfg.direccion, cfg.telefono].filter(Boolean).join(' · ');
}
