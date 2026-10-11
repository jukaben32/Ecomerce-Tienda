// admin.js
// Punto de entrada del panel de administración (public/admin.html).
// Se encarga del acceso y de las pestañas; cada pestaña vive en su
// propio módulo dentro de js/admin/ y se carga solo cuando se abre.
//
// IMPORTANTE: ocultar el panel aquí es solo comodidad. La seguridad real
// la dan las reglas RLS de la base de datos (ver supabase/*.sql).
import { db } from './supabaseClient.js';
import { SUPABASE_CONFIGURADO } from './config.js';
import { activarCierreDeDialogos, mostrarAvisoConfiguracion } from './util.js';
import { $, seguro, fijarAdmin } from './admin/nucleo.js';

import * as dashboard from './admin/dashboard.js';
import * as ordenes from './admin/ordenes.js';
import * as pedidoManual from './admin/pedidoManual.js';
import * as productos from './admin/productos.js';
import * as precios from './admin/precios.js';
import * as categorias from './admin/categorias.js';
import * as clientes from './admin/clientes.js';
import * as calificaciones from './admin/calificaciones.js';
import * as promociones from './admin/promociones.js';
import * as medios from './admin/medios.js';
import * as ia from './admin/ia.js';
import * as ajustes from './admin/ajustes.js';

// nombre de pestaña -> módulo (cada módulo exporta montar() y cargar())
const PESTANAS = {
  dashboard, ordenes, pedido: pedidoManual, productos, precios, categorias,
  clientes, calificaciones, promociones, medios, ia, ajustes
};
const TITULOS = {
  dashboard: 'Resumen', ordenes: 'Órdenes', pedido: 'Nuevo pedido', productos: 'Productos', precios: 'Precios IA',
  categorias: 'Categorías', clientes: 'Clientes', calificaciones: 'Calificaciones',
  promociones: 'Promociones', medios: 'Medios', ia: 'Asistente IA', ajustes: 'Configuración'
};

let pestanaActual = 'dashboard';
let panelMontado = false;

function mostrarAcceso(mensaje) {
  $('panelAdmin').classList.add('hidden');
  $('pantallaAcceso').classList.remove('hidden');
  $('btnSalirAdmin').classList.add('hidden');
  if (mensaje) $('mensajeAcceso').textContent = mensaje;
}

/** Comprueba la sesión y muestra el panel solo si el rol es admin. */
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
  fijarAdmin(session.user);
  $('pantallaAcceso').classList.add('hidden');
  $('panelAdmin').classList.remove('hidden');
  $('btnSalirAdmin').classList.remove('hidden');
  return true;
}

/** Muestra una pestaña y carga sus datos (cada vez que se entra, para ver lo último). */
function abrirPestana(nombre) {
  pestanaActual = nombre;
  $('barraPestanas').querySelectorAll('[data-tab]').forEach((b) =>
    b.setAttribute('aria-selected', String(b.dataset.tab === nombre))
  );
  document.querySelectorAll('[data-grupo="admin"]').forEach((p) =>
    p.classList.toggle('hidden', p.dataset.panel !== nombre)
  );
  seguro(() => PESTANAS[nombre].cargar());
}

/** Crea la barra de pestañas y monta (una sola vez) el HTML de cada módulo. */
function montarPanel() {
  if (panelMontado) return;
  $('barraPestanas').innerHTML = Object.keys(PESTANAS)
    .map((n) => `<button type="button" role="tab" data-tab="${n}" class="tab-btn whitespace-nowrap">${TITULOS[n]}</button>`)
    .join('');
  $('zonaPaneles').innerHTML = Object.keys(PESTANAS)
    .map((n) => `<section id="panel-${n}" data-panel="${n}" data-grupo="admin" class="hidden pt-6"></section>`)
    .join('');
  Object.values(PESTANAS).forEach((m) => m.montar());
  $('barraPestanas').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tab]');
    if (b) abrirPestana(b.dataset.tab);
  });
  panelMontado = true;
}

async function entrar() {
  if (!(await verificarAdmin())) return;
  montarPanel();
  abrirPestana(pestanaActual);
}

function conectarAcceso() {
  $('formAcceso').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    seguro(async () => {
      const { error } = await db.auth.signInWithPassword({ email: f.correo.value.trim().toLowerCase(), password: f.password.value });
      if (error) throw error;
      f.reset();
      await entrar();
    });
  });
  $('btnSalirAdmin').addEventListener('click', () =>
    seguro(async () => {
      await db.auth.signOut();
      fijarAdmin(null);
      mostrarAcceso('Sesión cerrada.');
    })
  );
}

document.addEventListener('DOMContentLoaded', async () => {
  mostrarAvisoConfiguracion(SUPABASE_CONFIGURADO);
  activarCierreDeDialogos();
  conectarAcceso();
  if (!SUPABASE_CONFIGURADO) {
    mostrarAcceso();
    return;
  }
  await seguro(entrar);
});
