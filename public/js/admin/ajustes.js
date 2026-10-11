// admin/ajustes.js
// Configuración de la tienda: horario de domicilios, envío, pedido mínimo,
// medios de pago y ticket. Se guarda en la fila única de "configuracion".
import { db } from '../supabaseClient.js';
import { mostrarToast } from '../util.js';
import { cargarConfiguracion, ETIQUETAS_PAGO } from '../configuracion.js';
import { $, seguro, numeroOnull, textoOnull } from './nucleo.js';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MEDIOS_CLIENTE = ['efectivo', 'transferencia', 'tarjeta'];

export async function cargar() {
  const cfg = await cargarConfiguracion(true);
  const f = $('formAjustes');
  f.nombre_tienda.value = cfg.nombre_tienda;
  f.telefono.value = cfg.telefono ?? '';
  f.direccion.value = cfg.direccion ?? '';
  f.hora_inicio.value = cfg.hora_inicio.slice(0, 5);
  f.hora_fin.value = cfg.hora_fin.slice(0, 5);
  f.zona_horaria.value = cfg.zona_horaria;
  f.mensaje_fuera_horario.value = cfg.mensaje_fuera_horario;
  f.costo_envio.value = cfg.costo_envio;
  f.envio_gratis_desde.value = cfg.envio_gratis_desde ?? '';
  f.pedido_minimo.value = cfg.pedido_minimo;
  f.instrucciones_transferencia.value = cfg.instrucciones_transferencia ?? '';
  f.ticket_encabezado.value = cfg.ticket_encabezado;
  f.ticket_pie.value = cfg.ticket_pie;
  f.querySelectorAll('[name="dia"]').forEach((c) => {
    c.checked = cfg.dias_atencion.includes(Number(c.value));
  });
  f.querySelectorAll('[name="medio"]').forEach((c) => {
    c.checked = cfg.medios_pago.includes(c.value);
  });
}

async function guardar(f) {
  const dias = [...f.querySelectorAll('[name="dia"]:checked')].map((c) => Number(c.value));
  const medios = [...f.querySelectorAll('[name="medio"]:checked')].map((c) => c.value);
  if (!medios.length) throw new Error('Activa al menos un medio de pago.');
  const datos = {
    nombre_tienda: f.nombre_tienda.value.trim() || 'ModaNueva',
    telefono: textoOnull(f.telefono.value),
    direccion: textoOnull(f.direccion.value),
    hora_inicio: f.hora_inicio.value,
    hora_fin: f.hora_fin.value,
    dias_atencion: dias,
    zona_horaria: f.zona_horaria.value.trim() || 'America/Bogota',
    mensaje_fuera_horario: f.mensaje_fuera_horario.value.trim(),
    costo_envio: Number(f.costo_envio.value) || 0,
    envio_gratis_desde: numeroOnull(f.envio_gratis_desde.value),
    pedido_minimo: Number(f.pedido_minimo.value) || 0,
    medios_pago: medios,
    instrucciones_transferencia: textoOnull(f.instrucciones_transferencia.value),
    ticket_encabezado: f.ticket_encabezado.value.trim() || 'ModaNueva',
    ticket_pie: f.ticket_pie.value.trim()
  };
  const { error } = await db.from('configuracion').update(datos).eq('id', 1);
  if (error) throw error;
  await cargarConfiguracion(true);
  mostrarToast('Configuración guardada');
}

export function montar() {
  $('panel-ajustes').innerHTML = `
    <form id="formAjustes" class="grid gap-6 lg:grid-cols-2">
      <section class="space-y-3 rounded-2xl border border-tinta/15 bg-white/50 p-5">
        <h2 class="font-display text-xl font-bold">Tienda</h2>
        <label class="block text-sm font-medium">Nombre <input name="nombre_tienda" maxlength="80" class="campo"></label>
        <label class="block text-sm font-medium">Teléfono <input name="telefono" maxlength="30" class="campo"></label>
        <label class="block text-sm font-medium">Dirección <input name="direccion" maxlength="200" class="campo"></label>
      </section>

      <section class="space-y-3 rounded-2xl border border-tinta/15 bg-white/50 p-5">
        <h2 class="font-display text-xl font-bold">Horario de domicilios</h2>
        <div class="flex flex-wrap gap-x-4 gap-y-1">
          ${DIAS.map((d, i) => `<label class="flex items-center gap-1.5 text-sm"><input type="checkbox" name="dia" value="${i}" class="accent-arcilla"> ${d}</label>`).join('')}
        </div>
        <div class="grid grid-cols-2 gap-3">
          <label class="block text-sm font-medium">Desde <input name="hora_inicio" type="time" required class="campo"></label>
          <label class="block text-sm font-medium">Hasta <input name="hora_fin" type="time" required class="campo"></label>
        </div>
        <label class="block text-sm font-medium">Zona horaria <input name="zona_horaria" required class="campo"></label>
        <label class="block text-sm font-medium">Mensaje fuera de horario
          <textarea name="mensaje_fuera_horario" rows="2" maxlength="300" class="campo"></textarea></label>
      </section>

      <section class="space-y-3 rounded-2xl border border-tinta/15 bg-white/50 p-5">
        <h2 class="font-display text-xl font-bold">Envío y pedido mínimo</h2>
        <div class="grid grid-cols-3 gap-3">
          <label class="block text-sm font-medium">Costo envío <input name="costo_envio" type="number" min="0" step="100" class="campo"></label>
          <label class="block text-sm font-medium">Gratis desde <input name="envio_gratis_desde" type="number" min="0" step="1000" placeholder="Nunca" class="campo"></label>
          <label class="block text-sm font-medium">Mínimo <input name="pedido_minimo" type="number" min="0" step="1000" class="campo"></label>
        </div>
      </section>

      <section class="space-y-3 rounded-2xl border border-tinta/15 bg-white/50 p-5">
        <h2 class="font-display text-xl font-bold">Medios de pago</h2>
        <div class="flex flex-wrap gap-x-5 gap-y-1">
          ${MEDIOS_CLIENTE.map((m) => `<label class="flex items-center gap-1.5 text-sm"><input type="checkbox" name="medio" value="${m}" class="accent-arcilla"> ${ETIQUETAS_PAGO[m]}</label>`).join('')}
        </div>
        <label class="block text-sm font-medium">Instrucciones de transferencia
          <textarea name="instrucciones_transferencia" rows="3" maxlength="500" placeholder="Banco, tipo y número de cuenta, titular…" class="campo"></textarea></label>
        <p class="text-xs text-tinta/60">Activa «Tarjeta» solo cuando Stripe esté configurado (llaves en Supabase). Si no, los clientes verían un error al pagar.</p>
      </section>

      <section class="space-y-3 rounded-2xl border border-tinta/15 bg-white/50 p-5 lg:col-span-2">
        <h2 class="font-display text-xl font-bold">Ticket</h2>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block text-sm font-medium">Encabezado <input name="ticket_encabezado" maxlength="80" class="campo"></label>
          <label class="block text-sm font-medium">Pie de página <input name="ticket_pie" maxlength="120" class="campo"></label>
        </div>
      </section>

      <div class="lg:col-span-2"><button type="submit" class="boton-principal">Guardar configuración</button></div>
    </form>`;

  const f = $('formAjustes');
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const boton = f.querySelector('button[type="submit"]');
    boton.disabled = true;
    seguro(() => guardar(f)).finally(() => {
      boton.disabled = false;
    });
  });
}
