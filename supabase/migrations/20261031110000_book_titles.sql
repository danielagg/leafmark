-- Display titles are independent of filenames and immutable storage paths.
alter table public.books
  add column title text
  constraint books_title_valid check (
    title is null or (
      pg_catalog.char_length(title) between 1 and 1024
      and pg_catalog.char_length(pg_catalog.btrim(title)) > 0
    )
  );
