-- ================================================================
-- ModaNueva · Migración 002: "nivel pro"
-- ----------------------------------------------------------------
-- Ejecutar DESPUÉS de supabase/schema.sql (SQL Editor > Run).
--
-- Agrega:
--   1. configuracion   -> horario de domicilios, envío, medios de pago, ticket
--   2. direcciones     -> libreta de direcciones de cada cliente
--   3. ordenes         -> dirección, medio de pago, notas, envío, canal
--   4. crear_orden     -> ahora valida horario, mínimo, envío y medio de pago
--      crear_orden_admin -> el admin monta pedidos a nombre de un cliente
--   5. calificaciones  -> el cliente califica pedidos entregados
--   6. promociones     -> volantes/banners que se ven en la tienda
--   7. Storage "medios"-> imágenes subidas desde el admin
--   8. conocimiento_ia / incidencias_ia -> base para el asistente con IA
--   9. resumen_ventas / clientes_resumen -> dashboard y panel de clientes
--  10. Devolución automática de stock al cancelar o reembolsar
-- ================================================================

-- ----------------------------------------------------------------
-- 1) CONFIGURACIÓN (una sola fila, id = 1)
-- ----------------------------------------------------------------
create table if not exists public.configuracion (
  id                          smallint primary key default 1 check (id = 1),
  nombre_tienda               text not null default 'ModaNueva',
  telefono                    text,
  direccion                   text,
  -- Horario de domicilios. dias_atencion: 0 = domingo ... 6 = sábado
  hora_inicio                 time not null default '08:00',
  hora_fin                    time not null default '18:00',
  dias_atencion               smallint[] not null default '{1,2,3,4,5,6}',
  zona_horaria                text not null default 'America/Bogota',
  mensaje_fuera_horario       text not null default 'Recibimos tu pedido fuera del horario de domicilios. Lo gestionamos en el próximo horario de atención.',
  costo_envio                 numeric(12,2) not null default 0 check (costo_envio >= 0),
  envio_gratis_desde          numeric(12,2) check (envio_gratis_desde is null or envio_gratis_desde >= 0),
  pedido_minimo               numeric(12,2) not null default 0 check (pedido_minimo >= 0),
  -- Medios de pago que ve el cliente: efectivo | transferencia | tarjeta
  medios_pago                 text[] not null default '{efectivo,transferencia,tarjeta}',
  instrucciones_transferencia text,
  ticket_encabezado           text not null default 'ModaNueva',
  ticket_pie                  text not null default '¡Gracias por tu compra!',
  actualizado_en              timestamptz not null default now()
);
insert into public.configuracion (id) values (1) on conflict (id) do nothing;

drop trigger if exists trg_configuracion_upd on public.configuracion;
create trigger trg_configuracion_upd before update on public.configuracion
  for each row execute function public.tocar_actualizado_en();

-- ¿Estamos dentro del horario de domicilios ahora mismo?
create or replace function public.en_horario()
returns boolean
language sql stable
set search_path = public
as $$
  select
    extract(dow from (now() at time zone c.zona_horaria))::smallint = any (c.dias_atencion)
    and (now() at time zone c.zona_horaria)::time between c.hora_inicio and c.hora_fin
  from public.configuracion c
  where c.id = 1;
$$;

-- ----------------------------------------------------------------
-- 2) DIRECCIONES
-- ----------------------------------------------------------------
create table if not exists public.direcciones (
  id          bigint generated always as identity primary key,
  cliente_id  uuid not null references public.perfiles(id) on delete cascade,
  etiqueta    text not null default 'Casa' check (char_length(etiqueta) <= 40),
  direccion   text not null check (char_length(direccion) between 5 and 200),
  barrio      text check (char_length(barrio) <= 80),
  ciudad      text not null default '' check (char_length(ciudad) <= 80),
  referencias text check (char_length(referencias) <= 200),
  telefono    text check (char_length(telefono) <= 30),
  es_principal boolean not null default false,
  creado_en   timestamptz not null default now()
);
create index if not exists idx_direcciones_cliente on public.direcciones(cliente_id);
-- Solo puede haber UNA dirección principal por cliente
create unique index if not exists uq_direccion_principal
  on public.direcciones(cliente_id) where es_principal;

