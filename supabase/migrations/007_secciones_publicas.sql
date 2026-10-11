-- ================================================================
-- ModaNueva · Migración 007: secciones públicas de la portada
-- ----------------------------------------------------------------
-- Ejecutar DESPUÉS de 006_clientes_sin_cuenta_y_precios.sql.
--
--   1. configuracion   -> redes sociales y zona de cobertura
--   2. resumen_calificaciones() -> reseñas públicas SIN datos personales
--      (solo primer nombre, nunca apellido ni correo)
--   3. sugerencias     -> quejas, reclamos y sugerencias de clientes
--      (con límite anti-spam y bandeja para el admin)
-- ================================================================

-- ----------------------------------------------------------------
-- 1) Redes y cobertura (se muestran en el pie y en la portada)
-- ----------------------------------------------------------------
alter table public.configuracion
  add column if not exists instagram text check (instagram is null or instagram ~ '^https://'),
  add column if not exists facebook  text check (facebook  is null or facebook  ~ '^https://'),
  add column if not exists tiktok    text check (tiktok    is null or tiktok    ~ '^https://'),
  add column if not exists cobertura text check (char_length(cobertura) <= 400);

-- ----------------------------------------------------------------
-- 2) Calificaciones públicas
--    La tabla calificaciones es privada (RLS). Esta función devuelve solo
--    lo que se puede mostrar a cualquier visitante.
-- ----------------------------------------------------------------
create or replace function public.resumen_calificaciones(p_limite integer default 6)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_limite integer := least(greatest(coalesce(p_limite, 6), 1), 20);
begin
  return jsonb_build_object(
    'total',    (select count(*) from public.calificaciones),
    'promedio', (select round(avg(estrellas), 1) from public.calificaciones),
    'distribucion', (
      select jsonb_object_agg(e::text, coalesce(n, 0))
      from generate_series(1, 5) e
      left join (select estrellas, count(*) n from public.calificaciones group by estrellas) c
             on c.estrellas = e
    ),
    'comentarios', coalesce((
      select jsonb_agg(jsonb_build_object(
               'estrellas', c.estrellas,
               'comentario', c.comentario,
               'nombre', coalesce(nullif(split_part(btrim(p.nombre), ' ', 1), ''), 'Cliente'),
               'fecha', c.creado_en))
      from (
        select * from public.calificaciones
         where comentario is not null and btrim(comentario) <> ''
         order by creado_en desc
         limit v_limite
      ) c
      join public.perfiles p on p.id = c.cliente_id
    ), '[]'::jsonb)
  );
end;
$$;
grant execute on function public.resumen_calificaciones(integer) to anon, authenticated;

-- ----------------------------------------------------------------
-- 3) Quejas, reclamos y sugerencias
-- ----------------------------------------------------------------
create table if not exists public.sugerencias (
  id         bigint generated always as identity primary key,
  tipo       text not null check (tipo in ('queja','reclamo','sugerencia')),
  mensaje    text not null check (char_length(mensaje) between 5 and 1000),
  contacto   text check (char_length(contacto) <= 120),
  cliente_id uuid references public.perfiles(id) on delete set null,
  estado     text not null default 'nueva' check (estado in ('nueva','leida','resuelta')),
  creado_en  timestamptz not null default now()
);
create index if not exists idx_sugerencias_estado on public.sugerencias(estado, creado_en desc);

alter table public.sugerencias enable row level security;
-- Sin política de INSERT: solo se crean con la función de abajo (que limita el spam).
drop policy if exists sugerencias_admin_leer on public.sugerencias;
create policy sugerencias_admin_leer on public.sugerencias for select using (public.es_admin());
drop policy if exists sugerencias_admin_editar on public.sugerencias;
create policy sugerencias_admin_editar on public.sugerencias
  for update using (public.es_admin()) with check (public.es_admin());
drop policy if exists sugerencias_admin_borrar on public.sugerencias;
create policy sugerencias_admin_borrar on public.sugerencias for delete using (public.es_admin());

-- El admin solo puede cambiar el estado, no reescribir lo que dijo el cliente
revoke update on public.sugerencias from anon, authenticated;
grant update (estado) on public.sugerencias to authenticated;

create or replace function public.enviar_sugerencia(p_tipo text, p_mensaje text, p_contacto text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_recientes integer;
begin
  if auth.uid() is null then
    raise exception 'Inicia sesión para enviar tu mensaje';
  end if;
  if p_tipo not in ('queja','reclamo','sugerencia') then
    raise exception 'Tipo de mensaje inválido';
  end if;
  if p_mensaje is null or char_length(btrim(p_mensaje)) < 5 then
    raise exception 'Escribe un mensaje de al menos 5 caracteres';
  end if;
  -- Anti-spam: máximo 5 mensajes por usuario cada 24 horas
  select count(*) into v_recientes from public.sugerencias
   where cliente_id = auth.uid() and creado_en > now() - interval '24 hours';
  if v_recientes >= 5 then
    raise exception 'Ya enviaste varios mensajes hoy. Intenta de nuevo mañana';
  end if;
  insert into public.sugerencias (tipo, mensaje, contacto, cliente_id)
  values (p_tipo, left(btrim(p_mensaje), 1000), nullif(left(btrim(coalesce(p_contacto, '')), 120), ''), auth.uid());
end;
$$;
revoke all on function public.enviar_sugerencia(text, text, text) from public, anon;
grant execute on function public.enviar_sugerencia(text, text, text) to authenticated;
