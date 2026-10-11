// sugerencias.js
// Quejas, reclamos y sugerencias de los clientes (exige sesión iniciada).
// Se envían con la función SQL enviar_sugerencia, que limita el spam.
import { db } from './supabaseClient.js';
import { mostrarToast, abrirDialogo, cerrarDialogo, mensajeDeError } from './util.js';

const $ = (id) => document.getElementById(id);

const TITULOS = {
  queja: 'Cuéntanos tu queja',
  reclamo: 'Presenta tu reclamo',
  sugerencia: 'Comparte tu sugerencia'
};

/**
 * @param {{obtenerUsuario:()=>object|null, abrirLogin:()=>void}} funciones
 */
export function conectarSugerencias({ obtenerUsuario, abrirLogin }) {
  // Los tres botones de la sección "Tu opinión" abren el formulario con el tipo elegido
  document.querySelectorAll('[data-abrir-opinion]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!obtenerUsuario()) {
        mostrarToast('Inicia sesión para enviarnos tu mensaje.', true);
        abrirLogin();
        return;
      }
      const tipo = b.dataset.abrirOpinion;
      const f = $('formSugerencia');
      f.reset();
      f.tipo.value = tipo;
      $('tituloSugerencia').textContent = TITULOS[tipo];
      abrirDialogo('dlgSugerencia');
    })
  );

  $('formSugerencia').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget;
    const boton = f.querySelector('button[type="submit"]');
    boton.disabled = true;
    try {
      const { error } = await db.rpc('enviar_sugerencia', {
        p_tipo: f.tipo.value,
        p_mensaje: f.mensaje.value,
        p_contacto: f.contacto.value || null
      });
      if (error) throw error;
      cerrarDialogo('dlgSugerencia');
      mostrarToast('¡Gracias! Recibimos tu mensaje y lo leeremos con atención.');
    } catch (err) {
      mostrarToast(mensajeDeError(err, 'No pudimos enviar tu mensaje.'), true);
    } finally {
      boton.disabled = false;
    }
  });
}
