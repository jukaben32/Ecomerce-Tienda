// secciones.js
// Secciones informativas de la portada, todas alimentadas con datos reales:
//   categorías · cómo ordenar · calificaciones · medios de pago · cobertura
//   y horario · pie de página · botón de WhatsApp · datos para buscadores.
import { db } from './supabaseClient.js';
import { escaparHtml, urlSegura, formatearPrecio } from './util.js';
import { ETIQUETAS_PAGO, DESCRIPCION_PAGO, ORDEN_MEDIOS, textoHorario } from './configuracion.js';

const $ = (id) => document.getElementById(id);

// Iconos simples (trazo) para las tarjetas de pago
const ICONOS = {
  transferencia: '<path d="M3 21h18M5 21V10m14 11V10M9 21V10m6 11V10M2 10l10-6 10 6H2Z"/>',
  efectivo: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  datafono: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M9 6h6M9 10h.01M12 10h.01M15 10h.01M9 13h.01M12 13h.01M15 13h.01"/>',
  tarjeta: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>'
};
const icono = (clave) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6" aria-hidden="true">${ICONOS[clave] ?? ICONOS.tarjeta}</svg>`;

const COLORES_TILE = ['bg-crema text-tinta', 'bg-arcilla text-white', 'bg-salvia text-white', 'bg-tinta text-papel'];

const digitos = (t) => String(t ?? '').replace(/\D/g, '');
const enlaceWhatsapp = (cfg, mensaje) => {
  const d = digitos(cfg?.whatsapp);
  return d.length >= 8 ? `https://wa.me/${d}?text=${encodeURIComponent(mensaje)}` : '';
};

// ---------------------------------------------------------------
// Categorías (accesos grandes que filtran el catálogo)
// ---------------------------------------------------------------
export function pintarCategorias(categorias, productos) {
  const seccion = $('seccionCategorias');
  if (!categorias.length) {
    seccion.classList.add('hidden');
    return;
  }
  $('gridCategorias').innerHTML = categorias
    .map((c, i) => {
      const n = productos.filter((p) => p.categoria_id === c.id).length;
      return `
        <button type="button" data-ir-categoria="${c.id}" class="group relative flex aspect-[4/3] flex-col justify-between overflow-hidden rounded-2xl p-5 text-left transition duration-300 hover:-translate-y-1 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-arcilla ${COLORES_TILE[i % COLORES_TILE.length]}">
          <span class="text-xs font-bold uppercase tracking-widest opacity-70">${n} ${n === 1 ? 'prenda' : 'prendas'}</span>
          <span class="font-display text-3xl font-bold leading-none sm:text-4xl">${escaparHtml(c.nombre)}</span>
          <span class="absolute right-4 top-4 text-2xl opacity-60 transition group-hover:translate-x-1 group-hover:opacity-100" aria-hidden="true">→</span>
        </button>`;
    })
    .join('');
  seccion.classList.remove('hidden');
}

// ---------------------------------------------------------------
// Cómo prefieres ordenar
// ---------------------------------------------------------------
function pintarOrdenar(cfg) {
  const wa = enlaceWhatsapp(cfg, 'Hola, quiero hacer un pedido.');
  const tarjetaAsistente = `
    <div class="flex flex-col rounded-3xl border border-papel/15 bg-papel/5 p-7">
      <span class="mb-4 w-fit rounded-full bg-arcilla px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white">Disponible siempre</span>
      <h3 class="font-display text-3xl font-bold">Asistente inteligente</h3>
      <p class="mt-3 flex-1 text-papel/75">Dile qué buscas, o súbele la foto de tu lista. Arma tu carrito, consulta precios y stock, y tú solo confirmas.</p>
      <ul class="my-5 space-y-1 text-sm text-papel/70"><li>• Responde al instante, a cualquier hora</li><li>• Lee listas escritas a mano</li><li>• Tú decides antes de pagar</li></ul>
      <button type="button" id="btnOrdenarAsistente" class="w-fit rounded-full bg-arcilla px-6 py-3 font-medium text-white transition hover:brightness-110">Pedir con el asistente →</button>
    </div>`;
  const tarjetaWhatsapp = wa
    ? `
    <div class="flex flex-col rounded-3xl border border-papel/15 bg-papel/5 p-7">
      <span class="mb-4 w-fit rounded-full bg-[#25D366] px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-tinta">Atención personal</span>
      <h3 class="font-display text-3xl font-bold">Pide por WhatsApp</h3>
      <p class="mt-3 flex-1 text-papel/75">¿Prefieres hablar con una persona? Escríbenos, te armamos el pedido y coordinamos la entrega a tu medida.</p>
      <ul class="my-5 space-y-1 text-sm text-papel/70"><li>• Trato humano y personalizado</li><li>• Resolvemos dudas de tallas y colores</li><li>• Coordinamos la entrega contigo</li></ul>
      <a href="${escaparHtml(wa)}" target="_blank" rel="noopener" class="w-fit rounded-full bg-[#25D366] px-6 py-3 font-medium text-tinta transition hover:brightness-110">Escribir por WhatsApp →</a>
    </div>`
    : '';
  $('gridOrdenar').className = `mt-10 grid gap-5 ${tarjetaWhatsapp ? 'md:grid-cols-2' : 'mx-auto max-w-xl'}`;
  $('gridOrdenar').innerHTML = tarjetaAsistente + tarjetaWhatsapp;
}

