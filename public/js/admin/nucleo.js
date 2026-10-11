// admin/nucleo.js
// Utilidades y estado compartidos por todos los módulos del panel admin.
import { mostrarToast, mensajeDeError } from '../util.js';

export const $ = (id) => document.getElementById(id);

// Usuario administrador con sesión (lo fija admin.js al iniciar)
let adminActual = null;
export const obtenerAdmin = () => adminActual;
export const fijarAdmin = (usuario) => {
  adminActual = usuario;
};

/** Ejecuta una acción y muestra cualquier error como aviso (sin romper la página). */
export async function seguro(accion) {
  try {
    await accion();
  } catch (err) {
    mostrarToast(mensajeDeError(err), true);
  }
}

/** Convierte un campo numérico vacío en null. */
export function numeroOnull(valor) {
  return valor === '' || valor === null || valor === undefined ? null : Number(valor);
}

/** Texto vacío -> null (para columnas opcionales). */
export function textoOnull(valor) {
  const t = String(valor ?? '').trim();
  return t === '' ? null : t;
}

/** Fecha de hoy (o desplazada N días) como "YYYY-MM-DD" en hora local. */
export function fechaISO(desplazamientoDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + desplazamientoDias);
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** Cabecera de una tabla vacía/cargando/error en una sola fila. */
export function filaMensaje(columnas, texto, esError = false) {
  return `<tr><td colspan="${columnas}" class="${esError ? 'text-arcilla' : 'text-tinta/60'}">${texto}</td></tr>`;
}