-- ----------------------------------------------------------------
-- 3) NUEVAS COLUMNAS EN ORDENES
-- ----------------------------------------------------------------
alter table public.ordenes
  add column if not exists direccion_entrega  text,
  add column if not exists telefono_contacto  text,
  add column if not exists metodo_pago        text
    check (metodo_pago in ('efectivo','transferencia','tarjeta','link_pago')),
  add column if not exists notas              text check (char_length(notas) <= 500),
  add column if not exists subtotal           numeric(12,2) not null default 0,
  add column if not exists costo_envio        numeric(12,2) not null default 0,
  add column if not exists canal              text not null default 'web'
    check (canal in ('web','admin','chat')),
  add column if not exists fuera_de_horario   boolean not null default false;

-- ----------------------------------------------------------------
-- 4) CREAR ORDEN (versión completa)
-- ----------------------------------------------------------------
drop function if exists public.crear_orden(jsonb);

-- Núcleo compartido. NO se expone a los clientes (solo lo llaman las
-- dos funciones públicas de abajo, que validan quién es quién).
create or replace function public.crear_orden_interna(
  p_cliente   uuid,
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

  insert into public.ordenes (cliente_id, direccion_entrega, telefono_contacto, metodo_pago, notas, canal, fuera_de_horario)
  values (p_cliente, btrim(p_direccion), nullif(btrim(p_telefono), ''), p_metodo, nullif(btrim(p_notas), ''), p_canal, v_fuera)
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
revoke all on function public.crear_orden_interna(uuid, jsonb, text, text, text, text, text) from public, anon, authenticated;

-- Compra del cliente autenticado
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
  return public.crear_orden_interna(auth.uid(), p_items, p_direccion, p_metodo_pago, p_notas, p_telefono, 'web');
end;
$$;
revoke all on function public.crear_orden(jsonb, text, text, text, text) from public, anon;
grant execute on function public.crear_orden(jsonb, text, text, text, text) to authenticated;

-- Pedido montado por un admin a nombre de un cliente
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
  if p_metodo_pago not in ('efectivo','transferencia','tarjeta','link_pago') then
    raise exception 'Medio de pago inválido';
  end if;
  return public.crear_orden_interna(p_cliente, p_items, p_direccion, p_metodo_pago, p_notas, p_telefono, 'admin');
end;
$$;
revoke all on function public.crear_orden_admin(uuid, jsonb, text, text, text, text) from public, anon;
grant execute on function public.crear_orden_admin(uuid, jsonb, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------
-- 5) CALIFICACIONES (una por pedido entregado)
-- ----------------------------------------------------------------
create table if not exists public.calificaciones (
  id          bigint generated always as identity primary key,
  orden_id    bigint not null unique references public.ordenes(id) on delete cascade,
  cliente_id  uuid not null references public.perfiles(id) on delete cascade,
  estrellas   smallint not null check (estrellas between 1 and 5),
  comentario  text check (char_length(comentario) <= 500),
  creado_en   timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- 6) PROMOCIONES / VOLANTES
-- ----------------------------------------------------------------
create table if not exists public.promociones (
  id          bigint generated always as identity primary key,
  titulo      text not null check (char_length(titulo) <= 120),
  descripcion text check (char_length(descripcion) <= 300),
  imagen_url  text not null,
  enlace      text,
  activo      boolean not null default true,
  orden       integer not null default 0,
  creado_en   timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- 7) ASISTENTE IA: conocimiento extra e incidencias
--    (las llena la Edge Function del chat; el admin las gestiona)
-- ----------------------------------------------------------------
create table if not exists public.conocimiento_ia (
  id         bigint generated always as identity primary key,
  titulo     text not null check (char_length(titulo) <= 120),
  contenido  text not null check (char_length(contenido) <= 2000),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

create table if not exists public.incidencias_ia (
  id           bigint generated always as identity primary key,
  cliente_id   uuid references public.perfiles(id) on delete set null,
  pregunta     text not null,
  respuesta_ia text,
  estado       text not null default 'abierta' check (estado in ('abierta','resuelta')),
  resolucion   text,
  creado_en    timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- 8) DEVOLVER STOCK al cancelar / reembolsar una orden
-- ----------------------------------------------------------------
create or replace function public.devolver_stock_si_cancela()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.estado in ('cancelada','reembolsada')
     and old.estado not in ('cancelada','reembolsada') then
    update public.productos p
       set existencias = p.existencias + i.cantidad
      from public.items_orden i
     where i.orden_id = new.id and i.producto_id = p.id;
  elsif old.estado in ('cancelada','reembolsada')
        and new.estado not in ('cancelada','reembolsada') then
    raise exception 'No se puede reactivar una orden cancelada. Crea un pedido nuevo.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_ordenes_stock on public.ordenes;
create trigger trg_ordenes_stock before update of estado on public.ordenes
  for each row execute function public.devolver_stock_si_cancela();

-- ----------------------------------------------------------------
-- 9) VISTAS Y REPORTES PARA EL ADMIN
-- ----------------------------------------------------------------
-- Clientes con su número de pedidos y total comprado.
-- security_invoker: un cliente normal solo vería su propia fila.
create or replace view public.clientes_resumen
with (security_invoker = true) as
select
  p.id, p.nombre, p.apellido, p.correo, p.telefono, p.rol, p.creado_en,
  count(o.id) filter (where o.estado not in ('cancelada','reembolsada')) as pedidos,
  coalesce(sum(o.total) filter (where o.estado not in ('cancelada','reembolsada')), 0) as total_comprado,
  max(o.realizada_en) as ultimo_pedido
from public.perfiles p
left join public.ordenes o on o.cliente_id = p.id
group by p.id;
grant select on public.clientes_resumen to authenticated;

-- Reporte de ventas entre dos fechas (solo admin)
create or replace function public.resumen_ventas(p_desde date, p_hasta date)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_zona text;
  v_res  jsonb;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede ver los reportes';
  end if;
  select zona_horaria into v_zona from public.configuracion where id = 1;

  with base as (
    select o.*, (o.realizada_en at time zone v_zona)::date as dia
      from public.ordenes o
     where (o.realizada_en at time zone v_zona)::date between p_desde and p_hasta
  ),
  validas as (select * from base where estado not in ('cancelada','reembolsada'))
  select jsonb_build_object(
    'pedidos',         (select count(*) from validas),
    'ventas',          coalesce((select sum(total) from validas), 0),
    'ticket_promedio', coalesce((select round(avg(total), 0) from validas), 0),
    'pendientes',      (select count(*) from base where estado = 'pendiente'),
    'por_estado', coalesce((select jsonb_agg(jsonb_build_object('estado', estado, 'cantidad', n))
                    from (select estado, count(*) n from base group by estado order by n desc) s), '[]'),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'ventas', v, 'pedidos', n) order by dia)
                    from (select dia, sum(total) v, count(*) n from validas group by dia) s), '[]'),
    'por_metodo', coalesce((select jsonb_agg(jsonb_build_object('metodo', coalesce(metodo_pago,'sin dato'), 'ventas', v, 'pedidos', n))
                    from (select metodo_pago, sum(total) v, count(*) n from validas group by metodo_pago order by v desc) s), '[]'),
    'top_productos', coalesce((select jsonb_agg(jsonb_build_object('nombre', nombre_producto, 'unidades', u, 'ventas', v))
                    from (select i.nombre_producto, sum(i.cantidad) u, sum(i.total_renglon) v
                            from public.items_orden i join validas o on o.id = i.orden_id
                           group by i.nombre_producto order by u desc limit 8) s), '[]'),
    'calificacion_promedio', (select round(avg(c.estrellas), 2)
                    from public.calificaciones c join base o on o.id = c.orden_id)
  ) into v_res;

  return v_res;
