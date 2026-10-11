// chat.js
// Asistente de ventas con IA (ventana lateral). El cliente escribe o sube una
// foto de su lista; la función "chat" de Supabase busca los productos y
// devuelve "acciones" que aquí se aplican al carrito. La IA nunca crea pedidos.
import { invocarFuncion } from './api.js';
import { escaparHtml, mostrarToast, abrirDialogo } from './util.js';

const MAX_HISTORIAL = 12;       // turnos que se reenvían a la IA
const MAX_LADO_IMAGEN = 1280;   // px: reducimos la foto antes de enviarla
const MAX_CARACTERES_IMAGEN = 1_800_000;

let historial = [];             // [{ rol, texto }] (sin imágenes, para ahorrar datos)
let imagenAdjunta = null;       // data URL pendiente de enviar
let ocupado = false;
let enlaces = null;             // funciones que nos pasa tienda.js

const $ = (id) => document.getElementById(id);

/** Texto del asistente -> HTML seguro (solo **negrita**, saltos de línea y listas simples). */
function formatearTexto(texto) {
  return escaparHtml(texto)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-•] (.+)$/gm, '<span class="block pl-3">• $1</span>')
    .replace(/\n/g, '<br>');
}

function agregarBurbuja({ rol, texto, imagen, extra = '' }) {
  const lista = $('mensajesChat');
  const mio = rol === 'user';
  const div = document.createElement('div');
  div.className = `flex ${mio ? 'justify-end' : 'justify-start'}`;
  div.innerHTML = `
    <div class="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${mio ? 'rounded-br-md bg-tinta text-papel' : 'rounded-bl-md bg-white/80 text-tinta'}">
      ${imagen ? `<img src="${escaparHtml(imagen)}" alt="Foto enviada" class="mb-2 max-h-40 rounded-lg">` : ''}
      ${texto ? formatearTexto(texto) : ''}
      ${extra}
    </div>`;
  lista.appendChild(div);
  lista.scrollTop = lista.scrollHeight;
  return div;
}

/** Reduce y comprime la foto (JPEG) para que viaje rápido y barato. */
function prepararImagen(archivo) {
  return new Promise((resolver, rechazar) => {
    if (!/^image\/(jpeg|png|webp)$/.test(archivo.type)) {
      rechazar(new Error('Usa una imagen JPG, PNG o WebP.'));
      return;
    }
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, MAX_LADO_IMAGEN / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * escala);
      canvas.height = Math.round(img.height * escala);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      // Bajamos la calidad hasta que quepa en el límite
      for (const calidad of [0.85, 0.7, 0.55, 0.4]) {
        const dataUrl = canvas.toDataURL('image/jpeg', calidad);
        if (dataUrl.length <= MAX_CARACTERES_IMAGEN) {
          resolver(dataUrl);
          return;
        }
      }
      rechazar(new Error('La imagen es demasiado grande.'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rechazar(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}

function pintarAdjunto() {
  const zona = $('adjuntoChat');
  zona.classList.toggle('hidden', !imagenAdjunta);
  zona.innerHTML = imagenAdjunta
    ? `<div class="relative inline-block"><img src="${escaparHtml(imagenAdjunta)}" alt="Foto adjunta" class="h-16 rounded-lg">
         <button type="button" id="btnQuitarAdjunto" class="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-tinta text-xs text-papel" aria-label="Quitar foto">✕</button></div>`
    : '';
}

async function enviar(texto) {
  if (ocupado) return;
  if (!enlaces.obtenerUsuario()) {
    mostrarToast('Inicia sesión para hablar con el asistente.', true);
    enlaces.abrirLogin();
    return;
  }
  const imagen = imagenAdjunta;
  if (!texto && !imagen) return;

  ocupado = true;
  $('formChat').querySelector('button[type="submit"]').disabled = true;
  agregarBurbuja({ rol: 'user', texto, imagen });
  imagenAdjunta = null;
  pintarAdjunto();

  const escribiendo = agregarBurbuja({ rol: 'assistant', texto: 'Escribiendo…' });
  escribiendo.classList.add('animate-pulse');

  try {
    const mensajes = [...historial.slice(-MAX_HISTORIAL), { rol: 'user', texto, ...(imagen ? { imagen } : {}) }];
    const { respuesta, acciones } = await invocarFuncion('chat', { mensajes, carrito: enlaces.obtenerCarrito() });
    historial = [...historial, { rol: 'user', texto: texto || '(foto de lista)' }, { rol: 'assistant', texto: respuesta }];
    escribiendo.remove();

    let extra = '';
    if (acciones?.length) {
      const agregados = enlaces.agregarAlCarrito(acciones);
      extra = agregados
        ? `<button type="button" data-ver-carrito class="mt-2 block rounded-full bg-arcilla px-3 py-1 text-xs font-medium text-white">Ver carrito (${agregados} agregado${agregados === 1 ? '' : 's'})</button>`
        : '';
    }
    agregarBurbuja({ rol: 'assistant', texto: respuesta, extra });
  } catch (err) {
    escribiendo.remove();
    agregarBurbuja({ rol: 'assistant', texto: err.message });
  } finally {
    ocupado = false;
    $('formChat').querySelector('button[type="submit"]').disabled = false;
    $('entradaChat').focus();
  }
}

/**
 * Conecta el chat con la tienda.
 * @param {{obtenerUsuario:()=>object|null, abrirLogin:()=>void, obtenerCarrito:()=>Array,
 *          agregarAlCarrito:(acciones:Array)=>number, abrirCarrito:()=>void}} funciones
 */
export function conectarChat(funciones) {
  enlaces = funciones;
  agregarBurbuja({
    rol: 'assistant',
    texto: '¡Hola! Soy el asistente de ModaNueva. Puedo decirte precios, armar tu pedido y leer una **foto de tu lista**. ¿Qué buscas hoy?'
  });

  $('btnChat').addEventListener('click', () => {
    abrirDialogo('dlgChat');
    $('entradaChat').focus();
  });

  $('formChat').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const texto = $('entradaChat').value.trim();
    $('entradaChat').value = '';
    enviar(texto);
  });

  $('btnAdjuntarChat').addEventListener('click', () => $('archivoChat').click());
  $('archivoChat').addEventListener('change', async (ev) => {
    const archivo = ev.target.files[0];
    ev.target.value = '';
    if (!archivo) return;
    try {
      imagenAdjunta = await prepararImagen(archivo);
      pintarAdjunto();
    } catch (err) {
      mostrarToast(err.message, true);
    }
  });

  $('adjuntoChat').addEventListener('click', (ev) => {
    if (ev.target.closest('#btnQuitarAdjunto')) {
      imagenAdjunta = null;
      pintarAdjunto();
    }
  });

  $('mensajesChat').addEventListener('click', (ev) => {
    if (ev.target.closest('[data-ver-carrito]')) {
      $('dlgChat').close();
      enlaces.abrirCarrito();
    }
  });
}
