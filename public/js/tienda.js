// tienda.js
// Lógica de la tienda pública (public/index.html):
//   catálogo -> carrito -> inicio de sesión -> compra -> "Mis compras".
// Todos los datos vienen de Supabase; no hay servidor propio.
import { db } from './supabaseClient.js';
import { SUPABASE_CONFIGURADO } from './config.js';
import {
  formatearPrecio, escaparHtml, htmlImagenProducto,
  mostrarToast, abrirDialogo, cerrarDialogo, activarCierreDeDialogos,
  mostrarAvisoConfiguracion, mensajeDeError
} from './util.js';
import { cargarConfiguracion } from './configuracion.js';
import { abrirCheckout, conectarCheckout } from './checkout.js';
import { cargarMisCompras, conectarCompras } from './compras.js';
import { conectarComprobantes } from './comprobantes.js';
import { cargarLibreta, conectarLibreta } from './direcciones.js';
import { cargarPromociones, pintarBannerHorario, pintarDatosTienda } from './promos.js';
import { conectarChat } from './chat.js';

const CLAVE_CARRITO = 'modanueva_carrito';

// ---- Estado en memoria ----
let productos = [];
let categorias = [];
let categoriaSeleccionada = null; // id de la categoría activa (null = todas)
let carrito = leerCarrito();      // [{ producto_id, cantidad }]
let usuario = null;               // usuario de Supabase Auth
let perfil = null;                // fila de la tabla perfiles
let accionTrasLogin = null;       // qué hacer después de iniciar sesión

// ---------------------------------------------------------------
// Carrito (se guarda en el navegador para que no se pierda al recargar)
// ---------------------------------------------------------------
function leerCarrito() {
  try {
    const crudo = JSON.parse(localStorage.getItem(CLAVE_CARRITO) || '[]');
    if (!Array.isArray(crudo)) return [];
    // Descartamos cualquier cosa rara que alguien haya metido a mano
    return crudo
      .map((it) => ({ producto_id: Number(it?.producto_id), cantidad: Number(it?.cantidad) }))
      .filter((it) => Number.isInteger(it.producto_id) && Number.isInteger(it.cantidad) && it.cantidad > 0);
  } catch {
    return [];
  }
}

function guardarCarrito() {
  try {
    localStorage.setItem(CLAVE_CARRITO, JSON.stringify(carrito));
  } catch {
    // Si el navegador bloquea el almacenamiento, el carrito sigue funcionando en memoria
  }
  pintarCarrito();
}

function productoPorId(id) {
  return productos.find((p) => p.id === id);
}

function precioUnitario(p) {
  return Number(p.precio_final ?? p.precio);
}

function totalCarrito() {
  return carrito.reduce((suma, it) => {
    const p = productoPorId(it.producto_id);
    return suma + (p ? precioUnitario(p) * it.cantidad : 0);
  }, 0);
}

/** Quita del carrito productos que ya no existen y ajusta cantidades al stock. */
function sanearCarrito() {
  carrito = carrito
    .map((it) => {
      const p = productoPorId(it.producto_id);
      return p ? { ...it, cantidad: Math.min(it.cantidad, p.existencias) } : null;
    })
    .filter((it) => it && it.cantidad > 0);
  guardarCarrito();
}

function agregarAlCarrito(productoId) {
  const p = productoPorId(productoId);
  if (!p) return;
  const existente = carrito.find((it) => it.producto_id === productoId);
  const nuevaCantidad = (existente?.cantidad ?? 0) + 1;
  if (nuevaCantidad > p.existencias) {
    mostrarToast('No hay más stock de este producto.', true);
    return;
  }
  // Creamos un carrito nuevo en vez de modificar el anterior (inmutabilidad)
  carrito = existente
    ? carrito.map((it) => (it.producto_id === productoId ? { ...it, cantidad: nuevaCantidad } : it))
    : [...carrito, { producto_id: productoId, cantidad: 1 }];
  guardarCarrito();
  mostrarToast(`${p.nombre} agregado al carrito`);
}

function cambiarCantidad(productoId, delta) {
  const p = productoPorId(productoId);
  if (!p) return;
  carrito = carrito
    .map((it) =>
      it.producto_id === productoId
        ? { ...it, cantidad: Math.min(it.cantidad + delta, p.existencias) }
        : it
    )
    .filter((it) => it.cantidad > 0);
  guardarCarrito();
}

