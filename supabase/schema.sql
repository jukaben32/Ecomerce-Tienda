-- ================================================================
-- ModaNueva · Esquema de base de datos para Supabase (Postgres)
-- ----------------------------------------------------------------
-- CÓMO USARLO: Supabase > SQL Editor > New query > pega TODO este
-- archivo > Run. Es seguro volver a ejecutarlo (usa "if not exists"
-- y "or replace" donde se puede).
--
-- Qué crea:
--   1. Tablas: categorias, productos, perfiles, ordenes, items_orden
--   2. Vista productos_publicos (con el precio final ya calculado)
--   3. Función crear_orden() -> crea el pedido de forma atómica y
--      calcula precios/stock en el servidor (el navegador no decide)
--   4. Seguridad por filas (RLS): cada cliente ve solo lo suyo y
--      solo los admin pueden administrar la tienda
--   5. Datos de ejemplo (categorías y productos)
-- ================================================================

-- ----------------------------------------------------------------
-- 1) TABLAS
-- ----------------------------------------------------------------

create table if not exists public.categorias (
  id               bigint generated always as identity primary key,
  nombre           text not null,
  slug             text not null unique,
  descripcion      text,
  activo           boolean not null default true,
  -- Descuento a nivel de categoría (0-100). Aplica si descuento_activo = true
  descuento_pct    numeric(5,2) check (descuento_pct is null or (descuento_pct between 0 and 100)),
  descuento_activo boolean not null default false,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now()
);

create table if not exists public.productos (
  id               bigint generated always as identity primary key,
  sku              text not null unique,
  nombre           text not null,
  descripcion      text,
  precio           numeric(12,2) not null check (precio >= 0),
  moneda           char(3) not null default 'COP',
  existencias      integer not null default 0 check (existencias >= 0),
  activo           boolean not null default true,
  imagen_url       text,
  categoria_id     bigint references public.categorias(id) on delete set null,
  -- Descuento propio del producto: tiene prioridad sobre el de la categoría
  descuento_pct    numeric(5,2) check (descuento_pct is null or (descuento_pct between 0 and 100)),
  descuento_activo boolean not null default false,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now()
);
create index if not exists idx_productos_categoria on public.productos(categoria_id);

-- Un perfil por cada usuario de Supabase Auth (auth.users).
-- El rol NUNCA lo puede cambiar el propio usuario (ver permisos más abajo).
create table if not exists public.perfiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  nombre         text not null default '',
  apellido       text not null default '',
  correo         text,
  telefono       text,
  rol            text not null default 'cliente' check (rol in ('cliente', 'admin')),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.ordenes (
  id             bigint generated always as identity primary key,
  cliente_id     uuid not null references public.perfiles(id),
  estado         text not null default 'pendiente'
                 check (estado in ('pendiente','pagada','enviada','entregada','cancelada','reembolsada')),
  moneda         char(3) not null default 'COP',
  total          numeric(12,2) not null default 0 check (total >= 0),
  realizada_en   timestamptz not null default now(),
  actualizada_en timestamptz not null default now()
);
create index if not exists idx_ordenes_cliente on public.ordenes(cliente_id);
create index if not exists idx_ordenes_estado on public.ordenes(estado, realizada_en desc);

create table if not exists public.items_orden (
  id              bigint generated always as identity primary key,
  orden_id        bigint not null references public.ordenes(id) on delete cascade,
  producto_id     bigint not null references public.productos(id),
  sku             text not null,
  nombre_producto text not null,
  precio_unitario numeric(12,2) not null check (precio_unitario >= 0),
  cantidad        integer not null check (cantidad > 0),
  total_renglon   numeric(14,2) generated always as (precio_unitario * cantidad) stored
);
create index if not exists idx_items_orden on public.items_orden(orden_id);

-- ----------------------------------------------------------------
-- 2) FUNCIONES AUXILIARES Y TRIGGERS
-- ----------------------------------------------------------------

-- Actualiza "actualizado_en" automáticamente en cada UPDATE
create or replace function public.tocar_actualizado_en()
returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

drop trigger if exists trg_categorias_upd on public.categorias;
create trigger trg_categorias_upd before update on public.categorias
  for each row execute function public.tocar_actualizado_en();

drop trigger if exists trg_productos_upd on public.productos;
create trigger trg_productos_upd before update on public.productos
  for each row execute function public.tocar_actualizado_en();

drop trigger if exists trg_perfiles_upd on public.perfiles;
create trigger trg_perfiles_upd before update on public.perfiles
  for each row execute function public.tocar_actualizado_en();

-- ¿El usuario actual es admin? (security definer: lee perfiles sin
-- activar las políticas RLS, así evitamos recursión infinita)
create or replace function public.es_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.perfiles where id = auth.uid() and rol = 'admin'
  );
