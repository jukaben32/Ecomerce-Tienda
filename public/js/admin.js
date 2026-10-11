// admin.js
// Panel de administración (public/admin.html): órdenes, productos,
// categorías y usuarios. Todo va directo a Supabase; las reglas RLS del
// esquema SQL son las que realmente impiden que un no-admin haga cambios.
import { db } from './supabaseClient.js';
import { SUPABASE_CONFIGURADO } from './config.js';
import {
  formatearPrecio, formatearFecha, escaparHtml, mostrarToast,
  abrirDialogo, cerrarDialogo, activarCierreDeDialogos,
  mostrarAvisoConfiguracion, mensajeDeError
} from './util.js';

const ESTADOS = ['pendiente', 'pagada', 'enviada', 'entregada', 'cancelada', 'reembolsada'];
// Cada filtro de la pantalla equivale a uno o varios estados reales
const FILTROS_ESTADO = {
  pendiente: ['pendiente'],
  procesando: ['pagada', 'enviada'],
  terminada: ['entregada'],
  todas: null
};

let adminActual = null;      // usuario de Auth con rol admin
let filtroEstado = 'pendiente';
let ordenes = [];
let productos = [];
let categorias = [];

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------
// Acceso
// ---------------------------------------------------------------
function mostrarAcceso(mensaje) {
  $('panelAdmin').classList.add('hidden');
  $('pantallaAcceso').classList.remove('hidden');
  $('btnSalirAdmin').classList.add('hidden');
  if (mensaje) $('mensajeAcceso').textContent = mensaje;
}

/** Comprueba la sesión actual y muestra el panel solo si el rol es admin. */
async function verificarAdmin() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    mostrarAcceso();
    return false;
  }
  const { data: perfil } = await db.from('perfiles').select('rol').eq('id', session.user.id).maybeSingle();
  if (perfil?.rol !== 'admin') {
    await db.auth.signOut();
    mostrarAcceso('Esta cuenta no tiene permisos de administrador.');
    return false;
  }
  adminActual = session.user;
  $('pantallaAcceso').classList.add('hidden');
  $('panelAdmin').classList.remove('hidden');
  $('btnSalirAdmin').classList.remove('hidden');
  return true;
}

async function cargarTodo() {
  await cargarCategorias(); // primero: los productos usan las categorías
  await Promise.all([cargarOrdenes(), cargarProductos(), cargarUsuarios()]);
}

// ---------------------------------------------------------------
// Órdenes
// ---------------------------------------------------------------
async function cargarOrdenes() {
  const tbody = $('tbodyOrdenes');
  tbody.innerHTML = '<tr><td colspan="6" class="text-tinta/60">Cargando…</td></tr>';
  let consulta = db
    .from('ordenes')
    .select('id, estado, total, realizada_en, perfiles(nombre, apellido, correo), items_orden(sku, nombre_producto, precio_unitario, cantidad, total_renglon)')
    .order('realizada_en', { ascending: false })
    .limit(300);
  const estados = FILTROS_ESTADO[filtroEstado];
  if (estados) consulta = consulta.in('estado', estados);
  const { data, error } = await consulta;
  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-arcilla">${escaparHtml(mensajeDeError(error))}</td></tr>`;
    return;
  }
  ordenes = data ?? [];
  pintarOrdenes();
}