// ---------------------------------------------------------------
// Calificaciones reales (solo se muestra si ya hay)
// ---------------------------------------------------------------
const estrellas = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

async function pintarCalificaciones() {
  const seccion = $('seccionCalificaciones');
  const { data, error } = await db.rpc('resumen_calificaciones', { p_limite: 6 });
  if (error || !data || !data.total) {
    seccion.classList.add('hidden');
    return null;
  }
  const maximo = Math.max(...Object.values(data.distribucion), 1);
  const barras = [5, 4, 3, 2, 1]
    .map(
      (e) => `
      <div class="flex items-center gap-3 text-sm">
        <span class="w-3 text-tinta/70">${e}</span><span class="text-arcilla" aria-hidden="true">★</span>
        <div class="h-2 flex-1 rounded-full bg-crema"><div class="h-2 rounded-full bg-arcilla" style="width:${(data.distribucion[e] / maximo) * 100}%"></div></div>
        <span class="w-6 text-right text-tinta/60">${data.distribucion[e]}</span>
      </div>`
    )
    .join('');
  const comentarios = data.comentarios
    .map(
      (c) => `
      <figure class="rounded-2xl border border-tinta/15 bg-white/60 p-5">
        <div class="text-arcilla" aria-label="${c.estrellas} de 5 estrellas">${estrellas(c.estrellas)}</div>
        <blockquote class="mt-2 text-sm leading-relaxed">“${escaparHtml(c.comentario)}”</blockquote>
        <figcaption class="mt-3 text-xs font-medium text-tinta/60">${escaparHtml(c.nombre)} · cliente verificado</figcaption>
      </figure>`
    )
    .join('');
  $('contenidoCalificaciones').innerHTML = `
    <div class="grid items-center gap-8 md:grid-cols-[18rem_1fr]">
      <div class="rounded-3xl border border-tinta/15 bg-white/60 p-6 text-center">
        <p class="font-display text-6xl font-bold">${Number(data.promedio).toFixed(1)}</p>
        <p class="mt-1 text-xl text-arcilla" aria-hidden="true">${estrellas(data.promedio)}</p>
        <p class="mt-1 text-xs text-tinta/60">${data.total} ${data.total === 1 ? 'calificación' : 'calificaciones'} de pedidos entregados</p>
        <div class="mt-5 space-y-1.5 text-left">${barras}</div>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">${comentarios || '<p class="text-tinta/60">Aún no hay comentarios escritos.</p>'}</div>
    </div>
    <p class="mt-6 text-center text-xs text-tinta/50">Solo los clientes con pedidos entregados pueden calificar.</p>`;
  seccion.classList.remove('hidden');
  return data;
}

// ---------------------------------------------------------------
// Medios de pago
// ---------------------------------------------------------------
function pintarPagos(cfg) {
  const medios = ORDEN_MEDIOS.filter((m) => cfg.medios_pago.includes(m));
  $('gridPagos').innerHTML = medios
    .map(
      (m) => `
      <div class="rounded-2xl border border-tinta/15 bg-white/60 p-5">
        <div class="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-crema text-tinta">${icono(m)}</div>
        <h3 class="font-display text-lg font-bold">${escaparHtml(ETIQUETAS_PAGO[m])}</h3>
        <p class="mt-1 text-sm text-tinta/70">${escaparHtml(DESCRIPCION_PAGO[m])}</p>
      </div>`
    )
    .join('');
  const extra = [];
  if (cfg.pedido_minimo > 0) extra.push(`Pedido mínimo ${formatearPrecio(cfg.pedido_minimo)}`);
  if (cfg.costo_envio > 0) extra.push(`Envío ${formatearPrecio(cfg.costo_envio)}`);
  if (cfg.envio_gratis_desde !== null) extra.push(`Envío gratis desde ${formatearPrecio(cfg.envio_gratis_desde)}`);
  $('notaPagos').textContent = extra.join(' · ');
}