$$;

-- Cuando alguien se registra, creamos su perfil automáticamente.
-- Siempre nace como 'cliente' (aunque mande otro rol en los metadatos).
create or replace function public.crear_perfil_al_registrarse()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, correo, nombre, apellido, telefono)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'nombre', ''),
    coalesce(new.raw_user_meta_data ->> 'apellido', ''),
    nullif(new.raw_user_meta_data ->> 'telefono', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_crear_perfil on auth.users;
create trigger trg_crear_perfil after insert on auth.users
  for each row execute function public.crear_perfil_al_registrarse();

-- ----------------------------------------------------------------
-- 3) VISTA PÚBLICA DE PRODUCTOS (con descuento ya aplicado)
--    Prioridad del descuento: producto > categoría.
--    security_invoker = las políticas RLS se aplican a quien consulta.
-- ----------------------------------------------------------------
create or replace view public.productos_publicos
with (security_invoker = true) as
select
  p.id,
  p.sku,
  p.nombre,
  p.descripcion,
  p.precio,
  p.moneda,
  p.existencias,
  p.activo,
  p.imagen_url,
  p.categoria_id,
  p.descuento_pct,
  p.descuento_activo,
  d.pct as descuento_aplicado_pct,
  round(p.precio * (1 - d.pct / 100), 2) as precio_final
from public.productos p
left join public.categorias c on c.id = p.categoria_id
cross join lateral (
  select coalesce(
    case
      when p.descuento_activo and coalesce(p.descuento_pct, 0) > 0 then p.descuento_pct
      when c.descuento_activo and coalesce(c.descuento_pct, 0) > 0 then c.descuento_pct
    end,
    0
  ) as pct
) d;

grant select on public.productos_publicos to anon, authenticated;

-- ----------------------------------------------------------------
-- 4) CREAR ORDEN (atómica y segura)
--    Recibe: [{"producto_id": 1, "cantidad": 2}, ...]
--    El servidor busca el precio real, valida stock, descuenta
--    existencias y guarda todo en una sola transacción.
-- ----------------------------------------------------------------
create or replace function public.crear_orden(p_items jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_orden_id bigint;
  v_total    numeric(14,2) := 0;
  v_item     jsonb;
  v_prod     record;
  v_cant     integer;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión para comprar';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío';
  end if;

  insert into public.ordenes (cliente_id) values (v_uid) returning id into v_orden_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant := (v_item ->> 'cantidad')::integer;
    if v_cant is null or v_cant <= 0 then
      raise exception 'Cantidad inválida en el carrito';
    end if;

    -- Bloqueamos la fila del producto para que dos compras simultáneas
    -- no vendan el mismo stock dos veces.
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

    v_total := v_total + (v_prod.precio_final * v_cant);
  end loop;

  update public.ordenes set total = v_total where id = v_orden_id;

  return jsonb_build_object('orden_id', v_orden_id, 'total', v_total, 'moneda', 'COP');
end;
$$;

-- Solo usuarios con sesión pueden crear órdenes
revoke all on function public.crear_orden(jsonb) from public, anon;
grant execute on function public.crear_orden(jsonb) to authenticated;

-- ----------------------------------------------------------------
-- 5) CAMBIAR ROL (solo admin; no puedes quitarte tu propio rol)
-- ----------------------------------------------------------------
create or replace function public.cambiar_rol(p_usuario uuid, p_rol text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede cambiar roles';
  end if;
  if p_rol not in ('cliente', 'admin') then
    raise exception 'Rol inválido';
  end if;
  if p_usuario = auth.uid() then
    raise exception 'No puedes cambiar tu propio rol';
  end if;
  update public.perfiles set rol = p_rol where id = p_usuario;
end;
$$;

revoke all on function public.cambiar_rol(uuid, text) from public, anon;
grant execute on function public.cambiar_rol(uuid, text) to authenticated;

-- ----------------------------------------------------------------
-- 6) SEGURIDAD POR FILAS (RLS)
-- ----------------------------------------------------------------
alter table public.categorias  enable row level security;
alter table public.productos   enable row level security;
alter table public.perfiles    enable row level security;
alter table public.ordenes     enable row level security;
alter table public.items_orden enable row level security;

-- Categorías: todos ven las activas; el admin ve y edita todas
drop policy if exists categorias_leer on public.categorias;
create policy categorias_leer on public.categorias
  for select using (activo or public.es_admin());
drop policy if exists categorias_admin on public.categorias;
create policy categorias_admin on public.categorias
  for all using (public.es_admin()) with check (public.es_admin());

-- Productos: todos ven los activos; el admin ve y edita todos
drop policy if exists productos_leer on public.productos;
create policy productos_leer on public.productos
  for select using (activo or public.es_admin());
