-- ============================================
-- 映画鑑賞サークル — Supabase データベーススキーマ
-- Supabase の SQL Editor で実行してください
-- ============================================

-- 1. profiles テーブル
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text not null,
  is_admin boolean default false,
  created_at timestamptz default now()
);

-- 2. movies テーブル
create table public.movies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

-- 3. votes テーブル
create table public.votes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  movie_id uuid not null references public.movies(id) on delete cascade,
  date date not null,
  created_at timestamptz default now(),
  unique(user_id, movie_id, date)
);

-- ============================================
-- Row Level Security (RLS)
-- ============================================

alter table public.profiles enable row level security;
alter table public.movies enable row level security;
alter table public.votes enable row level security;

-- profiles: 認証済みユーザーは全員閲覧可
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

-- profiles: 自分のレコードのみ更新可
create policy "profiles_update" on public.profiles
  for update to authenticated using (id = auth.uid());

-- profiles: 認証済みユーザーは挿入可（アカウント作成時）
create policy "profiles_insert" on public.profiles
  for insert to authenticated with check (true);

-- movies: 認証済みユーザーは全員閲覧可
create policy "movies_select" on public.movies
  for select to authenticated using (true);

-- movies: 認証済みユーザーは追加可
create policy "movies_insert" on public.movies
  for insert to authenticated with check (auth.uid() = added_by);

-- movies: 追加者のみ削除可
create policy "movies_delete" on public.movies
  for delete to authenticated using (auth.uid() = added_by);

-- votes: 認証済みユーザーは全員閲覧可
create policy "votes_select" on public.votes
  for select to authenticated using (true);

-- votes: 自分の投票のみ追加可
create policy "votes_insert" on public.votes
  for insert to authenticated with check (auth.uid() = user_id);

-- votes: 自分の投票のみ削除可
create policy "votes_delete" on public.votes
  for delete to authenticated using (auth.uid() = user_id);
