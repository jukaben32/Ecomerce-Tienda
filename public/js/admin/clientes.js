// admin/clientes.js
// Clientes y equipo: cuántos pedidos ha hecho cada quien, cuánto ha
// comprado y cambio de rol (cliente <-> admin).
import { db } from '../supabaseClient.js';
import { formatearPrecio, formatearFecha, escaparHtml, mostrarToast } from '../util.js';
import { $, seguro, obtenerAdmin, filaMensaje } from './nucleo.js';

let clientes = [];

export async function cargar() {
  $('tbodyClientes').innerHTML = filaMensaje(6, 'Cargando…');
  const { data, error } = await db
    .from('clientes_resumen')
    .select('*')
    .order('creado_en', { ascending: false })
    .limit(500);
  if (error) throw error;
  clientes = data ?? [];
  pintar();
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
    </div>`;
  $('busquedaClientes').addEventListener('input', pintar);
  $('tbodyClientes').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-usuario]');
    if (b) seguro(() => cambiarRol(b.dataset.usuario, b.dataset.rol));
  });
}