end;
$$;
revoke all on function public.resumen_ventas(date, date) from public, anon;
grant execute on function public.resumen_ventas(date, date) to authenticated;

-- ----------------------------------------------------------------
-- 10) SEGURIDAD POR FILAS (RLS) de las tablas nuevas
-- ----------------------------------------------------------------
alter table public.configuracion   enable row level security;
alter table public.direcciones     enable row level security;
alter table public.calificaciones  enable row level security;
alter table public.promociones     enable row level security;
alter table public.conocimiento_ia enable row level security;
alter table public.incidencias_ia  enable row level security;

-- Configuración: la lee cualquiera (el horario y el envío se muestran en la tienda)
drop policy if exists config_leer on public.configuracion;
create policy config_leer on public.configuracion for select using (true);
drop policy if exists config_admin on public.configuracion;
create policy config_admin on public.configuracion
  for update using (public.es_admin()) with check (public.es_admin());

-- Direcciones: cada cliente administra las suyas; el admin las ve
drop policy if exists dir_propias on public.direcciones;
create policy dir_propias on public.direcciones
  for all using (cliente_id = auth.uid()) with check (cliente_id = auth.uid());
drop policy if exists dir_admin_leer on public.direcciones;
create policy dir_admin_leer on public.direcciones
  for select using (public.es_admin());