function pintarOrdenes() {
  const tbody = $('tbodyOrdenes');
  const q = $('busquedaOrdenes').value.trim().toLowerCase();
  const lista = q
    ? ordenes.filter((o) =>
        [o.perfiles?.nombre, o.perfiles?.apellido, o.perfiles?.correo].filter(Boolean).join(' ').toLowerCase().includes(q))
    : ordenes;

  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-tinta/60">No hay órdenes.</td></tr>';
    return;
  }
  tbody.innerHTML = lista
    .map((o) => {
      const cliente = [o.perfiles?.nombre, o.perfiles?.apellido].filter(Boolean).join(' ') || '(sin nombre)';
      const items = (o.items_orden ?? [])
        .map((it) => `<li class="flex justify-between gap-4"><span>${it.cantidad} × ${escaparHtml(it.nombre_producto)} <span class="text-tinta/50">(${escaparHtml(it.sku)})</span></span><span>${formatearPrecio(it.total_renglon)}</span></li>`)
        .join('');
      return `
        <tr>
          <td class="font-medium">${o.id}</td>
          <td>${escaparHtml(cliente)}<div class="text-xs text-tinta/60">${escaparHtml(o.perfiles?.correo || '')}</div></td>
          <td>
            <select data-estado-orden="${o.id}" class="campo !mt-0 !w-auto capitalize" aria-label="Estado de la orden ${o.id}">
              ${ESTADOS.map((e) => `<option value="${e}" ${e === o.estado ? 'selected' : ''}>${e}</option>`).join('')}
            </select>
          </td>
          <td class="whitespace-nowrap">${escaparHtml(formatearFecha(o.realizada_en))}</td>
          <td class="font-medium">${formatearPrecio(o.total)}</td>
          <td class="text-right"><button type="button" data-detalle="${o.id}" class="boton-sec !px-3 !py-1" aria-expanded="false">Ver</button></td>
        </tr>
        <tr class="hidden" data-fila-detalle="${o.id}"><td colspan="6" class="bg-crema/50"><ul class="space-y-1 text-sm">${items || '<li>Sin ítems</li>'}</ul></td></tr>`;
    })
    .join('');
}

async function cambiarEstadoOrden(id, estado) {
  const { error } = await db.from('ordenes').update({ estado }).eq('id', id);
  if (error) throw error;
  mostrarToast(`Orden #${id} → ${estado}`);
  await cargarOrdenes();
}

function pintarFiltrosEstado() {
  $('filtrosEstado').querySelectorAll('[data-estado]').forEach((b) => {
    const activo = b.dataset.estado === filtroEstado;
    b.className = `pildora ${activo ? 'border-tinta bg-tinta text-papel' : 'border-tinta/30 hover:border-tinta'}`;
  });
}

// ---------------------------------------------------------------
// Categorías
// ---------------------------------------------------------------
async function cargarCategorias() {
  const { data, error } = await db.from('categorias').select('*').order('nombre');
  if (error) {
    $('tbodyCategorias').innerHTML = `<tr><td colspan="5" class="text-arcilla">${escaparHtml(mensajeDeError(error))}</td></tr>`;
    return;
  }
  categorias = data ?? [];
  pintarCategorias();
  $('selCategoria').innerHTML =
    '<option value="">(Sin categoría)</option>' +
    categorias.map((c) => `<option value="${c.id}">${escaparHtml(c.nombre)}</option>`).join('');
}

function pintarCategorias() {
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
    : '<tr><td colspan="5" class="text-tinta/60">Sin categorías.</td></tr>';
}

function limpiarFormCategoria() {
  const f = $('formCategoria');
  f.reset();
  f.id.value = '';
  $('tituloFormCategoria').textContent = 'Nueva categoría';
}

function editarCategoria(id) {
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

/** Convierte el valor de un campo numérico vacío en null. */
function numeroOnull(valor) {
  return valor === '' || valor === null || valor === undefined ? null : Number(valor);
}

async function guardarCategoria(f) {
  const id = f.id.value ? Number(f.id.value) : null;
  const datos = {
    nombre: f.nombre.value.trim(),
    slug: f.slug.value.trim(),
    descripcion: f.descripcion.value.trim() || null,
    activo: f.activo.value === '1',
    descuento_pct: numeroOnull(f.descuento_pct.value),
    descuento_activo: f.descuento_activo.value === '1'
  };
  const { error } = id
    ? await db.from('categorias').update(datos).eq('id', id)
    : await db.from('categorias').insert(datos);
  if (error) throw error;
  mostrarToast(id ? 'Categoría actualizada' : 'Categoría creada');
  limpiarFormCategoria();
  await cargarCategorias();
}

/** Aplica o quita un descuento a TODAS las filas de una tabla. */
async function descuentoMasivo(tabla, f) {
  const activar = f.activar.value === '1';
  const pct = numeroOnull(f.porcentaje.value);
  if (activar && (pct === null || pct < 0 || pct > 100)) {
    throw new Error('Escribe un porcentaje entre 0 y 100.');
  }
  if (!window.confirm(`¿${activar ? `Aplicar ${pct}% de descuento` : 'Quitar el descuento'} a TODOS los registros de ${tabla}?`)) return;
  // PostgREST exige un filtro en los UPDATE; "id >= 0" abarca todas las filas
  const { error } = await db
    .from(tabla)
    .update({ descuento_pct: activar ? pct : null, descuento_activo: activar })
    .gte('id', 0);
  if (error) throw error;
  mostrarToast('Descuento masivo aplicado');
}

// ---------------------------------------------------------------
// Productos
// ---------------------------------------------------------------
async function cargarProductos() {
  const tbody = $('tbodyProductos');
  tbody.innerHTML = '<tr><td colspan="6" class="text-tinta/60">Cargando…</td></tr>';
  const { data, error } = await db.from('productos').select('*').order('nombre');
  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-arcilla">${escaparHtml(mensajeDeError(error))}</td></tr>`;
    return;
  }
  productos = data ?? [];
  pintarProductos();
}

