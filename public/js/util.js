// util.js
// Funciones pequeñas que se repiten en la tienda y en el admin.
import { MONEDA, LOCALE } from './config.js';

/** Convierte 89900 en "$ 89.900" según la moneda de config.js. */
export function formatearPrecio(valor) {
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: MONEDA,
      maximumFractionDigits: 0
    }).format(Number(valor) || 0);
  } catch {
    return `$${valor}`;
  }
}

/** Formatea una fecha ISO de Supabase a la fecha local legible. */
export function formatearFecha(iso) {
  const fecha = iso ? new Date(iso) : null;
  return fecha && !Number.isNaN(fecha.getTime()) ? fecha.toLocaleString(LOCALE) : '';
}

/**
 * Escapa HTML para evitar XSS. SIEMPRE úsala antes de meter texto que venga
 * de la base de datos dentro de un innerHTML.
 */
export function escaparHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Solo deja pasar URLs http(s). Evita que una URL maliciosa tipo
 * "javascript:..." se cuele en un atributo src.
 */
export function urlSegura(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
}

/** Imagen del producto, o un bloque de color con la inicial si no tiene. */
export function htmlImagenProducto(producto, clases = '') {
  const src = urlSegura(producto.imagen_url);
  if (src) {
    return `<img src="${escaparHtml(src)}" alt="${escaparHtml(producto.nombre)}" loading="lazy" class="${clases} object-cover">`;
  }
  const inicial = escaparHtml((producto.nombre || '?').trim().charAt(0).toUpperCase());
  return `<div class="${clases} grid place-items-center bg-crema font-display text-6xl italic text-arcilla/70" aria-hidden="true">${inicial}</div>`;
}

/** Aviso flotante (toast) simple. Se crea una sola vez y se reutiliza. */
let toastEl;
let toastTimer;
export function mostrarToast(mensaje, esError = false) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  toastEl.className =
    'fixed bottom-5 left-1/2 z-[100] max-w-[90vw] -translate-x-1/2 rounded-full px-5 py-3 text-sm font-medium shadow-xl transition ' +
    (esError ? 'bg-arcilla text-white' : 'bg-tinta text-papel');
  toastEl.textContent = mensaje;
  toastEl.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.style.opacity = '0';
  }, 3000);
}

/** Abre / cierra un <dialog> (modal o panel lateral). */
export function abrirDialogo(id) {
  const d = document.getElementById(id);
  if (d && !d.open) d.showModal();
}
export function cerrarDialogo(id) {
  document.getElementById(id)?.close();
}

/**
 * Hace que cualquier <dialog> se cierre al hacer clic en el fondo oscuro
 * o en un botón con [data-cerrar].
 */
export function activarCierreDeDialogos() {
  document.querySelectorAll('dialog').forEach((d) => {
    d.addEventListener('click', (ev) => {
      if (ev.target === d || ev.target.closest('[data-cerrar]')) d.close();
    });
  });
}

/** Muestra el aviso "falta configurar Supabase" si config.js sigue con los valores de ejemplo. */
export function mostrarAvisoConfiguracion(configurado) {
  if (configurado) return;
  const aviso = document.createElement('div');
  aviso.className = 'bg-arcilla px-4 py-2 text-center text-sm text-white';
  aviso.textContent =
    'Falta conectar Supabase: edita public/js/config.js con tu URL y tu anon key.';
  document.body.prepend(aviso);
}

/** Traduce los errores más comunes de Supabase a mensajes claros. */
export function mensajeDeError(error, porDefecto = 'Ocurrió un error. Intenta de nuevo.') {
  const msg = String(error?.message || '');
  if (/Invalid login credentials/i.test(msg)) return 'Correo o contraseña incorrectos.';
  if (/already registered|already been registered/i.test(msg)) return 'Ese correo ya está registrado.';
  if (/Email not confirmed/i.test(msg)) return 'Confirma tu correo antes de entrar (revisa tu bandeja).';
  if (/duplicate key.*sku/i.test(msg)) return 'Ya existe un producto con ese SKU.';
  if (/duplicate key.*slug/i.test(msg)) return 'Ya existe una categoría con ese slug.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Sin conexión con el servidor.';
  // Los mensajes de nuestras funciones SQL (raise exception) ya vienen en español
  return msg || porDefecto;
}
