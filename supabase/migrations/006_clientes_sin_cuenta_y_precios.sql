-- ================================================================
-- ModaNueva · Migración 006: clientes sin cuenta y precios con IA
-- ----------------------------------------------------------------
-- Ejecutar DESPUÉS de 005_republica_dominicana.sql.
--
--   1. clientes_manuales -> clientes que piden por teléfono/WhatsApp
--                           y no tienen cuenta en la tienda
--   2. ordenes           -> pueden pertenecer a un cliente con cuenta
--                           O a uno sin cuenta (exactamente uno)
--   3. Funciones de pedido actualizadas + crear_orden_admin_manual
--   4. Historial de cambios de precios (con "deshacer")
-- ================================================================

-- ----------------------------------------------------------------
-- 1) CLIENTES SIN CUENTA (solo los gestiona el admin)
-- ----------------------------------------------------------------
create table if not exists public.clientes_manuales (
  id          bigint generated always as identity primary key,
  nombre      text not null check (char_length(nombre) between 1 and 120),
  telefono    text check (char_length(telefono) <= 30),
  direccion   text check (char_length(direccion) <= 250),
  notas       text check (char_length(notas) <= 300),
  creado_por  uuid references public.perfiles(id) on delete set null,
  creado_en   timestamptz not null default now()
);
create index if not exists idx_clientes_manuales_tel on public.clientes_manuales(telefono);

alter table public.clientes_manuales enable row level security;
drop policy if exists clientes_manuales_admin on public.clientes_manuales;
create policy clientes_manuales_admin on public.clientes_manuales
  for all using (public.es_admin()) with check (public.es_admin());

-- ----------------------------------------------------------------
-- 2) ORDENES: cliente con cuenta O cliente sin cuenta
-- ----------------------------------------------------------------
alter table public.ordenes alter column cliente_id drop not null;
alter table public.ordenes
  add column if not exists cliente_manual_id bigint references public.clientes_manuales(id) on delete restrict;
create index if not exists idx_ordenes_manual on public.ordenes(cliente_manual_id);

alter table public.ordenes drop constraint if exists ordenes_un_cliente;
alter table public.ordenes add constraint ordenes_un_cliente
  check ((cliente_id is not null)::int + (cliente_manual_id is not null)::int = 1);

-- Resumen de clientes sin cuenta (pedidos y total comprado)
create or replace view public.clientes_manuales_resumen
with (security_invoker = true) as
select
  m.id, m.nombre, m.telefono, m.direccion, m.notas, m.creado_en,
  count(o.id) filter (where o.estado not in ('cancelada','reembolsada')) as pedidos,
  coalesce(sum(o.total) filter (where o.estado not in ('cancelada','reembolsada')), 0) as total_comprado,
  max(o.realizada_en) as ultimo_pedido
from public.clientes_manuales m
left join public.ordenes o on o.cliente_manual_id = m.id
group by m.id;
grant select on public.clientes_manuales_resumen to authenticated;

-- ----------------------------------------------------------------
-- 3) FUNCIONES DE PEDIDO (ahora aceptan cliente con o sin cuenta)
-- ----------------------------------------------------------------
drop function if exists public.crear_orden_interna(uuid, jsonb, text, text, text, text, text);