function pintarProductos() {
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
    : '<tr><td colspan="6" class="text-tinta/60">Sin productos.</td></tr>';
}

function abrirFormProducto(producto) {
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
  abrirDialogo('dlgProducto');
}

async function guardarProducto(f) {
  const id = f.id.value ? Number(f.id.value) : null;
  const datos = {
    sku: f.sku.value.trim(),
    nombre: f.nombre.value.trim(),
    descripcion: f.descripcion.value.trim() || null,
    categoria_id: f.categoria_id.value ? Number(f.categoria_id.value) : null,
    precio: Number(f.precio.value),
    existencias: Number(f.existencias.value),
    activo: f.activo.value === '1',
    descuento_pct: numeroOnull(f.descuento_pct.value),
    descuento_activo: f.descuento_activo.value === '1',
    imagen_url: f.imagen_url.value.trim() || null
  };
  const { error } = id
    ? await db.from('productos').update(datos).eq('id', id)
    : await db.from('productos').insert(datos);
  if (error) throw error;
  mostrarToast(id ? 'Producto actualizado' : 'Producto creado');
  cerrarDialogo('dlgProducto');
  await cargarProductos();
}

async function desactivarProducto(id) {
  if (!window.confirm('¿Desactivar este producto? Dejará de verse en la tienda.')) return;
  const { error } = await db.from('productos').update({ activo: false }).eq('id', id);
  if (error) throw error;
  mostrarToast('Producto desactivado');
  await cargarProductos();
}

// ---------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------
async function cargarUsuarios() {
  const tbody = $('tbodyUsuarios');
  const { data, error } = await db
    .from('perfiles')
    .select('id, nombre, apellido, correo, rol, creado_en')
    .order('creado_en', { ascending: false })
    .limit(200);
  if (error) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-arcilla">${escaparHtml(mensajeDeError(error))}</td></tr>`;
    return;
  }
  tbody.innerHTML = data
    .map((u) => {
      const esYo = u.id === adminActual?.id;
      const nuevoRol = u.rol === 'admin' ? 'cliente' : 'admin';
      return `
        <tr>
          <td class="font-medium">${escaparHtml([u.nombre, u.apellido].filter(Boolean).join(' ') || '(sin nombre)')}</td>
          <td>${escaparHtml(u.correo || '')}</td>
          <td class="whitespace-nowrap">${escaparHtml(formatearFecha(u.creado_en))}</td>
          <td>
            <span class="mr-2 capitalize">${escaparHtml(u.rol)}</span>
            ${esYo ? '<span class="text-xs text-tinta/50">(tú)</span>'
                   : `<button type="button" data-rol="${nuevoRol}" data-usuario="${escaparHtml(u.id)}" class="text-sm underline underline-offset-4 hover:text-arcilla">Hacer ${nuevoRol}</button>`}
          </td>
        </tr>`;
    })
    .join('');
}

async function cambiarRol(usuarioId, rol) {
  if (!window.confirm(`¿Cambiar el rol de este usuario a "${rol}"?`)) return;
  const { error } = await db.rpc('cambiar_rol', { p_usuario: usuarioId, p_rol: rol });
  if (error) throw error;
  mostrarToast('Rol actualizado');
  await cargarUsuarios();
}

// ---------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------
/** Ejecuta una acción y muestra cualquier error como aviso (sin romper la página). */
async function seguro(accion) {
  try {
    await accion();
  } catch (err) {
    mostrarToast(mensajeDeError(err), true);
  }
}

