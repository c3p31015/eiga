-- ============================================
-- 参加表明: 活動日に「参加 / 不参加」を登録
-- 投票とは独立。参加するけど投票なし、投票したけど不参加、なども可能
-- ============================================

-- 1. activity_attendances テーブル
create table if not exists public.activity_attendances (
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  status text not null check (status in ('going', 'not_going')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, date)
);

create index if not exists activity_attendances_date_idx
  on public.activity_attendances(date);

-- 2. RLS
alter table public.activity_attendances enable row level security;

-- 全員閲覧可
drop policy if exists "activity_attendances_select" on public.activity_attendances;
create policy "activity_attendances_select" on public.activity_attendances
  for select to authenticated using (true);

-- 自分の参加表明のみ追加可（活動日のみ）
drop policy if exists "activity_attendances_insert" on public.activity_attendances;
create policy "activity_attendances_insert" on public.activity_attendances
  for insert to authenticated
  with check (auth.uid() = user_id and public.is_activity_day(date));

-- 自分の参加表明のみ更新可
drop policy if exists "activity_attendances_update" on public.activity_attendances;
create policy "activity_attendances_update" on public.activity_attendances
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 自分の参加表明のみ削除可
drop policy if exists "activity_attendances_delete" on public.activity_attendances;
create policy "activity_attendances_delete" on public.activity_attendances
  for delete to authenticated
  using (auth.uid() = user_id);
