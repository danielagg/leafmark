-- First migration for an empty Supabase project. Apply only after review.
-- Deny by default: an administrator must provision the single library owner
-- through trusted SQL during setup. Clients cannot create their own allowlist row.
begin;

create schema private;

create table private.library_owner (
  singleton boolean primary key default true check (singleton = true),
  user_id uuid not null unique references auth.users (id) on delete restrict
);

revoke all on schema private from public, anon, authenticated;
revoke all on table private.library_owner from public, anon, authenticated;
alter table private.library_owner enable row level security;

-- The function owner can read the private allowlist; callers cannot access it.
create function public.is_library_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.library_owner as library_owner
    where library_owner.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_library_owner() from public, anon, authenticated, service_role;
grant execute on function public.is_library_owner() to authenticated;

create table public.books (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete restrict,
  filename text not null check (pg_catalog.char_length(filename) between 1 and 1024),
  format text not null check (format in ('pdf', 'epub')),
  storage_path text not null unique,
  byte_size bigint not null check (byte_size between 1 and 52428800),
  reading_position jsonb,
  progress double precision not null default 0 check (progress between 0 and 1),
  last_read_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  constraint books_storage_path_matches_identity check (
    storage_path = owner_id::text || '/' || id::text || '.' || format
  ),
  -- Validate the basic locator, while allowing reader-specific extra fields.
  -- CASE guards casts; COALESCE rejects missing required fields instead of
  -- letting SQL NULL satisfy a CHECK constraint.
  constraint books_reading_position_valid check (
    reading_position is null or coalesce(
      pg_catalog.jsonb_typeof(reading_position) = 'object'
      and reading_position ->> 'type' = format
      and case format
        when 'pdf' then
          case when pg_catalog.jsonb_typeof(reading_position -> 'page') = 'number'
            then (reading_position ->> 'page')::numeric >= 1
              and (reading_position ->> 'page')::numeric =
                pg_catalog.trunc((reading_position ->> 'page')::numeric)
            else false
          end
          and case when pg_catalog.jsonb_typeof(reading_position -> 'offset') = 'number'
            then (reading_position ->> 'offset')::numeric between 0 and 1
            else false
          end
        when 'epub' then
          pg_catalog.jsonb_typeof(reading_position -> 'cfi') = 'string'
          and pg_catalog.char_length(reading_position ->> 'cfi') between 9 and 8192
          and pg_catalog.left(reading_position ->> 'cfi', 8) = 'epubcfi('
          -- EPUB offsets are pixel distances and can be negative.
          and (not (reading_position ? 'offset')
            or pg_catalog.jsonb_typeof(reading_position -> 'offset') = 'number')
          and (not (reading_position ? 'flow')
            or reading_position ->> 'flow' in ('vertical', 'horizontal'))
        else false
      end,
      false
    )
  )
);

alter table public.books enable row level security;
revoke all on table public.books from public, anon, authenticated;
grant select, insert, update, delete on table public.books to authenticated;

create policy books_select_owner on public.books
  for select to authenticated
  using ((select public.is_library_owner()) and owner_id = (select auth.uid()));

create policy books_insert_owner on public.books
  for insert to authenticated
  with check ((select public.is_library_owner()) and owner_id = (select auth.uid()));

create policy books_update_owner on public.books
  for update to authenticated
  using ((select public.is_library_owner()) and owner_id = (select auth.uid()))
  with check ((select public.is_library_owner()) and owner_id = (select auth.uid()));

create policy books_delete_owner on public.books
  for delete to authenticated
  using ((select public.is_library_owner()) and owner_id = (select auth.uid()));

create function public.guard_book_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if TG_OP = 'INSERT' then
    new.created_at := pg_catalog.now();
    if new.last_read_at is not null then
      new.last_read_at := pg_catalog.now();
    end if;
  else
    if new.id is distinct from old.id
      or new.owner_id is distinct from old.owner_id
      or new.format is distinct from old.format
      or new.storage_path is distinct from old.storage_path
      or new.byte_size is distinct from old.byte_size
      or new.created_at is distinct from old.created_at then
      raise exception 'Book identity, storage metadata, and creation time are immutable'
        using errcode = '23514';
    end if;

    -- A changed last_read_at requests a touch, never a client-chosen timestamp.
    if new.last_read_at is distinct from old.last_read_at
      or new.reading_position is distinct from old.reading_position
      or new.progress is distinct from old.progress then
      new.last_read_at := pg_catalog.now();
    end if;
  end if;
  return new;
end;
$$;

-- Only the trigger calls this function; there is no client RPC permission.
revoke all on function public.guard_book_write() from public, anon, authenticated, service_role;
create trigger books_guard_write
  before insert or update on public.books
  for each row execute function public.guard_book_write();

-- Create only this bucket. A conflicting existing bucket fails the migration
-- rather than changing its settings or touching any other bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('books', 'books', false, 52428800,
  array['application/pdf', 'application/epub+zip']);

-- Supabase manages storage.objects RLS and grants. These policies authorize
-- only the provisioned owner, within that owner's first path folder.
create policy books_objects_select_owner on storage.objects
  for select to authenticated
  using (
    bucket_id = 'books'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_library_owner())
  );

create policy books_objects_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'books'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_library_owner())
  );

create policy books_objects_delete_owner on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'books'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_library_owner())
  );

-- No Storage UPDATE policy: uploads must use fresh object paths with upsert
-- disabled. Overwrites, moves, and renames are not authorized by this migration.
-- No owner row is inserted here, so books and objects remain denied until setup.
commit;
