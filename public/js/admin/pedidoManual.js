// admin/pedidoManual.js
// "Nuevo pedido": el admin monta un pedido a nombre de un cliente, con o sin
// cuenta (pedidos por teléfono o WhatsApp). Un botón de IA puede leer el
// mensaje del cliente y rellenar el formulario; el admin SIEMPRE revisa antes
// de crear. El precio y el stock los valida la función SQL del servidor.
import { db } from '../supabaseClient.js';
import { formatearPrecio, escaparHtml, mostrarToast, abrirDialogo, cerrarDialogo } from '../util.js';
import { ETIQUETAS_PAGO } from '../configuracion.js';
import { listarDirecciones, direccionEnTexto } from '../direcciones.js';
import { invocarFuncion } from '../api.js';
import { prepararImagen } from '../imagen.js';
import { $, seguro, textoOnull } from './nucleo.js';
import { crearClienteManual } from './clientes.js';

let clientes = [];  // [{ tipo: 'cuenta'|'manual', id, etiqueta, nombre, telefono, direccion }]
let productos = [];
let items = [];     // [{ producto_id, cantidad }]
let capturaIA = null; // data URL de la captura de WhatsApp (opcional)
let propuestaIA = null;

const etiquetaProducto = (p) => `${p.sku} — ${p.nombre}`;

export async function cargar() {
  const [cuentas, sinCuenta, prod] = await Promise.all([
    db.from('clientes_resumen').select('id, nombre, apellido, correo, telefono').order('nombre'),
    db.from('clientes_manuales').select('id, nombre, telefono, direccion').order('nombre'),
    db.from('productos_publicos').select('id, sku, nombre, precio_final, existencias').eq('activo', true).gt('existencias', 0).order('nombre')
  ]);
  for (const r of [cuentas, sinCuenta, prod]) if (r.error) throw r.error;

  clientes = [
    ...(cuentas.data ?? []).map((c) => ({
      tipo: 'cuenta', id: c.id, nombre: [c.nombre, c.apellido].filter(Boolean).join(' ') || '(sin nombre)',
      telefono: c.telefono, direccion: '',
      etiqueta: `${[c.nombre, c.apellido].filter(Boolean).join(' ') || '(sin nombre)'} — ${c.correo}`
    })),
    ...(sinCuenta.data ?? []).map((m) => ({
      tipo: 'manual', id: m.id, nombre: m.nombre, telefono: m.telefono, direccion: m.direccion ?? '',
      etiqueta: `${m.nombre} — ${m.telefono || 'sin teléfono'} (sin cuenta #${m.id})`
    }))
  ];
  productos = prod.data ?? [];
  $('listaClientesManual').innerHTML = clientes.map((c) => `<option value="${escaparHtml(c.etiqueta)}"></option>`).join('');
  $('listaProductosManual').innerHTML = productos.map((p) => `<option value="${escaparHtml(etiquetaProducto(p))}"></option>`).join('');
  pintarItems();
}

const clienteElegido = () => clientes.find((c) => c.etiqueta === $('mCliente').value);

/** Al elegir cliente: trae su teléfono y sus direcciones guardadas. */
async function alElegirCliente() {
  const c = clienteElegido();
  const sel = $('mDirSel');
  sel.innerHTML = '<option value="">Escribir otra dirección…</option>';
  if (!c) return;
  if (c.telefono) $('mTelefono').value = c.telefono;
  if (c.tipo === 'manual') {
    if (c.direccion) {
      sel.innerHTML = `<option value="${escaparHtml(c.direccion)}">Guardada: ${escaparHtml(c.direccion)}</option><option value="">Escribir otra dirección…</option>`;
      sel.value = c.direccion;
      $('mDireccion').value = c.direccion;
    }
    return;
  }
  const dirs = await listarDirecciones(c.id);
  sel.innerHTML =
    dirs.map((d) => `<option value="${escaparHtml(direccionEnTexto(d))}">${escaparHtml(d.etiqueta)}: ${escaparHtml(direccionEnTexto(d))}</option>`).join('') +
    '<option value="">Escribir otra dirección…</option>';
  if (dirs.length) {
    const principal = dirs.find((d) => d.es_principal) ?? dirs[0];
    $('mDireccion').value = direccionEnTexto(principal);
    sel.value = $('mDireccion').value;
  }
}