-- Calificaciones: solo sobre pedidos propios ya entregados; el admin las lee
drop policy if exists cal_leer on public.calificaciones;
create policy cal_leer on public.calificaciones
  for select using (cliente_id = auth.uid() or public.es_admin());
drop policy if exists cal_crear on public.calificaciones;
create policy cal_crear on public.calificaciones
  for insert with check (
    cliente_id = auth.uid()
    and exists (select 1 from public.ordenes o
                 where o.id = orden_id and o.cliente_id = auth.uid() and o.estado = 'entregada')
  );
drop policy if exists cal_admin_borrar on public.calificaciones;
create policy cal_admin_borrar on public.calificaciones
  for delete using (public.es_admin());

-- Promociones: todos ven las activas; el admin gestiona
drop policy if exists promo_leer on public.promociones;
create policy promo_leer on public.promociones for select using (activo or public.es_admin());
drop policy if exists promo_admin on public.promociones;
create policy promo_admin on public.promociones
  for all using (public.es_admin()) with check (public.es_admin());

-- IA: solo admin
drop policy if exists conocimiento_admin on public.conocimiento_ia;
create policy conocimiento_admin on public.conocimiento_ia
  for all using (public.es_admin()) with check (public.es_admin());
drop policy if exists incidencias_admin on public.incidencias_ia;
create policy incidencias_admin on public.incidencias_ia
  for all using (public.es_admin()) with check (public.es_admin());

-- ----------------------------------------------------------------
-- 11) STORAGE: bucket público "medios" (solo el admin sube/borra)
-- ----------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('medios', 'medios', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update
  set public = true, file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists medios_ver on storage.objects;
create policy medios_ver on storage.objects
  for select using (bucket_id = 'medios');
drop policy if exists medios_subir on storage.objects;
create policy medios_subir on storage.objects
  for insert with check (bucket_id = 'medios' and public.es_admin());
drop policy if exists medios_borrar on storage.objects;
create policy medios_borrar on storage.objects
  for delete using (bucket_id = 'medios' and public.es_admin());

-- Permisos de columnas: el admin solo cambia el estado de las órdenes
-- (ya estaba así); las tablas nuevas usan los permisos por defecto + RLS.
