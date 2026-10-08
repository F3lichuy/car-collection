-- Protección de garages (servidor): historial de versiones y bloqueo de vaciados accidentales.

begin;

-- 1) Historial: cada vez que un garage cambia, se guarda la versión anterior (últimas 30 por usuario).
create table if not exists public.garage_history (
  id bigserial primary key,
  user_id uuid not null,
  data jsonb not null,
  cars integer not null,
  saved_at timestamptz not null default now()
);
alter table public.garage_history enable row level security;
drop policy if exists garage_history_own on public.garage_history;
create policy garage_history_own on public.garage_history for select to authenticated using (user_id = auth.uid());

create or replace function public.garage_keep_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.data is distinct from new.data then
    insert into public.garage_history(user_id, data, cars)
      values (old.user_id, old.data, coalesce(jsonb_array_length(old.data->'cars'), 0));
    delete from public.garage_history h
      where h.user_id = old.user_id
        and h.id not in (select id from public.garage_history where user_id = old.user_id order by saved_at desc limit 30);
  end if;
  return new;
end $$;
drop trigger if exists garages_history on public.garages;
create trigger garages_history before update on public.garages for each row execute function public.garage_keep_history();

-- 2) Bloqueo: un garage con 3 o más coches no puede quedar en 0 de un solo guardado.
create or replace function public.garage_block_wipe() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(jsonb_array_length(old.data->'cars'), 0) >= 3
     and coalesce(jsonb_array_length(new.data->'cars'), 0) = 0 then
    raise exception 'Guardado rechazado: el garage quedaría vacío';
  end if;
  return new;
end $$;
drop trigger if exists garages_block_wipe on public.garages;
create trigger garages_block_wipe before update on public.garages for each row execute function public.garage_block_wipe();

commit;