/**
 * Aplica lo que el asistente de IA agregó. Respeta el stock y devuelve cuántos
 * productos distintos se agregaron.
 */
function agregarDesdeChat(acciones) {
  let agregados = 0;
  for (const accion of acciones) {
    const p = productoPorId(Number(accion.producto_id));
    const cantidad = Number(accion.cantidad);
    if (!p || !Number.isInteger(cantidad) || cantidad < 1) continue;
    const actual = carrito.find((it) => it.producto_id === p.id)?.cantidad ?? 0;
    const nueva = Math.min(actual + cantidad, p.existencias);
    if (nueva <= actual) continue;
    carrito = actual
      ? carrito.map((it) => (it.producto_id === p.id ? { ...it, cantidad: nueva } : it))
      : [...carrito, { producto_id: p.id, cantidad: nueva }];
    agregados += 1;
  }
  guardarCarrito();
  return agregados;
}

/** Mensaje al volver de la página de pago de Stripe (?pago=exito|cancelado&orden=N). */
function avisarResultadoDePago() {
  const params = new URLSearchParams(window.location.search);
  const resultado = params.get('pago');
  if (!resultado) return;
  const orden = Number(params.get('orden')) || '';
  if (resultado === 'exito') {
    mostrarToast(`¡Gracias! Estamos confirmando el pago del pedido #${orden}. Se verá como "pagada" en unos segundos.`);
  } else if (resultado === 'cancelado') {
    mostrarToast(`Pago cancelado. Tu pedido #${orden} sigue pendiente; puedes pagarlo desde "Mis compras".`, true);
  }
  window.history.replaceState({}, '', window.location.pathname); // limpia la URL
}

function quitarDelCarrito(productoId) {
  carrito = carrito.filter((it) => it.producto_id !== productoId);
  guardarCarrito();
}

// ---------------------------------------------------------------
// Pintar la interfaz
// ---------------------------------------------------------------
function pintarCarrito() {
  const contenedor = document.getElementById('itemsCarrito');
  const total = document.getElementById('totalCarrito');
  const contador = document.getElementById('contadorCarrito');
  const btnPagar = document.getElementById('btnPagar');

  const visibles = carrito.filter((it) => productoPorId(it.producto_id));
  contador.textContent = String(visibles.reduce((s, it) => s + it.cantidad, 0));
  total.textContent = formatearPrecio(totalCarrito());
  btnPagar.disabled = visibles.length === 0;

  if (!visibles.length) {
    contenedor.innerHTML = '<p class="py-10 text-center text-tinta/60">Tu carrito está vacío.</p>';
    return;
  }

  contenedor.innerHTML = visibles
    .map((it) => {
      const p = productoPorId(it.producto_id);
      const enOferta = Number(p.precio_final) < Number(p.precio);
      return `
        <article class="flex gap-4 py-4">
          ${htmlImagenProducto(p, 'h-24 w-20 shrink-0 rounded-xl')}
          <div class="flex min-w-0 flex-1 flex-col">
            <h3 class="truncate font-display text-lg font-bold">${escaparHtml(p.nombre)}</h3>
            <p class="text-sm ${enOferta ? 'text-arcilla' : 'text-tinta/70'}">${formatearPrecio(precioUnitario(p))}</p>
            <div class="mt-auto flex items-center gap-3">
              <div class="flex items-center rounded-full border border-tinta/25">
                <button type="button" data-accion="menos" data-id="${p.id}" class="px-3 py-1 hover:text-arcilla" aria-label="Quitar una unidad">−</button>
                <span class="min-w-6 text-center text-sm" aria-label="Cantidad">${it.cantidad}</span>
                <button type="button" data-accion="mas" data-id="${p.id}" class="px-3 py-1 hover:text-arcilla" aria-label="Agregar una unidad">+</button>
              </div>
              <button type="button" data-accion="quitar" data-id="${p.id}" class="text-sm text-tinta/60 underline-offset-4 hover:text-arcilla hover:underline">Quitar</button>
            </div>
          </div>
        </article>`;
    })
    .join('');
}

function pintarFiltros() {
  const nav = document.getElementById('filtrosCategoria');
  const boton = (id, etiqueta) => {
    const activo = categoriaSeleccionada === id;
    return `<button type="button" data-categoria="${id ?? ''}" aria-pressed="${activo}"
      class="whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-medium transition ${
        activo ? 'border-tinta bg-tinta text-papel' : 'border-tinta/25 hover:border-tinta'
      }">${escaparHtml(etiqueta)}</button>`;
  };
  nav.innerHTML = boton(null, 'Todo') + categorias.map((c) => boton(c.id, c.nombre)).join('');
}

