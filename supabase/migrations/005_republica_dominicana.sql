-- ================================================================
-- ModaNueva · Migración 005: República Dominicana, transferencia y
--                            pago contra entrega
-- ----------------------------------------------------------------
-- Ejecutar DESPUÉS de 004_cancelar_pagos_vencidos.sql.
--
--   1. Moneda DOP, hora de Santo Domingo y precios de ejemplo en RD$
--   2. Nuevo medio de pago "datafono" (tarjeta contra entrega)
--   3. Comprobantes de transferencia (bucket privado + función segura)
--   4. WhatsApp de la tienda (para recibir comprobantes)
-- ================================================================

-- ----------------------------------------------------------------
-- 1) Moneda y zona horaria
-- ----------------------------------------------------------------
alter table public.configuracion
  add column if not exists moneda   char(3) not null default 'DOP',
  add column if not exists whatsapp text check (char_length(whatsapp) <= 30);

update public.configuracion
   set moneda = 'DOP',
       zona_horaria = 'America/Santo_Domingo'
 where id = 1;

alter table public.productos alter column moneda set default 'DOP';
alter table public.ordenes   alter column moneda set default 'DOP';
update public.productos set moneda = 'DOP' where moneda <> 'DOP';
update public.ordenes   set moneda = 'DOP' where moneda <> 'DOP';

-- Precios de ejemplo en RD$ (solo si siguen con el valor original en COP,
-- para no pisar precios que ya hayas cambiado a mano)
update public.productos p set precio = v.nuevo
  from (values
    ('MUJ-001',  89900, 1800), ('MUJ-002', 149900, 3200), ('MUJ-003', 129900, 2600),
    ('HOM-001',  99900, 2000), ('HOM-002', 119900, 2400), ('HOM-003',  49900,  950),
    ('NIN-001',  79900, 1500), ('NIN-002',  69900, 1400),
    ('ACC-001',  59900, 1200), ('ACC-002',  39900,  800)
  ) as v(sku, viejo, nuevo)
 where p.sku = v.sku and p.precio = v.viejo;

-- ----------------------------------------------------------------
-- 2) Medio de pago "datafono" (tarjeta contra entrega)
-- ----------------------------------------------------------------
alter table public.ordenes drop constraint if exists ordenes_metodo_pago_check;
alter table public.ordenes add constraint ordenes_metodo_pago_check
  check (metodo_pago in ('efectivo','datafono','transferencia','tarjeta','link_pago'));

-- El admin puede montar pedidos con cualquier medio (incluido el nuevo)
create or replace function public.crear_orden_admin(
  p_cliente       uuid,
  p_items         jsonb,
  p_direccion     text,
  p_metodo_pago   text,
  p_notas         text default null,
  p_telefono      text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede montar pedidos';
  end if;
  if not exists (select 1 from public.perfiles where id = p_cliente) then
    raise exception 'El cliente no existe';
  end if;
  if p_metodo_pago not in ('efectivo','datafono','transferencia','tarjeta','link_pago') then
    raise exception 'Medio de pago inválido';
  end if;
  return public.crear_orden_interna(p_cliente, p_items, p_direccion, p_metodo_pago, p_notas, p_telefono, 'admin');
end;
$$;
revoke all on function public.crear_orden_admin(uuid, jsonb, text, text, text, text) from public, anon;
grant execute on function public.crear_orden_admin(uuid, jsonb, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------
-- 3) Comprobantes de transferencia
-- ----------------------------------------------------------------
alter table public.ordenes
  add column if not exists comprobante_path        text,
  add column if not exists comprobante_subido_en   timestamptz;

-- Bucket PRIVADO: solo el dueño de la carpeta y los admin pueden ver los archivos.
-- Cada cliente sube dentro de una carpeta con su propio id: <uid>/<archivo>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 5242880,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

drop policy if exists comprobantes_subir on storage.objects;
create policy comprobantes_subir on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comprobantes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists comprobantes_ver on storage.objects;
create policy comprobantes_ver on storage.objects
  for select to authenticated
  using (bucket_id = 'comprobantes'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.es_admin()));

drop policy if exists comprobantes_borrar_admin on storage.objects;
create policy comprobantes_borrar_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'comprobantes' and public.es_admin());

-- Asocia un comprobante ya subido a una orden. El cliente solo puede hacerlo
-- sobre SU orden pendiente pagada por transferencia, y solo con un archivo
-- que esté dentro de su propia carpeta.
create or replace function public.adjuntar_comprobante(p_orden bigint, p_ruta text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_orden public.ordenes%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión';
  end if;
  select * into v_orden from public.ordenes where id = p_orden and cliente_id = auth.uid();
  if not found then
    raise exception 'La orden no existe';
  end if;
  if v_orden.metodo_pago <> 'transferencia' then
    raise exception 'Esta orden no es de pago por transferencia';
  end if;
  if v_orden.estado <> 'pendiente' then
    raise exception 'Esta orden ya no está pendiente de pago';
  end if;
  if p_ruta is null or p_ruta not like auth.uid()::text || '/%' or char_length(p_ruta) > 300 then
    raise exception 'Archivo inválido';
  end if;
  update public.ordenes
     set comprobante_path = p_ruta, comprobante_subido_en = now()
   where id = p_orden;
end;
$$;
revoke all on function public.adjuntar_comprobante(bigint, text) from public, anon;
grant execute on function public.adjuntar_comprobante(bigint, text) to authenticated;