// ---------------------------------------------------------------
// Cobertura y horario
// ---------------------------------------------------------------
function pintarCobertura(cfg) {
  const filas = [
    ['Horario de domicilios', textoHorario(cfg)],
    ['Zona de cobertura', cfg.cobertura || 'Escríbenos para confirmar si llegamos a tu zona.'],
    ['Dirección', cfg.direccion],
    ['Teléfono', cfg.telefono]
  ].filter(([, valor]) => valor);
  $('contenidoCobertura').innerHTML = filas
    .map(([titulo, valor]) => `<div><dt class="text-xs font-bold uppercase tracking-widest text-tinta/50">${titulo}</dt><dd class="mt-1">${escaparHtml(valor)}</dd></div>`)
    .join('');
}

// ---------------------------------------------------------------
// Pie de página y WhatsApp flotante
// ---------------------------------------------------------------
function pintarPie(cfg) {
  const redes = [['Instagram', cfg.instagram], ['Facebook', cfg.facebook], ['TikTok', cfg.tiktok]]
    .map(([nombre, url]) => [nombre, urlSegura(url)])
    .filter(([, url]) => url);
  $('redesPie').innerHTML = redes
    .map(([nombre, url]) => `<a href="${escaparHtml(url)}" target="_blank" rel="noopener" class="rounded-full border border-tinta/25 px-3 py-1 text-xs font-medium transition hover:bg-tinta hover:text-papel">${nombre}</a>`)
    .join('');
  $('contactoPie').innerHTML = [cfg.direccion, cfg.telefono].filter(Boolean).map((t) => `<span class="block">${escaparHtml(t)}</span>`).join('');

  const wa = enlaceWhatsapp(cfg, 'Hola, tengo una consulta.');
  const boton = $('btnWhatsapp');
  if (wa) {
    boton.href = wa;
    boton.classList.remove('hidden');
  } else {
    boton.classList.add('hidden');
  }
}

// ---------------------------------------------------------------
// Datos estructurados para buscadores (JSON-LD)
// ---------------------------------------------------------------
const DIAS_SCHEMA = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function actualizarDatosEstructurados(cfg, calificaciones) {
  const el = $('jsonld-negocio');
  if (!el) return;
  try {
    const datos = JSON.parse(el.textContent);
    if (cfg.telefono) datos.telephone = cfg.telefono;
    if (cfg.direccion) datos.address = { '@type': 'PostalAddress', streetAddress: cfg.direccion, addressCountry: 'DO' };
    datos.openingHoursSpecification = [{
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: cfg.dias_atencion.map((d) => DIAS_SCHEMA[d]),
      opens: cfg.hora_inicio.slice(0, 5),
      closes: cfg.hora_fin.slice(0, 5)
    }];
    const redes = [cfg.instagram, cfg.facebook, cfg.tiktok].map(urlSegura).filter(Boolean);
    if (redes.length) datos.sameAs = redes;
    if (calificaciones?.total) {
      datos.aggregateRating = { '@type': 'AggregateRating', ratingValue: calificaciones.promedio, reviewCount: calificaciones.total, bestRating: 5, worstRating: 1 };
    }
    el.textContent = JSON.stringify(datos);
  } catch {
    // Si algo falla, queda el bloque básico estático de index.html
  }
}

/**
 * Pinta todas las secciones.
 * @param {{cfg:object, abrirChat:()=>void}} datos
 */
export async function iniciarSecciones({ cfg, abrirChat }) {
  if (!cfg) return;
  pintarOrdenar(cfg);
  $('btnOrdenarAsistente')?.addEventListener('click', abrirChat);
  pintarPagos(cfg);
  pintarCobertura(cfg);
  pintarPie(cfg);
  const calificaciones = await pintarCalificaciones().catch(() => null);
  actualizarDatosEstructurados(cfg, calificaciones);
}
