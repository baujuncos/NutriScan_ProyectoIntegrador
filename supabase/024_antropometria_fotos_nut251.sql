begin;

-- ============================================================
-- 024 (NUT-251/NUT-240) — Antropometrías: fotos posturales en Supabase Storage
--
-- Qué agrega (todo ADITIVO e idempotente: no toca datos existentes):
--   * Bucket PRIVADO 'antropometria-fotos' (3 MB por archivo; JPEG, WebP o PNG).
--     Nunca hay URLs públicas: la lectura es solo por signed URLs de corta
--     duración que genera el servidor.
--   * antropometria_fotos: una fila por foto postural de una medición, en
--     posiciones fijas ('frente', 'lateral', 'espalda'). unique (medicion_id,
--     posicion) hace que haya como máximo UNA foto por posición, o sea hasta 3
--     por medición. `path` es el objeto en el bucket, con la convención
--     `{medicion_id}/{posicion}-{uuid}.jpg`.
--   * Policies de storage.objects para el bucket: el navegador sube directo con
--     la sesión del investigador (así no pasa por el límite de ~1 MB del body de
--     las server actions). El INSERT exige que la primera carpeta del path sea el
--     id de una medición existente y no anulada.
--
-- Permisos: igual que el resto del panel (get_my_role() en investigador o
-- administrador) para leer, subir y borrar. Nadie más (ni anon, ni deportistas,
-- ni particulares) toca la tabla ni el bucket. La tabla permite SELECT, INSERT,
-- DELETE y UPDATE solo de path/creado_en (reemplazar la foto de una posición).
-- Borrar una foto de Storage NO la borra la base: lo hace la app (el cascade de
-- la tabla no borra objetos); al anular una medición la app borra los archivos
-- y las filas ANTES de pasarla a 'anulada'.
--
-- Riesgos: ninguno para datos existentes (objetos y tabla nuevos). Son fotos de
-- personas: el bucket es privado y solo lo ve el panel de investigador.
-- Reversión:
--   drop policy if exists "antropometria-fotos: investigador read"   on storage.objects;
--   drop policy if exists "antropometria-fotos: investigador insert" on storage.objects;
--   drop policy if exists "antropometria-fotos: investigador delete" on storage.objects;
--   drop table if exists public.antropometria_fotos;
--   -- Los objetos del bucket se borran desde el Dashboard o con la API de Storage
--   -- (no con delete sobre storage.objects); después:
--   delete from storage.buckets where id = 'antropometria-fotos';
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('antropometria-fotos', 'antropometria-fotos', false, 3145728, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do nothing;

create table if not exists public.antropometria_fotos (
  id          uuid primary key default gen_random_uuid(),
  medicion_id uuid not null references public.antropometria_mediciones(id) on delete cascade,
  posicion    text not null check (posicion in ('frente', 'lateral', 'espalda')),
  path        text not null unique,
  creado_por  uuid not null default auth.uid() references auth.users(id),
  creado_en   timestamptz not null default now(),
  unique (medicion_id, posicion)
);

alter table public.antropometria_fotos enable row level security;

-- Supabase da ALL por default a anon/authenticated en tablas nuevas de public:
-- se quita todo y se otorga solo lo que se usa.
revoke all on public.antropometria_fotos from anon, authenticated;
grant select, insert, delete on public.antropometria_fotos to authenticated;
grant update (path, creado_en) on public.antropometria_fotos to authenticated;

drop policy if exists "antropometria_fotos: investigador read" on public.antropometria_fotos;
create policy "antropometria_fotos: investigador read"
  on public.antropometria_fotos for select to authenticated
  using ((select public.get_my_role()) in ('investigador', 'administrador'));

drop policy if exists "antropometria_fotos: investigador insert" on public.antropometria_fotos;
create policy "antropometria_fotos: investigador insert"
  on public.antropometria_fotos for insert to authenticated
  with check ((select public.get_my_role()) in ('investigador', 'administrador')
              and creado_por = (select auth.uid()));

drop policy if exists "antropometria_fotos: investigador update" on public.antropometria_fotos;
create policy "antropometria_fotos: investigador update"
  on public.antropometria_fotos for update to authenticated
  using ((select public.get_my_role()) in ('investigador', 'administrador'))
  with check ((select public.get_my_role()) in ('investigador', 'administrador'));

drop policy if exists "antropometria_fotos: investigador delete" on public.antropometria_fotos;
create policy "antropometria_fotos: investigador delete"
  on public.antropometria_fotos for delete to authenticated
  using ((select public.get_my_role()) in ('investigador', 'administrador'));

-- Storage: sin UPDATE (reemplazar = subir otro objeto y borrar el anterior).
drop policy if exists "antropometria-fotos: investigador read" on storage.objects;
drop policy if exists "antropometria-fotos: investigador insert" on storage.objects;
drop policy if exists "antropometria-fotos: investigador delete" on storage.objects;

create policy "antropometria-fotos: investigador read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'antropometria-fotos'
    and (select public.get_my_role()) in ('investigador', 'administrador')
  );

create policy "antropometria-fotos: investigador insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'antropometria-fotos'
    and (select public.get_my_role()) in ('investigador', 'administrador')
    and exists (
      select 1 from public.antropometria_mediciones m
      where m.id::text = (storage.foldername(name))[1]
        and m.estado <> 'anulada'
    )
  );

create policy "antropometria-fotos: investigador delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'antropometria-fotos'
    and (select public.get_my_role()) in ('investigador', 'administrador')
  );

commit;
