-- ============================================
-- 映画の詳細項目とコメント欄
-- Supabase の SQL Editor で実行してください
-- ============================================

-- 1. movies テーブルに詳細カラム追加
alter table public.movies add column if not exists duration_minutes int;
alter table public.movies add column if not exists genre text;
alter table public.movies add column if not exists watch_url text;

-- 2. comments テーブル
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  movie_id uuid not null references public.movies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists comments_movie_id_idx on public.comments(movie_id);

-- 3. RLS
alter table public.comments enable row level security;

create policy "comments_select" on public.comments
  for select to authenticated using (true);

create policy "comments_insert" on public.comments
  for insert to authenticated with check (auth.uid() = user_id);

create policy "comments_update" on public.comments
  for update to authenticated using (auth.uid() = user_id);

create policy "comments_delete" on public.comments
  for delete to authenticated using (auth.uid() = user_id);
