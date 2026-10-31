-- Small raster previews share the same private row policies as the book.
-- NULL means not generated yet; empty means there was no usable cover.
alter table public.books
  add column thumbnail text
  constraint books_thumbnail_valid check (
    thumbnail is null or thumbnail = '' or (
      pg_catalog.char_length(thumbnail) <= 65536
      and thumbnail ~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+=*$'
    )
  );