create or replace function public.crear_orden_interna(
  p_cliente   uuid,
  p_manual    bigint,
  p_items     jsonb,
  p_direccion text,
  p_metodo    text,
  p_notas     text,
  p_telefono  text,
  p_canal     text
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_cfg      public.configuracion%rowtype;
  v_orden_id bigint;
  v_subtotal numeric(14,2) := 0;
  v_envio    numeric(12,2) := 0;
  v_item     jsonb;
  v_prod     record;
  v_cant     integer;
  v_fuera    boolean;
begin
  select * into v_cfg from public.configuracion where id = 1;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío';
  end if;
  if p_direccion is null or char_length(btrim(p_direccion)) < 5 then
    raise exception 'Indica una dirección de entrega';
  end if;

  v_fuera := not coalesce(public.en_horario(), true);

  insert into public.ordenes
    (cliente_id, cliente_manual_id, direccion_entrega, telefono_contacto, metodo_pago, notas, canal, fuera_de_horario)
  values
    (p_cliente, p_manual, btrim(p_direccion), nullif(btrim(p_telefono), ''), p_metodo, nullif(btrim(p_notas), ''), p_canal, v_fuera)
  returning id into v_orden_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant := (v_item ->> 'cantidad')::integer;
    if v_cant is null or v_cant <= 0 then
      raise exception 'Cantidad inválida en el carrito';
    end if;

    -- Bloqueamos la fila para que dos compras simultáneas no vendan el mismo stock
    select p.id, p.sku, p.nombre, p.existencias, p.activo,
           round(p.precio * (1 - coalesce(
             case
               when p.descuento_activo and coalesce(p.descuento_pct, 0) > 0 then p.descuento_pct
               when c.descuento_activo and coalesce(c.descuento_pct, 0) > 0 then c.descuento_pct
             end, 0) / 100), 2) as precio_final
      into v_prod
      from public.productos p
      left join public.categorias c on c.id = p.categoria_id
     where p.id = (v_item ->> 'producto_id')::bigint
       for update of p;

    if not found then
      raise exception 'Uno de los productos ya no existe';
    end if;
    if not v_prod.activo then
      raise exception 'El producto "%" ya no está disponible', v_prod.nombre;
    end if;
    if v_prod.existencias < v_cant then
      raise exception 'Stock insuficiente para "%" (quedan %)', v_prod.nombre, v_prod.existencias;
    end if;

    insert into public.items_orden (orden_id, producto_id, sku, nombre_producto, precio_unitario, cantidad)
    values (v_orden_id, v_prod.id, v_prod.sku, v_prod.nombre, v_prod.precio_final, v_cant);

    update public.productos set existencias = existencias - v_cant where id = v_prod.id;
    v_subtotal := v_subtotal + (v_prod.precio_final * v_cant);
  end loop;

  -- Pedido mínimo (no aplica a pedidos montados por el admin)
  if p_canal <> 'admin' and v_subtotal < v_cfg.pedido_minimo then
    raise exception 'El pedido mínimo es de $ %', to_char(v_cfg.pedido_minimo, 'FM999G999G999');
  end if;

  v_envio := case
    when v_cfg.envio_gratis_desde is not null and v_subtotal >= v_cfg.envio_gratis_desde then 0
    else v_cfg.costo_envio
  end;

  update public.ordenes
     set subtotal = v_subtotal, costo_envio = v_envio, total = v_subtotal + v_envio
   where id = v_orden_id;

  return jsonb_build_object(
    'orden_id', v_orden_id,
    'subtotal', v_subtotal,
    'costo_envio', v_envio,
    'total', v_subtotal + v_envio,
    'fuera_de_horario', v_fuera,
    'mensaje_horario', case when v_fuera then v_cfg.mensaje_fuera_horario else null end
  );
end;
$$;
revoke all on function public.crear_orden_interna(uuid, bigint, jsonb, text, text, text, text, text)
  from public, anon, authenticated;

-- Compra del cliente autenticado (sin cambios de comportamiento)
create or replace function public.crear_orden(
  p_items         jsonb,
  p_direccion     text,
  p_metodo_pago   text,
  p_notas         text default null,
  p_telefono      text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_medios text[];
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para comprar';
  end if;
  select medios_pago into v_medios from public.configuracion where id = 1;
  if p_metodo_pago is null or not (p_metodo_pago = any (v_medios)) then
    raise exception 'Ese medio de pago no está disponible';
  end if;
  return public.crear_orden_interna(auth.uid(), null, p_items, p_direccion, p_metodo_pago, p_notas, p_telefono, 'web');
end;
$$;
revoke all on function public.crear_orden(jsonb, text, text, text, text) from public, anon;
grant execute on function public.crear_orden(jsonb, text, text, text, text) to authenticated;

-- Pedido del admin a nombre de un cliente CON cuenta
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
  return public.crear_orden_interna(p_cliente, null, p_items, p_direccion, p_metodo_pago, p_notas, p_telefono, 'admin');
end;
$$;
revoke all on function public.crear_orden_admin(uuid, jsonb, text, text, text, text) from public, anon;
grant execute on function public.crear_orden_admin(uuid, jsonb, text, text, text, text) to authenticated;

-- Pedido del admin a nombre de un cliente SIN cuenta (teléfono / WhatsApp)
create or replace function public.crear_orden_admin_manual(
  p_cliente_manual bigint,
  p_items          jsonb,
  p_direccion      text,
  p_metodo_pago    text,
  p_notas          text default null,
  p_telefono       text default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede montar pedidos';
  end if;
  if not exists (select 1 from public.clientes_manuales where id = p_cliente_manual) then
    raise exception 'El cliente no existe';
  end if;
  if p_metodo_pago not in ('efectivo','datafono','transferencia','tarjeta','link_pago') then
    raise exception 'Medio de pago inválido';
  end if;
  return public.crear_orden_interna(null, p_cliente_manual, p_items, p_direccion, p_metodo_pago, p_notas, p_telefono, 'admin');
end;
$$;
revoke all on function public.crear_orden_admin_manual(bigint, jsonb, text, text, text, text) from public, anon;
grant execute on function public.crear_orden_admin_manual(bigint, jsonb, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------
-- 4) HISTORIAL DE PRECIOS (con deshacer)
-- ----------------------------------------------------------------
create table if not exists public.lotes_precios (
  id           uuid primary key default gen_random_uuid(),
  creado_por   uuid references public.perfiles(id) on delete set null,
  instruccion  text not null check (char_length(instruccion) <= 500),
  cambios      integer not null,
  creado_en    timestamptz not null default now(),
  revertido_en timestamptz
);

create table if not exists public.historial_precios (
  id                   bigint generated always as identity primary key,
  lote_id              uuid not null references public.lotes_precios(id) on delete cascade,
  producto_id          bigint not null references public.productos(id) on delete cascade,
  precio_anterior      numeric(12,2) not null,
  precio_nuevo         numeric(12,2) not null,
  desc_pct_anterior    numeric(5,2),
  desc_activo_anterior boolean not null,
  desc_pct_nuevo       numeric(5,2),
  desc_activo_nuevo    boolean not null
);
create index if not exists idx_historial_lote on public.historial_precios(lote_id);

alter table public.lotes_precios     enable row level security;
alter table public.historial_precios enable row level security;
drop policy if exists lotes_admin_leer on public.lotes_precios;
create policy lotes_admin_leer on public.lotes_precios for select using (public.es_admin());
drop policy if exists historial_admin_leer on public.historial_precios;
create policy historial_admin_leer on public.historial_precios for select using (public.es_admin());
-- Sin políticas de escritura: solo las funciones de abajo (security definer) modifican estas tablas.

-- Aplica una lista de cambios ya revisados por el admin, en una sola transacción.
-- p_cambios: [{ "producto_id": 1, "precio_nuevo": 1900, "descuento_pct": 10, "descuento_activo": true }, ...]
-- Solo se tocan las claves presentes en cada elemento.
create or replace function public.aplicar_cambios_precios(p_instruccion text, p_cambios jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_lote   uuid;
  v_item   jsonb;
  v_prod   public.productos%rowtype;
  v_precio numeric(12,2);
  v_pct    numeric(5,2);
  v_activo boolean;
  v_total  integer := 0;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede cambiar precios';
  end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'array' or jsonb_array_length(p_cambios) = 0 then
    raise exception 'No hay cambios para aplicar';
  end if;
  if jsonb_array_length(p_cambios) > 500 then
    raise exception 'Máximo 500 productos por cambio';
  end if;

  insert into public.lotes_precios (creado_por, instruccion, cambios)
  values (auth.uid(), left(coalesce(nullif(btrim(p_instruccion), ''), '(sin descripción)'), 500), 0)
  returning id into v_lote;

  for v_item in select * from jsonb_array_elements(p_cambios) loop
    select * into v_prod from public.productos where id = (v_item ->> 'producto_id')::bigint for update;
    if not found then
      raise exception 'Uno de los productos ya no existe';
    end if;

    v_precio := v_prod.precio;
    v_pct    := v_prod.descuento_pct;
    v_activo := v_prod.descuento_activo;

    if v_item ? 'precio_nuevo' and jsonb_typeof(v_item -> 'precio_nuevo') = 'number' then
      v_precio := (v_item ->> 'precio_nuevo')::numeric;
      if v_precio < 0 or v_precio > 100000000 then
        raise exception 'Precio fuera de rango para "%"', v_prod.nombre;
      end if;
    end if;
    if v_item ? 'descuento_pct' then
      v_pct := case when jsonb_typeof(v_item -> 'descuento_pct') = 'null' then null
                    else (v_item ->> 'descuento_pct')::numeric end;
      if v_pct is not null and (v_pct < 0 or v_pct > 100) then
        raise exception 'Descuento fuera de rango para "%"', v_prod.nombre;
      end if;
    end if;
    if v_item ? 'descuento_activo' then
      v_activo := (v_item ->> 'descuento_activo')::boolean;
    end if;

    if v_precio is not distinct from v_prod.precio
       and v_pct is not distinct from v_prod.descuento_pct
       and v_activo is not distinct from v_prod.descuento_activo then
      continue; -- sin cambios reales
    end if;

    insert into public.historial_precios
      (lote_id, producto_id, precio_anterior, precio_nuevo,
       desc_pct_anterior, desc_activo_anterior, desc_pct_nuevo, desc_activo_nuevo)
    values
      (v_lote, v_prod.id, v_prod.precio, v_precio,
       v_prod.descuento_pct, v_prod.descuento_activo, v_pct, v_activo);

    update public.productos
       set precio = v_precio, descuento_pct = v_pct, descuento_activo = v_activo
     where id = v_prod.id;
    v_total := v_total + 1;
  end loop;

  if v_total = 0 then
    raise exception 'Ningún producto cambiaría con esta instrucción';
  end if;
  update public.lotes_precios set cambios = v_total where id = v_lote;
  return jsonb_build_object('lote', v_lote, 'cambios', v_total);
end;
$$;
revoke all on function public.aplicar_cambios_precios(text, jsonb) from public, anon;
grant execute on function public.aplicar_cambios_precios(text, jsonb) to authenticated;

-- Deshace un lote. Solo revierte los productos que NO se han vuelto a cambiar
-- después (para no pisar ediciones posteriores).
create or replace function public.revertir_lote_precios(p_lote uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_lote       public.lotes_precios%rowtype;
  v_revertidos integer := 0;
  v_omitidos   integer := 0;
  h            public.historial_precios%rowtype;
  v_p          public.productos%rowtype;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede deshacer cambios de precios';
  end if;
  select * into v_lote from public.lotes_precios where id = p_lote for update;
  if not found then
    raise exception 'El cambio no existe';
  end if;
  if v_lote.revertido_en is not null then
    raise exception 'Este cambio ya fue deshecho';
  end if;

  for h in select * from public.historial_precios where lote_id = p_lote loop
    select * into v_p from public.productos where id = h.producto_id for update;
    if found
       and v_p.precio = h.precio_nuevo
       and v_p.descuento_pct is not distinct from h.desc_pct_nuevo
       and v_p.descuento_activo = h.desc_activo_nuevo then
      update public.productos
         set precio = h.precio_anterior,
             descuento_pct = h.desc_pct_anterior,
             descuento_activo = h.desc_activo_anterior
       where id = h.producto_id;
      v_revertidos := v_revertidos + 1;
    else
      v_omitidos := v_omitidos + 1;
    end if;
  end loop;

  update public.lotes_precios set revertido_en = now() where id = p_lote;
  return jsonb_build_object('revertidos', v_revertidos, 'omitidos', v_omitidos);
end;
$$;
revoke all on function public.revertir_lote_precios(uuid) from public, anon;
grant execute on function public.revertir_lote_precios(uuid) to authenticated;