function activarPestanas() {
  const barra = document.querySelector('[data-tabs="admin"]');
  const seleccionar = (nombre) => {
    barra.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === nombre)));
    document.querySelectorAll('[data-grupo="admin"]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== nombre));
  };
  barra.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tab]');
    if (b) seleccionar(b.dataset.tab);
  });
  seleccionar('ordenes');
}

function conectarEventos() {
  // Acceso
  $('formAcceso').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    seguro(async () => {
      const { error } = await db.auth.signInWithPassword({ email: f.correo.value.trim().toLowerCase(), password: f.password.value });
      if (error) throw error;
      f.reset();
      if (await verificarAdmin()) await cargarTodo();
    });
  });
  $('btnSalirAdmin').addEventListener('click', () =>
    seguro(async () => {
      await db.auth.signOut();
      adminActual = null;
      mostrarAcceso('Sesión cerrada.');
    })
  );

  // Órdenes
  $('filtrosEstado').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-estado]');
    if (!b) return;
    filtroEstado = b.dataset.estado;
    pintarFiltrosEstado();
    seguro(cargarOrdenes);
  });
  $('busquedaOrdenes').addEventListener('input', pintarOrdenes);
  $('btnRefrescar').addEventListener('click', () => seguro(cargarOrdenes));
  $('tbodyOrdenes').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-detalle]');
    if (!b) return;
    const fila = document.querySelector(`[data-fila-detalle="${b.dataset.detalle}"]`);
    const oculto = fila.classList.toggle('hidden');
    b.setAttribute('aria-expanded', String(!oculto));
    b.textContent = oculto ? 'Ver' : 'Ocultar';
  });
  $('tbodyOrdenes').addEventListener('change', (ev) => {
    const s = ev.target.closest('[data-estado-orden]');
    if (s) seguro(() => cambiarEstadoOrden(Number(s.dataset.estadoOrden), s.value));
  });

  // Productos
  $('btnNuevoProducto').addEventListener('click', () => abrirFormProducto(null));
  $('busquedaProductos').addEventListener('input', pintarProductos);
  $('tbodyProductos').addEventListener('click', (ev) => {
    const e = ev.target.closest('[data-editar-producto]');
    const d = ev.target.closest('[data-desactivar]');
    if (e) abrirFormProducto(productos.find((p) => p.id === Number(e.dataset.editarProducto)));
    if (d) seguro(() => desactivarProducto(Number(d.dataset.desactivar)));
  });
  $('formProducto').addEventListener('submit', (ev) => {
    ev.preventDefault();
    seguro(() => guardarProducto(ev.currentTarget));
  });
  $('formDescuentoProductos').addEventListener('submit', (ev) => {
    ev.preventDefault();
    seguro(async () => {
      await descuentoMasivo('productos', ev.currentTarget);
      await cargarProductos();
    });
  });

  // Categorías
  $('tbodyCategorias').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-editar-categoria]');
    if (b) editarCategoria(Number(b.dataset.editarCategoria));
  });
  $('formCategoria').addEventListener('submit', (ev) => {
    ev.preventDefault();
    seguro(() => guardarCategoria(ev.currentTarget));
  });
  $('btnNuevaCategoria').addEventListener('click', limpiarFormCategoria);
  $('formDescuentoCategorias').addEventListener('submit', (ev) => {
    ev.preventDefault();
    seguro(async () => {
      await descuentoMasivo('categorias', ev.currentTarget);
      await cargarCategorias();
    });
  });

  // Usuarios
  $('tbodyUsuarios').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-usuario]');
    if (b) seguro(() => cambiarRol(b.dataset.usuario, b.dataset.rol));
  });
}

async function iniciar() {
  mostrarAvisoConfiguracion(SUPABASE_CONFIGURADO);
  activarCierreDeDialogos();
  activarPestanas();
  pintarFiltrosEstado();
  conectarEventos();
  if (!SUPABASE_CONFIGURADO) {
    mostrarAcceso();
    return;
  }
  await seguro(async () => {
    if (await verificarAdmin()) await cargarTodo();
  });
}

document.addEventListener('DOMContentLoaded', iniciar);
