-- ¿Qué coche suena?: el ranking acepta los récords de este juego
begin;
alter table public.game_scores drop constraint if exists game_scores_game_check;
alter table public.game_scores add constraint game_scores_game_check check (game in ('draft','tier','duel','quiz','sound'));
-- los clips de YouTube se quitaron del juego
delete from public.app_settings where key = 'soundclips';
commit;