function pintarItems() {
  const cont = $('mItems');
  if (!items.length) {
    cont.innerHTML = '<p class="py-6 text-center text-sm text-tinta/60">Agrega productos al pedido.</p>';
    $('mSubtotal').textContent = formatearPrecio(0);
    return;
  }
  let subtotal = 0;
  cont.innerHTML = items
    .map((it) => {
      const p = productos.find((x) => x.id === it.producto_id);
      if (!p) return '';
      subtotal += Number(p.precio_final) * it.cantidad;
      return `
        <div class="flex items-center justify-between gap-3 py-2 text-sm">
          <div class="min-w-0"><div class="truncate font-medium">${escaparHtml(p.nombre)}</div>
            <div class="text-xs text-tinta/60">${formatearPrecio(p.precio_final)} · stock ${p.existencias}</div></div>
          <div class="flex shrink-0 items-center gap-2">
            <button type="button" data-menos="${p.id}" class="rounded-full border border-tinta/30 px-2" aria-label="Quitar una unidad">−</button>
            <span class="w-6 text-center">${it.cantidad}</span>
            <button type="button" data-mas="${p.id}" class="rounded-full border border-tinta/30 px-2" aria-label="Agregar una unidad">+</button>
            <button type="button" data-quitar="${p.id}" class="ml-2 text-xs text-tinta/60 underline hover:text-arcilla">Quitar</button>
          </div>
        </div>`;
    })
    .join('');
  $('mSubtotal').textContent = formatearPrecio(subtotal);
}

function cambiarCantidad(id, delta) {
  const p = productos.find((x) => x.id === id);
  items = items
    .map((it) => (it.producto_id === id ? { ...it, cantidad: Math.min(it.cantidad + delta, p?.existencias ?? it.cantidad) } : it))
    .filter((it) => it.cantidad > 0);
  pintarItems();
}

async function crearPedido(f) {
  const cliente = clienteElegido();
  if (!cliente) throw new Error('Elige un cliente de la lista, o crea uno nuevo sin cuenta.');
  if (!items.length) throw new Error('Agrega al menos un producto.');
  const comunes = {
    p_items: items,
    p_direccion: f.mDireccion.value.trim(),
    p_metodo_pago: f.mMetodo.value,
    p_notas: textoOnull(f.mNotas.value),
    p_telefono: textoOnull(f.mTelefono.value)
  };
  const { data, error } = cliente.tipo === 'manual'
    ? await db.rpc('crear_orden_admin_manual', { p_cliente_manual: cliente.id, ...comunes })
    : await db.rpc('crear_orden_admin', { p_cliente: cliente.id, ...comunes });
  if (error) throw error;
  mostrarToast(`Pedido #${data.orden_id} creado por ${formatearPrecio(data.total)}`);
  items = [];
  propuestaIA = null;
  $('resultadoIA').innerHTML = '';
  f.reset();
  $('mDirSel').innerHTML = '<option value="">Escribir otra dirección…</option>';
  await cargar(); // refresca el stock disponible
}