function tarjetaProducto(p) {
  const enOferta = Number(p.precio_final) < Number(p.precio);
  const agotado = p.existencias <= 0;
  return `
    <article class="group md:even:translate-y-6">
      <div class="relative overflow-hidden rounded-2xl bg-crema">
        ${htmlImagenProducto(p, 'aspect-[4/5] w-full transition duration-500 group-hover:scale-105')}
        ${enOferta ? `<span class="absolute left-3 top-3 rounded-full bg-arcilla px-3 py-1 text-xs font-bold text-white">-${Number(p.descuento_aplicado_pct)}%</span>` : ''}
        ${agotado ? '<span class="absolute inset-0 grid place-items-center bg-papel/70 font-display text-xl italic">Agotado</span>' : ''}
      </div>
      <div class="mt-3 flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="font-display text-lg font-bold leading-tight">${escaparHtml(p.nombre)}</h3>
          <p class="mt-0.5 line-clamp-2 text-sm text-tinta/60">${escaparHtml(p.descripcion || '')}</p>
        </div>
        <p class="shrink-0 text-right text-sm">
          ${enOferta ? `<span class="block text-tinta/50 line-through">${formatearPrecio(p.precio)}</span>` : ''}
          <span class="font-bold ${enOferta ? 'text-arcilla' : ''}">${formatearPrecio(precioUnitario(p))}</span>
        </p>
      </div>
      <button type="button" data-agregar="${p.id}" ${agotado ? 'disabled' : ''}
        class="mt-3 w-full rounded-full border border-tinta py-2 text-sm font-medium transition hover:bg-tinta hover:text-papel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-arcilla disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-tinta">
        ${agotado ? 'No disponible' : 'Agregar al carrito'}
      </button>
    </article>`;
}

function pintarProductos() {
  const grid = document.getElementById('gridProductos');
  const q = document.getElementById('busqueda').value.trim().toLowerCase();
  const porCategoria = categoriaSeleccionada
    ? productos.filter((p) => p.categoria_id === categoriaSeleccionada)
    : productos;
  const lista = q
    ? porCategoria.filter((p) => [p.nombre, p.descripcion, p.sku].filter(Boolean).join(' ').toLowerCase().includes(q))
    : porCategoria;

  grid.innerHTML = lista.length
    ? lista.map(tarjetaProducto).join('')
    : '<p class="col-span-full py-10 text-center text-tinta/60">No encontramos productos con ese filtro.</p>';
}

// ---------------------------------------------------------------
// Carga de datos desde Supabase
// ---------------------------------------------------------------
async function cargarCategorias() {
  const { data, error } = await db.from('categorias').select('id, nombre, slug').eq('activo', true).order('nombre');
  if (error) throw error;
  categorias = data ?? [];
  pintarFiltros();
}

/**
 * Carga el catálogo COMPLETO una vez. El filtro por categoría se hace en el
 * navegador; así el carrito (y el chat) siempre encuentran cualquier producto.
 */
async function cargarProductos() {
  const { data, error } = await db.from('productos_publicos').select('*').eq('activo', true).order('nombre');
  if (error) throw error;
  productos = data ?? [];
  pintarProductos();
  pintarCarrito();
}

// ---------------------------------------------------------------
// Sesión y perfil
// ---------------------------------------------------------------
async function cargarPerfil() {
  if (!usuario) {
    perfil = null;
    return;
  }
  const { data } = await db.from('perfiles').select('*').eq('id', usuario.id).maybeSingle();
  perfil = data;
}

function pintarCabeceraSesion() {
  const btnEntrar = document.getElementById('btnEntrar');
  const menu = document.getElementById('menuUsuario');
  const logueado = Boolean(usuario);
  btnEntrar.classList.toggle('hidden', logueado);
  menu.classList.toggle('hidden', !logueado);
  menu.classList.toggle('flex', logueado);
  document.getElementById('nombreUsuario').textContent = perfil?.nombre || usuario?.email || 'Mi cuenta';
  document.getElementById('enlaceAdmin').classList.toggle('hidden', perfil?.rol !== 'admin');
}

async function alCambiarSesion(sesion) {
  usuario = sesion?.user ?? null;
  await cargarPerfil();
  pintarCabeceraSesion();
  // Si el cliente quería pagar y tuvo que iniciar sesión, continuamos donde iba
  if (usuario && accionTrasLogin) {
    const accion = accionTrasLogin;
    accionTrasLogin = null;
    accion();
  }
}

