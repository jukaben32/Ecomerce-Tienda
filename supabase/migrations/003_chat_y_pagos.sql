-- ================================================================
-- ModaNueva · Migración 003: chat con IA y pagos con Stripe
-- ----------------------------------------------------------------
-- Ejecutar DESPUÉS de 002_nivel_pro.sql.
--
--   1. chat_uso       -> límite de mensajes por usuario (anti-abuso)
--   2. ordenes        -> columnas para el pago con Stripe
--   3. Webhook idempotente: marca la orden como pagada una sola vez
-- ================================================================

-- 1) Registro de uso del chat. Solo la Edge Function (service_role) lo toca:
--    con RLS activado y SIN políticas, nadie más puede leer ni escribir.
create table if not exists public.chat_uso (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.perfiles(id) on delete cascade,
  creado_en  timestamptz not null default now()
);
create index if not exists idx_chat_uso_usuario on public.chat_uso(user_id, creado_en desc);
alter table public.chat_uso enable row level security;
revoke all on public.chat_uso from anon, authenticated;

-- 2) Datos del pago con tarjeta (Stripe)
alter table public.ordenes
  add column if not exists stripe_session_id text,
  add column if not exists pagada_en         timestamptz;

create unique index if not exists uq_ordenes_stripe_session
  on public.ordenes(stripe_session_id) where stripe_session_id is not null;

-- 3) Marca una orden como pagada (la llama el webhook con service_role).
--    Solo cambia pendiente -> pagada; si ya estaba pagada no hace nada.
create or replace function public.marcar_orden_pagada(p_orden bigint, p_session text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_filas integer;
begin
  update public.ordenes
     set estado = 'pagada', pagada_en = now(), stripe_session_id = coalesce(p_session, stripe_session_id)
   where id = p_orden and estado = 'pendiente';
  get diagnostics v_filas = row_count;
  return v_filas > 0;
end;
$$;
revoke all on function public.marcar_orden_pagada(bigint, text) from public, anon, authenticated;
grant execute on function public.marcar_orden_pagada(bigint, text) to service_role;

-- Texto de ayuda para el admin: el medio "tarjeta" ahora es pago en línea (Stripe)
comment on column public.ordenes.stripe_session_id is 'Sesión de Stripe Checkout asociada al pago con tarjeta';