// ---------------------------------------------------------------
// IA: leer el mensaje de WhatsApp del cliente
// ---------------------------------------------------------------
function pintarResultadoIA(respuesta) {
  const zona = $('resultadoIA');
  if (respuesta.mensaje) {
    zona.innerHTML = `<p class="rounded-xl bg-crema px-4 py-3 text-sm">${escaparHtml(respuesta.mensaje)}</p>`;
    return;
  }
  const { propuesta, cliente_sugerido: sugerido } = respuesta;
  propuestaIA = propuesta;
  const lista = (titulo, arr, color) =>
    arr.length
      ? `<div class="mt-2"><p class="text-xs font-bold uppercase tracking-widest ${color}">${titulo}</p>
         <ul class="mt-1 list-disc pl-5 text-sm">${arr.map((x) => `<li>${escaparHtml(x)}</li>`).join('')}</ul></div>`
      : '';
  const quien = sugerido
    ? `<p class="text-sm">Cliente reconocido: <strong>${escaparHtml(sugerido.nombre)}</strong> (${sugerido.tipo === 'manual' ? 'sin cuenta' : 'con cuenta'}).</p>`
    : propuesta.cliente.nombre || propuesta.cliente.telefono
      ? `<p class="text-sm">Cliente nuevo: <strong>${escaparHtml(propuesta.cliente.nombre || '(sin nombre)')}</strong> ${escaparHtml(propuesta.cliente.telefono)}
           <button type="button" id="btnCrearDesdeIA" class="ml-2 rounded-full border border-tinta/30 px-3 py-1 text-xs font-medium hover:bg-tinta hover:text-papel">Crear cliente sin cuenta con estos datos</button></p>`
      : '<p class="text-sm text-tinta/60">No se detectó el cliente: elígelo en la lista.</p>';
  zona.innerHTML = `
    <div class="rounded-xl border border-salvia/40 bg-salvia/10 p-4">
      <p class="text-sm font-medium">La IA rellenó el formulario. <strong>Revísalo</strong> antes de crear el pedido.</p>
      ${quien}
      ${lista('No encontrados en el catálogo', propuesta.no_encontrados, 'text-arcilla')}
      ${lista('Confirma con el cliente', propuesta.dudas, 'text-tinta/60')}
    </div>`;
}

/** Aplica la propuesta de la IA al formulario. */
async function aplicarPropuesta(respuesta) {
  const { propuesta, cliente_sugerido: sugerido } = respuesta;
  const f = $('formPedidoManual');

  items = propuesta.items
    .filter((it) => productos.some((p) => p.id === it.producto_id))
    .map((it) => ({ producto_id: it.producto_id, cantidad: it.cantidad }));
  pintarItems();

  if (propuesta.direccion) $('mDireccion').value = propuesta.direccion;
  if (propuesta.cliente.telefono) $('mTelefono').value = propuesta.cliente.telefono;
  if (propuesta.notas) $('mNotas').value = propuesta.notas;
  if (propuesta.metodo_pago && Object.hasOwn(ETIQUETAS_PAGO, propuesta.metodo_pago)) f.mMetodo.value = propuesta.metodo_pago;

  if (sugerido) {
    const c = clientes.find((x) => x.tipo === sugerido.tipo && String(x.id) === String(sugerido.id));
    if (c) {
      $('mCliente').value = c.etiqueta;
      await alElegirCliente();
      // La dirección que escribió el cliente en el mensaje tiene prioridad sobre la guardada
      if (propuesta.direccion) $('mDireccion').value = propuesta.direccion;
      if (propuesta.cliente.telefono) $('mTelefono').value = propuesta.cliente.telefono;
    }
  }
}

async function interpretarConIA() {
  const texto = $('textoWhatsapp').value.trim();
  if (!texto && !capturaIA) throw new Error('Pega el mensaje del cliente o sube una captura.');
  $('resultadoIA').innerHTML = '<p class="animate-pulse text-sm text-tinta/60">Leyendo el mensaje…</p>';
  try {
    const respuesta = await invocarFuncion('interpretar-pedido', { texto, ...(capturaIA ? { imagen: capturaIA } : {}) });
    pintarResultadoIA(respuesta);
    if (respuesta.propuesta) await aplicarPropuesta(respuesta);
  } catch (err) {
    $('resultadoIA').innerHTML = '';
    throw err;
  }
}

