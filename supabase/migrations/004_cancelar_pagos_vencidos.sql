-- ================================================================
-- ModaNueva · Migración 004: liberar el stock de pagos abandonados
-- ----------------------------------------------------------------
-- Un pedido con tarjeta reserva stock apenas se crea. Si el cliente
-- abandona la página de Stripe, ese stock quedaría retenido para
-- siempre. Esta tarea cancela (y devuelve el stock de) los pedidos
-- de tarjeta que siguen pendientes tras 26 horas. Stripe vence sus
-- links a las 24 horas, así que ya no se pueden pagar.
-- ================================================================

create or replace function public.cancelar_pagos_vencidos()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_filas integer;
begin
  -- El trigger trg_ordenes_stock devuelve las existencias al pasar a 'cancelada'
  update public.ordenes
     set estado = 'cancelada',
         notas = left(coalesce(notas || ' | ', '') || 'Cancelada automáticamente: pago con tarjeta no completado', 500)
   where estado = 'pendiente'
     and metodo_pago = 'tarjeta'
     and realizada_en < now() - interval '26 hours';
  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;
revoke all on function public.cancelar_pagos_vencidos() from public, anon, authenticated;
grant execute on function public.cancelar_pagos_vencidos() to service_role;

-- Programación cada hora con pg_cron (extensión incluida en Supabase)
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('cancelar-pagos-vencidos')
  where exists (select 1 from cron.job where jobname = 'cancelar-pagos-vencidos');
  perform cron.schedule('cancelar-pagos-vencidos', '15 * * * *', 'select public.cancelar_pagos_vencidos();');
end $$;
