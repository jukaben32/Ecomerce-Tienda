// admin/clientes.js
// Clientes con cuenta (y equipo): pedidos, total comprado y cambio de rol.
// Clientes SIN cuenta: personas que piden por teléfono o WhatsApp y que el
// admin registra para poder montarles pedidos.
import { db } from '../supabaseClient.js';
import { formatearPrecio, formatearFecha, escaparHtml, mostrarToast } from '../util.js';
import { $, seguro, obtenerAdmin, filaMensaje, textoOnull } from './nucleo.js';

let clientes = [];
let manuales = [];

/** Crea un cliente sin cuenta y devuelve la fila creada. */
export async function crearClienteManual({ nombre, telefono, direccion }) {
  const limpio = String(nombre ?? '').trim();
  if (!limpio) throw new Error('Escribe el nombre del cliente.');
  const { data, error } = await db
    .from('clientes_manuales')
    .insert({
      nombre: limpio,
      telefono: textoOnull(telefono),
      direccion: textoOnull(direccion),
      creado_por: obtenerAdmin()?.id ?? null
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function cargar() {
  $('tbodyClientes').innerHTML = filaMensaje(6, 'Cargando…');
  $('tbodyManuales').innerHTML = filaMensaje(6, 'Cargando…');
  const [cuentas, sinCuenta] = await Promise.all([
    db.from('clientes_resumen').select('*').order('creado_en', { ascending: false }).limit(500),
    db.from('clientes_manuales_resumen').select('*').order('creado_en', { ascending: false }).limit(500)
  ]);
  if (cuentas.error) throw cuentas.error;
  if (sinCuenta.error) throw sinCuenta.error;
  clientes = cuentas.data ?? [];
  manuales = sinCuenta.data ?? [];
  pintar();
  pintarManuales();
}

function pintar() {
  const q = $('busquedaClientes').value.trim().toLowerCase();
  const lista = q
    ? clientes.filter((c) => `${c.nombre} ${c.apellido} ${c.correo} ${c.telefono ?? ''}`.toLowerCase().includes(q))
    : clientes;
  const yo = obtenerAdmin()?.id;
  $('tbodyClientes').innerHTML = lista.length
    ? lista
        .map((c) => {
          const nuevoRol = c.rol === 'admin' ? 'cliente' : 'admin';
          return `
          <tr>
            <td class="font-medium">${escaparHtml([c.nombre, c.apellido].filter(Boolean).join(' ') || '(sin nombre)')}
              <div class="text-xs font-normal text-tinta/60">${escaparHtml(c.correo || '')}${c.telefono ? ` · ${escaparHtml(c.telefono)}` : ''}</div></td>
            <td class="text-right">${c.pedidos}</td>
            <td class="text-right">${formatearPrecio(c.total_comprado)}</td>
            <td class="whitespace-nowrap">${c.ultimo_pedido ? escaparHtml(formatearFecha(c.ultimo_pedido)) : '—'}</td>
            <td class="whitespace-nowrap">${escaparHtml(formatearFecha(c.creado_en))}</td>
            <td class="whitespace-nowrap">
              <span class="mr-2 capitalize ${c.rol === 'admin' ? 'font-bold text-salvia' : ''}">${escaparHtml(c.rol)}</span>
              ${c.id === yo ? '<span class="text-xs text-tinta/50">(tú)</span>'
                : `<button type="button" data-rol="${nuevoRol}" data-usuario="${escaparHtml(c.id)}" class="text-sm underline underline-offset-4 hover:text-arcilla">Hacer ${nuevoRol}</button>`}
            </td>
          </tr>`;
        })
        .join('')
    : filaMensaje(6, 'Sin resultados.');
}

function pintarManuales() {
  $('tbodyManuales').innerHTML = manuales.length
    ? manuales
        .map(
          (m) => `
          <tr>
            <td class="font-medium">${escaparHtml(m.nombre)}
              <div class="text-xs font-normal text-tinta/60">${escaparHtml(m.telefono || 'sin teléfono')}</div></td>
            <td>${escaparHtml(m.direccion || '—')}</td>
            <td class="text-right">${m.pedidos}</td>
            <td class="text-right">${formatearPrecio(m.total_comprado)}</td>
            <td class="whitespace-nowrap">${m.ultimo_pedido ? escaparHtml(formatearFecha(m.ultimo_pedido)) : '—'}</td>
            <td class="text-right"><button type="button" data-borrar-manual="${m.id}" class="text-sm text-tinta/60 underline underline-offset-4 hover:text-arcilla">Eliminar</button></td>
          </tr>`
        )
        .join('')
    : filaMensaje(6, 'Aún no hay clientes sin cuenta. Agrega el primero arriba o desde "Nuevo pedido".');
}

async function cambiarRol(usuarioId, rol) {
  if (!window.confirm(`¿Cambiar el rol de este usuario a "${rol}"?`)) return;
  const { error } = await db.rpc('cambiar_rol', { p_usuario: usuarioId, p_rol: rol });
  if (error) throw error;
  mostrarToast('Rol actualizado');
  await cargar();
}

export function montar() {
  $('panel-clientes').innerHTML = `
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-tinta/60">Los clientes se registran solos desde la tienda. Aquí puedes ascender a alguien a administrador (equipo).</p>
      <input id="busquedaClientes" type="search" placeholder="Buscar nombre, correo, teléfono…" class="campo !mt-0 w-64" aria-label="Buscar clientes">
    </div>
    <div class="overflow-x-auto rounded-2xl border border-tinta/15 bg-white/50">
      <table class="tabla w-full">
        <thead><tr><th>Cliente</th><th class="text-right">Pedidos</th><th class="text-right">Comprado</th><th>Último pedido</th><th>Registro</th><th>Rol</th></tr></thead>
        <tbody id="tbodyClientes"></tbody>
      </table>
    </div>

    <h2 class="mb-1 mt-10 font-display text-2xl font-bold">Clientes sin cuenta</h2>
    <p class="mb-4 text-sm text-tinta/60">Personas que piden por teléfono o WhatsApp. Les montas el pedido desde la pestaña «Nuevo pedido».</p>
    <form id="formManual" class="mb-4 grid gap-3 rounded-2xl border border-tinta/15 bg-white/50 p-4 sm:grid-cols-4">
      <label class="block text-sm font-medium">Nombre <input name="nombre" required maxlength="120" class="campo"></label>
      <label class="block text-sm font-medium">Teléfono / WhatsApp <input name="telefono" type="tel" maxlength="30" class="campo"></label>
      <label class="block text-sm font-medium">Dirección <input name="direccion" maxlength="250" class="campo"></label>
      <div class="flex items-end"><button type="submit" class="boton-principal w-full">Agregar cliente</button></div>
    </form>
    <div class="overflow-x-auto rounded-2xl border border-tinta/15 bg-white/50">
      <table class="tabla w-full">
        <thead><tr><th>Cliente</th><th>Dirección</th><th class="text-right">Pedidos</th><th class="text-right">Comprado</th><th>Último pedido</th><th></th></tr></thead>
        <tbody id="tbodyManuales"></tbody>
      </table>
    </div>`;

  $('busquedaClientes').addEventListener('input', pintar);
  $('tbodyClientes').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-usuario]');
    if (b) seguro(() => cambiarRol(b.dataset.usuario, b.dataset.rol));
  });

  $('formManual').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    seguro(async () => {
      await crearClienteManual({ nombre: f.nombre.value, telefono: f.telefono.value, direccion: f.direccion.value });
      f.reset();
      mostrarToast('Cliente agregado');
      await cargar();
    });
  });

  $('tbodyManuales').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-borrar-manual]');
    if (!b) return;
    seguro(async () => {
      if (!window.confirm('¿Eliminar este cliente? Solo es posible si no tiene pedidos.')) return;
      const { error } = await db.from('clientes_manuales').delete().eq('id', Number(b.dataset.borrarManual));
      if (error) {
        throw /foreign key|violates/i.test(error.message)
          ? new Error('No se puede eliminar: este cliente ya tiene pedidos.')
          : error;
      }
      mostrarToast('Cliente eliminado');
      await cargar();
    });
  });
}
