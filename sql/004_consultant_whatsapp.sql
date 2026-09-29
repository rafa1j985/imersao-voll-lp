-- WhatsApp do consultor (exibido ao cliente após agendar)
alter table public.consultants
  add column if not exists whatsapp text default '';

comment on column public.consultants.whatsapp is 'WhatsApp E.164 sem + (ex: 5519999999999)';
