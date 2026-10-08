-- Récords de los juegos (actividades): el mejor puntaje de cada usuario por juego, histórico y de la semana.
-- El navegador solo manda su puntaje; el servidor guarda el mayor, firma el usuario y calcula la semana.

begin;

create table if not exists public.game_scores (
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null check (game in ('draft','tier','duel','quiz')),
  score integer not null check (score between 0 and 1000),
  week_score integer not null default 0,
  week_start date not null default (date_trunc('week', now())::date),
  username text,
  avatar text,
  updated_at timestamptz not null default now(),
  primary key (user_id, game)
);
alter table public.game_scores enable row level security;

-- se ven los récords de colecciones públicas (y los tuyos)
drop policy if exists game_scores_select on public.game_scores;
create policy game_scores_select on public.game_scores for select to anon, authenticated
  using (user_id = auth.uid() or exists (select 1 from public.profiles p where p.user_id = game_scores.user_id and p.is_public));
drop policy if exists game_scores_insert on public.game_scores;
create policy game_scores_insert on public.game_scores for insert to authenticated with check (user_id = auth.uid());
drop policy if exists game_scores_update on public.game_scores;
create policy game_scores_update on public.game_scores for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select on public.game_scores to anon, authenticated;
grant insert, update on public.game_scores to authenticated;

create or replace function public.game_scores_keep_best() returns trigger
language plpgsql security definer set search_path = public as $$
declare wk date := date_trunc('week', now())::date;
begin
  new.username := (select p.username from public.profiles p where p.user_id = new.user_id);
  if new.avatar is not null and new.avatar !~ '^https://' then new.avatar := null; end if;
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.week_score := new.score; new.week_start := wk;
  else
    new.week_score := case when old.week_start = wk then greatest(old.week_score, new.score) else new.score end;
    new.week_start := wk;
    new.score := greatest(old.score, new.score);
  end if;
  return new;
end $$;
drop trigger if exists game_scores_best on public.game_scores;
create trigger game_scores_best before insert or update on public.game_scores for each row execute function public.game_scores_keep_best();

commit;
