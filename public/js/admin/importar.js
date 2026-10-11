// admin/importar.js
// Lectura y validación de archivos Excel/CSV para importar productos.
// Usa SheetJS (librería oficial de su CDN) cargada solo cuando se necesita.
import { db } from '../supabaseClient.js';
import { listaCategorias } from './categorias.js';

const URL_SHEETJS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
const TAMANO_LOTE = 200;
const MAX_FILAS = 2000;
const MAX_BYTES = 5 * 1024 * 1024;

// Nombres de columna aceptados -> columna real de la tabla
const ALIAS = {
  sku: 'sku', codigo: 'sku',
  nombre: 'nombre', producto: 'nombre',
  descripcion: 'descripcion',
  precio: 'precio',
  existencias: 'existencias', stock: 'existencias', cantidad: 'existencias',
  categoria: 'categoria',
  activo: 'activo',
  imagen_url: 'imagen_url', imagen: 'imagen_url'
};

let promesaSheetJS = null;
function cargarSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  promesaSheetJS ??= new Promise((resolver, rechazar) => {
    const s = document.createElement('script');
    s.src = URL_SHEETJS;
    s.onload = () => resolver(window.XLSX);
    s.onerror = () => rechazar(new Error('No se pudo cargar el lector de Excel. Revisa tu conexión.'));
    document.head.appendChild(s);
  });
  return promesaSheetJS;
}

/** "Descripción " -> "descripcion" */
function normalizarClave(clave) {
  return String(clave).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Convierte "45000", "$ 45.000", "45.000,50" o "45,5" en número.
 * Devuelve NaN si no se entiende (nunca devuelve 0 por error).
 */
function parsearPrecio(valor) {
  if (typeof valor === 'number') return valor;
  const t = String(valor ?? '').replace(/[$\s]|COP/gi, '');
  if (t === '') return NaN;
  if (/^\d{1,3}([.,]\d{3})+([.,]\d+)?$/.test(t)) {
    // Separador de miles (45.000 / 1,234,567): el último separador es decimal solo si no es de miles
    const ultimo = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
    const decimales = t.length - ultimo - 1;
    if (decimales === 3) return Number(t.replace(/[.,]/g, ''));
    return Number(t.slice(0, ultimo).replace(/[.,]/g, '') + '.' + t.slice(ultimo + 1));
  }
  return /^\d+([.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : NaN;
}

function aBooleano(valor, porDefecto = true) {
  const t = String(valor ?? '').trim().toLowerCase();
  if (t === '') return porDefecto;
  return ['si', 'sí', 's', '1', 'true', 'x', 'activo'].includes(t);
}

/**
 * Lee el archivo y devuelve { validas, errores, avisos, nuevos, actualizan }.
 * No guarda nada: el admin ve primero la vista previa.
 */
export async function prepararImportacion(archivo, productosActuales) {
  if (archivo.size > MAX_BYTES) throw new Error('El archivo supera los 5 MB.');
  const XLSX = await cargarSheetJS();
  const libro = XLSX.read(await archivo.arrayBuffer(), { type: 'array' });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  const filasCrudas = XLSX.utils.sheet_to_json(hoja, { defval: '' });
  if (!filasCrudas.length) throw new Error('El archivo no tiene filas.');
  if (filasCrudas.length > MAX_FILAS) throw new Error(`Máximo ${MAX_FILAS} filas por importación.`);

  const categorias = await listaCategorias();
  const porCategoria = new Map();
  categorias.forEach((c) => {
    porCategoria.set(normalizarClave(c.nombre), c.id);
    porCategoria.set(normalizarClave(c.slug), c.id);
  });
  const skusExistentes = new Set(productosActuales.map((p) => p.sku));

  // Columnas presentes (todas las filas llevarán las mismas claves)
  const columnas = new Set(Object.keys(filasCrudas[0]).map((k) => ALIAS[normalizarClave(k)]).filter(Boolean));
  for (const obligatoria of ['sku', 'nombre', 'precio']) {
    if (!columnas.has(obligatoria)) throw new Error(`Falta la columna obligatoria "${obligatoria}".`);
  }

  const validas = [];
  const errores = [];
  const avisos = [];
  const vistos = new Set();
  let categoriasDesconocidas = 0;

  filasCrudas.forEach((cruda, i) => {
    const fila = {};
    for (const [k, v] of Object.entries(cruda)) {
      const real = ALIAS[normalizarClave(k)];
      if (real) fila[real] = v;
    }
    const num = i + 2; // +2: fila 1 es el encabezado
    const sku = String(fila.sku ?? '').trim();
    const nombre = String(fila.nombre ?? '').trim();
    const precio = parsearPrecio(fila.precio);

    if (!sku || !nombre) return errores.push(`Fila ${num}: faltan sku o nombre.`);
    if (sku.length > 64 || nombre.length > 200) return errores.push(`Fila ${num}: sku o nombre demasiado largo.`);
    if (!Number.isFinite(precio) || precio < 0) return errores.push(`Fila ${num} (${sku}): precio inválido.`);
    if (vistos.has(sku)) return errores.push(`Fila ${num}: SKU "${sku}" repetido en el archivo.`);
    vistos.add(sku);

    const producto = { sku, nombre, precio };
    if (columnas.has('descripcion')) producto.descripcion = String(fila.descripcion ?? '').trim() || null;
    if (columnas.has('existencias')) {
      const stock = Number(fila.existencias === '' ? 0 : fila.existencias);
      if (!Number.isInteger(stock) || stock < 0) return errores.push(`Fila ${num} (${sku}): existencias inválidas.`);
      producto.existencias = stock;
    }
    if (columnas.has('categoria')) {
      const clave = normalizarClave(fila.categoria ?? '');
      producto.categoria_id = clave ? porCategoria.get(clave) ?? null : null;
      if (clave && !producto.categoria_id) categoriasDesconocidas += 1;
    }
    if (columnas.has('activo')) producto.activo = aBooleano(fila.activo);
    if (columnas.has('imagen_url')) {
      const url = String(fila.imagen_url ?? '').trim();
      producto.imagen_url = /^https?:\/\//i.test(url) ? url : null;
    }
    validas.push(producto);
  });

  if (categoriasDesconocidas) avisos.push(`${categoriasDesconocidas} filas con categoría que no existe (quedan sin categoría).`);
  const actualizan = validas.filter((p) => skusExistentes.has(p.sku)).length;
  return { validas, errores, avisos, nuevos: validas.length - actualizan, actualizan };
}

/** Guarda en lotes: crea los SKU nuevos y actualiza los existentes. */
export async function confirmarImportacion(productos) {
  for (let i = 0; i < productos.length; i += TAMANO_LOTE) {
    const lote = productos.slice(i, i + TAMANO_LOTE);
    const { error } = await db.from('productos').upsert(lote, { onConflict: 'sku' });
    if (error) throw error;
  }
}

/** Descarga una plantilla CSV de ejemplo (con BOM para que Excel respete las tildes). */
export function plantillaCsv() {
  const contenido =
    'sku,nombre,descripcion,precio,existencias,categoria,activo,imagen_url\n' +
    'CAM-001,Camiseta básica blanca,Algodón 100%,45000,30,Hombre,si,\n' +
    'VES-010,Vestido floral,Tela fresca,119900,12,Mujer,si,\n';
  const blob = new Blob(['﻿', contenido], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'plantilla_productos.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
