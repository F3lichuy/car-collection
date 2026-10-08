-- Spec Battle: votos de la comunidad. Un voto por usuario por pareja de specs (se puede cambiar).
-- La pareja la calcula el servidor (ganador y perdedor ordenados), así no depende del navegador.
begin;

create table if not exists public.spec_votes (
  user_id uuid not null references auth.users(id) on delete cascade,
  pair text not null,
  winner text not null check (length(winner) between 1 and 300),
  loser text not null check (length(loser) between 1 and 300),
  created_at timestamptz not null default now(),
  primary key (user_id, pair)
);
create index if not exists spec_votes_pair on public.spec_votes(pair);
create index if not exists spec_votes_created on public.spec_votes(created_at desc);
alter table public.spec_votes enable row level security;

drop policy if exists spec_votes_select on public.spec_votes;
create policy spec_votes_select on public.spec_votes for select to anon, authenticated using (true);
drop policy if exists spec_votes_insert on public.spec_votes;
create policy spec_votes_insert on public.spec_votes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists spec_votes_update on public.spec_votes;
create policy spec_votes_update on public.spec_votes for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select on public.spec_votes to anon, authenticated;
grant insert, update on public.spec_votes to authenticated;

create or replace function public.spec_votes_pair() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.winner = new.loser then raise exception 'Una spec no puede competir contra sí misma'; end if;
  new.pair := least(new.winner, new.loser) || '||' || greatest(new.winner, new.loser);
  new.created_at := now();
  return new;
end $$;
drop trigger if exists spec_votes_pair on public.spec_votes;
create trigger spec_votes_pair before insert or update on public.spec_votes for each row execute function public.spec_votes_pair();

commit;