async function iniciarSesion(correo, password) {
  const { error } = await db.auth.signInWithPassword({ email: correo.trim().toLowerCase(), password });
  if (error) throw error;
}

async function registrarse({ nombre, apellido, correo, telefono, password }) {
  const { data, error } = await db.auth.signUp({
    email: correo.trim().toLowerCase(),
    password,
    // Estos datos los lee el trigger de la base de datos para crear el perfil
    options: { data: { nombre: nombre.trim(), apellido: apellido.trim(), telefono: telefono?.trim() || null } }
  });
  if (error) throw error;
  return Boolean(data.session); // false = falta confirmar el correo
}

// ---------------------------------------------------------------
// Compra y "Mis compras"
// ---------------------------------------------------------------
function finalizarCompra() {
  if (!carrito.length) {
    mostrarToast('Tu carrito está vacío.', true);
    return;
  }
  if (!usuario) {
    accionTrasLogin = finalizarCompra;
    cerrarDialogo('dlgCarrito');
    abrirDialogo('dlgAuth');
    return;
  }
  cerrarDialogo('dlgCarrito');
  abrirCheckout({
    usuario,
    perfil,
    carrito,
    subtotal: totalCarrito(),
    // Pedido creado: vaciamos el carrito y refrescamos el stock
    alExito: async (pedido) => {
      carrito = [];
      guardarCarrito();
      const extra = pedido.fuera_de_horario ? ` ${pedido.mensaje_horario}` : '';
      mostrarToast(`¡Pedido #${pedido.orden_id} creado por ${formatearPrecio(pedido.total)}!${extra}`);
      await cargarProductos().catch(() => {});
    },
    alError: async () => {
      await cargarProductos().catch(() => {});
      sanearCarrito();
    }
  });
}

function rellenarFormularioPerfil() {
  const f = document.getElementById('formPerfil');
  f.nombre.value = perfil?.nombre ?? '';
  f.apellido.value = perfil?.apellido ?? '';
  f.telefono.value = perfil?.telefono ?? '';
}

// ---------------------------------------------------------------
// Pestañas simples (aria-selected + mostrar/ocultar paneles)
// ---------------------------------------------------------------
function activarPestanas() {
  document.querySelectorAll('[data-tabs]').forEach((barra) => {
    const grupo = barra.dataset.tabs;
    const seleccionar = (nombre) => {
      barra.querySelectorAll('[data-tab]').forEach((b) =>
        b.setAttribute('aria-selected', String(b.dataset.tab === nombre))
      );
      document.querySelectorAll(`[data-grupo="${grupo}"]`).forEach((panel) =>
        panel.classList.toggle('hidden', panel.dataset.panel !== nombre)
      );
    };
    barra.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-tab]');
      if (b) seleccionar(b.dataset.tab);
    });
    seleccionar(barra.querySelector('[data-tab]').dataset.tab);
  });
}

// ---------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------
/** Ejecuta una acción deshabilitando el botón de envío mientras tanto. */
async function conBoton(form, accion) {
  const boton = form.querySelector('button[type="submit"]');
  boton.disabled = true;
  try {
    await accion();
  } catch (err) {
    mostrarToast(mensajeDeError(err), true);
  } finally {
    boton.disabled = false;
  }
}