export function montar() {
  $('panel-pedido').innerHTML = `
    <section class="mb-6 rounded-2xl border border-tinta/15 bg-white/50 p-5">
      <h2 class="font-display text-xl font-bold">Pedido desde WhatsApp <span class="ml-1 rounded-full bg-arcilla px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider text-white">IA</span></h2>
      <p class="mt-1 text-sm text-tinta/60">Pega el mensaje del cliente (o sube una captura) y la IA rellena el formulario de abajo. Tú revisas y confirmas.</p>
      <textarea id="textoWhatsapp" rows="3" maxlength="4000" placeholder="Ej: Buenas, soy Juana, dame 2 blusas de lino y una gorra. Mi cel 809-555-0101, mándalo a Calle Duarte 15, Naco. Pago por transferencia" class="campo"></textarea>
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <button id="btnInterpretar" type="button" class="boton-principal">Leer con IA</button>
        <label class="boton-sec cursor-pointer">Subir captura
          <input id="archivoCaptura" type="file" accept="image/jpeg,image/png,image/webp" class="hidden"></label>
        <span id="nombreCaptura" class="text-xs text-tinta/60"></span>
      </div>
      <div id="resultadoIA" class="mt-4" aria-live="polite"></div>
    </section>

    <form id="formPedidoManual" class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-4 rounded-2xl border border-tinta/15 bg-white/50 p-5">
        <h2 class="font-display text-xl font-bold">Cliente y entrega</h2>
        <div>
          <label class="block text-sm font-medium">Cliente
            <input id="mCliente" list="listaClientesManual" required autocomplete="off" placeholder="Escribe para buscar…" class="campo">
            <datalist id="listaClientesManual"></datalist></label>
          <button id="btnClienteRapido" type="button" class="mt-1 text-xs font-medium underline underline-offset-4 hover:text-arcilla">+ Cliente nuevo sin cuenta</button>
        </div>
        <label class="block text-sm font-medium">Direcciones guardadas
          <select id="mDirSel" class="campo"><option value="">Escribir otra dirección…</option></select></label>
        <label class="block text-sm font-medium">Dirección de entrega
          <input id="mDireccion" required minlength="5" maxlength="250" class="campo"></label>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block text-sm font-medium">Teléfono <input id="mTelefono" type="tel" maxlength="30" class="campo"></label>
          <label class="block text-sm font-medium">Medio de pago
            <select id="mMetodo" class="campo">
              ${Object.entries(ETIQUETAS_PAGO).map(([v, t]) => `<option value="${v}">${escaparHtml(t)}</option>`).join('')}
            </select></label>
        </div>
        <label class="block text-sm font-medium">Notas <textarea id="mNotas" rows="2" maxlength="500" class="campo"></textarea></label>
      </div>

      <div class="space-y-4 rounded-2xl border border-tinta/15 bg-white/50 p-5">
        <h2 class="font-display text-xl font-bold">Productos</h2>
        <div class="flex gap-2">
          <input id="mProducto" list="listaProductosManual" autocomplete="off" placeholder="Buscar producto o SKU…" class="campo !mt-0" aria-label="Buscar producto">
          <datalist id="listaProductosManual"></datalist>
          <button id="btnAgregarManual" type="button" class="boton-sec shrink-0">Agregar</button>
        </div>
        <div id="mItems" class="divide-y divide-tinta/10"></div>
        <div class="flex items-baseline justify-between border-t border-tinta/15 pt-3">
          <span class="text-sm text-tinta/60">Subtotal (el envío se suma al guardar)</span>
          <span id="mSubtotal" class="font-display text-2xl font-bold">RD$0</span>
        </div>
        <button type="submit" class="boton-principal w-full">Crear pedido</button>
      </div>
    </form>`;

  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="dlgClienteRapido" class="m-auto w-[min(92vw,26rem)] rounded-3xl bg-papel p-0 text-tinta shadow-2xl">
      <form id="formClienteRapido" class="space-y-4 p-6">
        <div class="flex items-center justify-between">
          <h2 class="font-display text-2xl font-bold">Cliente sin cuenta</h2>
          <button type="button" data-cerrar class="rounded-full px-3 py-1 text-sm hover:bg-crema" aria-label="Cerrar">✕</button>
        </div>
        <label class="block text-sm font-medium">Nombre <input name="nombre" required maxlength="120" class="campo"></label>
        <label class="block text-sm font-medium">Teléfono / WhatsApp <input name="telefono" type="tel" maxlength="30" class="campo"></label>
        <label class="block text-sm font-medium">Dirección <input name="direccion" maxlength="250" class="campo"></label>
        <button type="submit" class="boton-principal w-full">Guardar y usar</button>
      </form>
    </dialog>`);

  const f = $('formPedidoManual');
  $('mCliente').addEventListener('change', () => seguro(alElegirCliente));
  $('mDirSel').addEventListener('change', (ev) => {
    if (ev.target.value) $('mDireccion').value = ev.target.value;
  });

  // Cliente nuevo sin cuenta (desde el formulario o desde lo que leyó la IA)
  const usarClienteNuevo = async (datos) => {
    const m = await crearClienteManual(datos);
    const nuevo = {
      tipo: 'manual', id: m.id, nombre: m.nombre, telefono: m.telefono, direccion: m.direccion ?? '',
      etiqueta: `${m.nombre} — ${m.telefono || 'sin teléfono'} (sin cuenta #${m.id})`
    };
    clientes = [...clientes, nuevo];
    $('listaClientesManual').insertAdjacentHTML('beforeend', `<option value="${escaparHtml(nuevo.etiqueta)}"></option>`);
    $('mCliente').value = nuevo.etiqueta;
    await alElegirCliente();
    mostrarToast('Cliente creado');
  };
  $('btnClienteRapido').addEventListener('click', () => {
    $('formClienteRapido').reset();
    abrirDialogo('dlgClienteRapido');
  });
  $('formClienteRapido').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const q = ev.currentTarget;
    seguro(async () => {
      await usarClienteNuevo({ nombre: q.nombre.value, telefono: q.telefono.value, direccion: q.direccion.value });
      cerrarDialogo('dlgClienteRapido');
    });
  });
  $('resultadoIA').addEventListener('click', (ev) => {
    if (!ev.target.closest('#btnCrearDesdeIA') || !propuestaIA) return;
    seguro(() => usarClienteNuevo({
      nombre: propuestaIA.cliente.nombre || 'Cliente WhatsApp',
      telefono: propuestaIA.cliente.telefono,
      direccion: propuestaIA.direccion
    }));
  });

  // IA
  $('btnInterpretar').addEventListener('click', () => {
    const boton = $('btnInterpretar');
    boton.disabled = true;
    seguro(interpretarConIA).finally(() => {
      boton.disabled = false;
    });
  });
  $('archivoCaptura').addEventListener('change', (ev) => {
    const archivo = ev.target.files[0];
    ev.target.value = '';
    if (!archivo) return;
    seguro(async () => {
      capturaIA = await prepararImagen(archivo);
      $('nombreCaptura').textContent = `📎 ${archivo.name}`;
    });
  });

  // Productos
  $('btnAgregarManual').addEventListener('click', () => {
    const p = productos.find((x) => etiquetaProducto(x) === $('mProducto').value);
    if (!p) {
      mostrarToast('Elige un producto de la lista.', true);
      return;
    }
    const existente = items.find((it) => it.producto_id === p.id);
    if ((existente?.cantidad ?? 0) + 1 > p.existencias) {
      mostrarToast('No hay más stock de ese producto.', true);
      return;
    }
    items = existente
      ? items.map((it) => (it.producto_id === p.id ? { ...it, cantidad: it.cantidad + 1 } : it))
      : [...items, { producto_id: p.id, cantidad: 1 }];
    $('mProducto').value = '';
    pintarItems();
  });
  $('mItems').addEventListener('click', (ev) => {
    const mas = ev.target.closest('[data-mas]');
    const menos = ev.target.closest('[data-menos]');
    const quitar = ev.target.closest('[data-quitar]');
    if (mas) cambiarCantidad(Number(mas.dataset.mas), 1);
    if (menos) cambiarCantidad(Number(menos.dataset.menos), -1);
    if (quitar) {
      items = items.filter((it) => it.producto_id !== Number(quitar.dataset.quitar));
      pintarItems();
    }
  });
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const boton = f.querySelector('button[type="submit"]');
    boton.disabled = true;
    seguro(() => crearPedido(f)).finally(() => {
      boton.disabled = false;
    });
  });
}
