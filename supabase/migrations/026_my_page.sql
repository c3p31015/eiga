-- ============================================
-- 026_my_page.sql
-- マイページ向けの追加:
--  - movie_watchlist: 個人の「観たい映画リスト」。申請時の入力にも再利用する。
-- （表示名はメンバー自身では変更不可。変更は admin_update_member 経由のみ。）
-- ============================================

-- 個人の観たい映画リスト
create table if not exists public.movie_watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  duration_minutes int,
  genre text,
  watch_url text,
  description text,
  has_gore boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists movie_watchlist_user_idx
  on public.movie_watchlist(user_id, created_at desc);

alter table public.movie_watchlist enable row level security;

-- 自分の行のみ参照・追加・更新・削除できる
drop policy if exists "movie_watchlist_select" on public.movie_watchlist;
create policy "movie_watchlist_select" on public.movie_watchlist
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "movie_watchlist_insert" on public.movie_watchlist;
create policy "movie_watchlist_insert" on public.movie_watchlist
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "movie_watchlist_update" on public.movie_watchlist;
create policy "movie_watchlist_update" on public.movie_watchlist
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "movie_watchlist_delete" on public.movie_watchlist;
create policy "movie_watchlist_delete" on public.movie_watchlist
  for delete to authenticated using (user_id = auth.uid());
