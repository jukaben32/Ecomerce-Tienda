// admin/pedidoManual.js
// "Nuevo pedido": el admin monta un pedido a nombre de un cliente
// (por ejemplo, pedidos que llegan por teléfono o WhatsApp).
// El precio y el stock los valida la función SQL crear_orden_admin.
import { db } from '../supabaseClient.js';
import { formatearPrecio, escaparHtml, mostrarToast } from '../util.js';
import { ETIQUETAS_PAGO } from '../configuracion.js';
import { listarDirecciones, direccionEnTexto } from '../direcciones.js';
import { $, seguro, textoOnull } from './nucleo.js';

let clientes = [];
let productos = [];
let items = []; // [{ producto_id, cantidad }]

const etiquetaCliente = (c) => `${[c.nombre, c.apellido].filter(Boolean).join(' ') || '(sin nombre)'} — ${c.correo}`;
const etiquetaProducto = (p) => `${p.sku} — ${p.nombre}`;

export async function cargar() {
  const [cli, prod] = await Promise.all([
    db.from('clientes_resumen').select('id, nombre, apellido, correo, telefono').order('nombre'),
    db.from('productos_publicos').select('id, sku, nombre, precio_final, existencias').eq('activo', true).gt('existencias', 0).order('nombre')
  ]);
  if (cli.error) throw cli.error;
  if (prod.error) throw prod.error;
  clientes = cli.data ?? [];
  productos = prod.data ?? [];
  $('listaClientesManual').innerHTML = clientes.map((c) => `<option value="${escaparHtml(etiquetaCliente(c))}"></option>`).join('');
  $('listaProductosManual').innerHTML = productos.map((p) => `<option value="${escaparHtml(etiquetaProducto(p))}"></option>`).join('');
  pintarItems();
}

function clienteElegido() {
  return clientes.find((c) => etiquetaCliente(c) === $('mCliente').value);
}

/** Al elegir cliente: trae sus direcciones guardadas y su teléfono. */
async function alElegirCliente() {
  const c = clienteElegido();
  const sel = $('mDirSel');
  sel.innerHTML = '<option value="">Escribir otra dirección…</option>';
  if (!c) return;
  $('mTelefono').value = c.telefono ?? '';
  const dirs = await listarDirecciones(c.id);
  sel.innerHTML =
    dirs.map((d) => `<option value="${escaparHtml(direccionEnTexto(d))}">${escaparHtml(d.etiqueta)}: ${escaparHtml(direccionEnTexto(d))}</option>`).join('') +
    '<option value="">Escribir otra dirección…</option>';
  if (dirs.length) $('mDireccion').value = direccionEnTexto(dirs.find((d) => d.es_principal) ?? dirs[0]);
  if (dirs.length) sel.value = $('mDireccion').value;
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
  if (!cliente) throw new Error('Elige un cliente de la lista.');
  if (!items.length) throw new Error('Agrega al menos un producto.');
  const { data, error } = await db.rpc('crear_orden_admin', {
    p_cliente: cliente.id,
    p_items: items,
    p_direccion: f.mDireccion.value.trim(),
    p_metodo_pago: f.mMetodo.value,
    p_notas: textoOnull(f.mNotas.value),
    p_telefono: textoOnull(f.mTelefono.value)
  });
  if (error) throw error;
  mostrarToast(`Pedido #${data.orden_id} creado por ${formatearPrecio(data.total)}`);
  items = [];
  f.reset();
  $('mDirSel').innerHTML = '<option value="">Escribir otra dirección…</option>';
  await cargar(); // refresca el stock disponible
}

export function montar() {
  $('panel-pedido').innerHTML = `
    <form id="formPedidoManual" class="grid gap-6 lg:grid-cols-2">
      <div class="space-y-4 rounded-2xl border border-tinta/15 bg-white/50 p-5">
        <h2 class="font-display text-xl font-bold">Cliente y entrega</h2>
        <label class="block text-sm font-medium">Cliente
          <input id="mCliente" list="listaClientesManual" required autocomplete="off" placeholder="Escribe para buscar…" class="campo">
          <datalist id="listaClientesManual"></datalist></label>
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
          <span id="mSubtotal" class="font-display text-2xl font-bold">$ 0</span>
        </div>
        <button type="submit" class="boton-principal w-full">Crear pedido</button>
      </div>
    </form>`;

  const f = $('formPedidoManual');
  $('mCliente').addEventListener('change', () => seguro(alElegirCliente));
  $('mDirSel').addEventListener('change', (ev) => {
    if (ev.target.value) $('mDireccion').value = ev.target.value;
  });
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