function conectarEventos() {
  document.getElementById('btnCarrito').addEventListener('click', () => abrirDialogo('dlgCarrito'));
  document.getElementById('btnEntrar').addEventListener('click', () => abrirDialogo('dlgAuth'));
  document.getElementById('btnPagar').addEventListener('click', finalizarCompra);
  document.getElementById('btnSalir').addEventListener('click', async () => {
    await db.auth.signOut();
    mostrarToast('Sesión cerrada');
  });
  document.getElementById('btnPerfil').addEventListener('click', () => {
    // Siempre abrimos en la primera pestaña ("Mis compras")
    document.querySelector('[data-tabs="perfil"] [data-tab]').click();
    rellenarFormularioPerfil();
    cargarMisCompras(usuario);
    cargarLibreta(usuario.id);
    abrirDialogo('dlgPerfil');
  });

  // Agregar al carrito (delegación de eventos sobre el grid)
  document.getElementById('gridProductos').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-agregar]');
    if (b) agregarAlCarrito(Number(b.dataset.agregar));
  });

  // Botones +, − y quitar dentro del carrito
  document.getElementById('itemsCarrito').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-accion]');
    if (!b) return;
    const id = Number(b.dataset.id);
    if (b.dataset.accion === 'mas') cambiarCantidad(id, 1);
    if (b.dataset.accion === 'menos') cambiarCantidad(id, -1);
    if (b.dataset.accion === 'quitar') quitarDelCarrito(id);
  });

  // Filtro por categoría
  document.getElementById('filtrosCategoria').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-categoria]');
    if (!b) return;
    categoriaSeleccionada = b.dataset.categoria ? Number(b.dataset.categoria) : null;
    pintarFiltros();
    pintarProductos();
  });

  document.getElementById('busqueda').addEventListener('input', pintarProductos);

  // Iniciar sesión
  document.getElementById('formEntrar').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    conBoton(f, async () => {
      await iniciarSesion(f.correo.value, f.password.value);
      f.reset();
      cerrarDialogo('dlgAuth');
      mostrarToast('¡Bienvenido de vuelta!');
    });
  });

  // Crear cuenta
  document.getElementById('formRegistro').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    conBoton(f, async () => {
      const entro = await registrarse({
        nombre: f.nombre.value, apellido: f.apellido.value, correo: f.correo.value,
        telefono: f.telefono.value, password: f.password.value
      });
      f.reset();
      cerrarDialogo('dlgAuth');
      mostrarToast(entro ? '¡Cuenta creada!' : 'Cuenta creada. Revisa tu correo para confirmarla.');
    });
  });

  // Guardar datos del perfil
  document.getElementById('formPerfil').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    conBoton(f, async () => {
      const cambios = {
        nombre: f.nombre.value.trim(),
        apellido: f.apellido.value.trim(),
        telefono: f.telefono.value.trim() || null
      };
      const { error } = await db.from('perfiles').update(cambios).eq('id', usuario.id);
      if (error) throw error;
      perfil = { ...perfil, ...cambios };
      pintarCabeceraSesion();
      mostrarToast('Perfil actualizado');
    });
  });

  // Cambiar contraseña
  document.getElementById('formClave').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    conBoton(f, async () => {
      const { error } = await db.auth.updateUser({ password: f.nueva.value });
      if (error) throw error;
      f.reset();
      mostrarToast('Contraseña actualizada');
    });
  });
}

// ---------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------
async function iniciar() {
  document.getElementById('anio').textContent = String(new Date().getFullYear());
  mostrarAvisoConfiguracion(SUPABASE_CONFIGURADO);
  activarCierreDeDialogos();
  activarPestanas();
  conectarEventos();
  conectarCheckout();
  conectarCompras();
  conectarComprobantes({ obtenerUsuario: () => usuario, alSubir: () => cargarMisCompras(usuario) });
  conectarLibreta(() => usuario.id);
  conectarChat({
    obtenerUsuario: () => usuario,
    obtenerCarrito: () => carrito,
    abrirLogin: () => abrirDialogo('dlgAuth'),
    agregarAlCarrito: agregarDesdeChat,
    abrirCarrito: () => abrirDialogo('dlgCarrito')
  });
  pintarCarrito();
  avisarResultadoDePago();

  // Escuchamos cambios de sesión (login, logout, token renovado).
  // Importante: no usamos await de Supabase dentro del callback; lo
  // enviamos fuera con setTimeout para evitar bloqueos de la librería.
  db.auth.onAuthStateChange((_evento, sesion) => {
    setTimeout(() => alCambiarSesion(sesion), 0);
  });

  if (!SUPABASE_CONFIGURADO) {
    document.getElementById('gridProductos').innerHTML =
      '<p class="col-span-full text-tinta/60">Conecta Supabase en js/config.js para ver los productos.</p>';
    return;
  }

  // Horario, datos de contacto y volantes (si fallan, la tienda sigue funcionando)
  cargarConfiguracion()
    .then((cfg) => {
      pintarBannerHorario(cfg);
      pintarDatosTienda(cfg);
    })
    .catch(() => {});
  cargarPromociones().catch(() => {});

  try {
    await Promise.all([cargarCategorias(), cargarProductos()]);
    sanearCarrito();
  } catch (err) {
    document.getElementById('gridProductos').innerHTML =
      `<p class="col-span-full text-arcilla">No se pudieron cargar los productos. ${escaparHtml(mensajeDeError(err, ''))}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', iniciar);
