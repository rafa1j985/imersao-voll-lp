-- Opcional: foto do consultor (rode no SQL Editor se ainda não tiver a coluna)
alter table public.consultants
  add column if not exists photo_url text default '';

comment on column public.consultants.photo_url is 'URL pública da foto do consultor';