drop policy if exists productos_admin on public.productos;
create policy productos_admin on public.productos
  for all using (public.es_admin()) with check (public.es_admin());

-- Perfiles: cada quien ve y edita el suyo; el admin ve todos
drop policy if exists perfiles_leer on public.perfiles;
create policy perfiles_leer on public.perfiles
  for select using (id = auth.uid() or public.es_admin());
drop policy if exists perfiles_editar_propio on public.perfiles;
create policy perfiles_editar_propio on public.perfiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- El usuario solo puede modificar estas columnas (NO el rol ni el correo)
revoke update on public.perfiles from anon, authenticated;
grant update (nombre, apellido, telefono) on public.perfiles to authenticated;

-- Órdenes: el cliente ve las suyas; el admin ve y actualiza todas.
-- (Crear órdenes se hace SOLO con la función crear_orden)
drop policy if exists ordenes_leer on public.ordenes;
create policy ordenes_leer on public.ordenes
  for select using (cliente_id = auth.uid() or public.es_admin());
drop policy if exists ordenes_actualizar_admin on public.ordenes;
create policy ordenes_actualizar_admin on public.ordenes
  for update using (public.es_admin()) with check (public.es_admin());

drop policy if exists items_leer on public.items_orden;
create policy items_leer on public.items_orden
  for select using (
    public.es_admin()
    or exists (select 1 from public.ordenes o where o.id = orden_id and o.cliente_id = auth.uid())
  );

-- Un admin solo debería poder cambiar el estado de la orden, no el total
revoke update on public.ordenes from anon, authenticated;
grant update (estado) on public.ordenes to authenticated;

-- La fecha de actualización de la orden se marca sola en cada cambio
create or replace function public.tocar_actualizada_en()
returns trigger language plpgsql as $$
begin
  new.actualizada_en := now();
  return new;
end;
$$;
drop trigger if exists trg_ordenes_upd on public.ordenes;
create trigger trg_ordenes_upd before update on public.ordenes
  for each row execute function public.tocar_actualizada_en();

-- ----------------------------------------------------------------
-- 7) DATOS DE EJEMPLO
-- ----------------------------------------------------------------
insert into public.categorias (nombre, slug, descripcion) values
  ('Mujer',              'mujer',              'Ropa para mujer'),
  ('Hombre',             'hombre',             'Ropa para hombre'),
  ('Niños',              'ninos',              'Ropa para niños y niñas'),
  ('Accesorios',         'accesorios',         'Bolsos, gorras, cinturones y más')
on conflict (slug) do nothing;

insert into public.productos (sku, nombre, descripcion, precio, existencias, categoria_id) values
  ('MUJ-001', 'Blusa lino arena',       'Blusa de lino suave, corte holgado.',            89900, 25, (select id from public.categorias where slug = 'mujer')),
  ('MUJ-002', 'Vestido midi terracota', 'Vestido midi con caída fluida.',                149900, 12, (select id from public.categorias where slug = 'mujer')),
  ('MUJ-003', 'Jean recto tiro alto',   'Jean de algodón, tiro alto y pierna recta.',    129900, 30, (select id from public.categorias where slug = 'mujer')),
  ('HOM-001', 'Camisa oxford celeste',  'Camisa oxford clásica de algodón.',              99900, 20, (select id from public.categorias where slug = 'hombre')),
  ('HOM-002', 'Pantalón chino oliva',   'Chino ajustado con algo de elasticidad.',       119900, 18, (select id from public.categorias where slug = 'hombre')),
  ('HOM-003', 'Camiseta básica negra',  'Camiseta 100% algodón peinado.',                 49900, 60, (select id from public.categorias where slug = 'hombre')),
  ('NIN-001', 'Conjunto jogger gris',   'Buzo y jogger de algodón afelpado.',             79900, 22, (select id from public.categorias where slug = 'ninos')),
  ('NIN-002', 'Vestido flores niña',    'Vestido ligero con estampado de flores.',        69900, 15, (select id from public.categorias where slug = 'ninos')),
  ('ACC-001', 'Bolso tote lona',        'Bolso grande de lona resistente.',               59900, 40, (select id from public.categorias where slug = 'accesorios')),
  ('ACC-002', 'Gorra bordada',          'Gorra ajustable con bordado en el frente.',      39900, 35, (select id from public.categorias where slug = 'accesorios'))
on conflict (sku) do nothing;

-- ================================================================
-- DESPUÉS DE EJECUTAR ESTO:
--  1. Abre la tienda y regístrate con TU correo (será "cliente").
--  2. Conviértete en admin ejecutando esto con tu correo real:
--
--     update public.perfiles set rol = 'admin' where correo = '<tu-correo>';
--
-- ================================================================
