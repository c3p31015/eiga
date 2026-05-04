-- ============================================
-- 活動日・活動時間スケジュール
-- 曜日ベースのルール + 日付単位の上書き
-- ============================================

-- 1. activity_rules: 曜日ごとのルール（isodow 1=月 〜 5=金）
create table if not exists public.activity_rules (
  weekday int primary key check (weekday between 1 and 7),
  enabled boolean not null default false,
  start_time time not null default '19:00',
  end_time time not null default '21:00',
  updated_at timestamptz default now()
);

-- 初期値: 月〜金を未有効で挿入
insert into public.activity_rules (weekday, enabled, start_time, end_time)
values
  (1, false, '19:00', '21:00'),
  (2, false, '19:00', '21:00'),
  (3, false, '19:00', '21:00'),
  (4, false, '19:00', '21:00'),
  (5, false, '19:00', '21:00')
on conflict (weekday) do nothing;

-- 2. activity_days: 個別日付の上書き
create table if not exists public.activity_days (
  date date primary key,
  is_active boolean not null,
  start_time time,
  end_time time,
  note text,
  updated_at timestamptz default now()
);

-- 3. 判定関数: その日付が活動日か
create or replace function public.is_activity_day(d date)
returns boolean
language sql
stable
as $$
  select coalesce(
    (select is_active from public.activity_days where date = d),
    (select enabled from public.activity_rules where weekday = extract(isodow from d)::int),
    false
  );
$$;

-- 4. RLS
alter table public.activity_rules enable row level security;
alter table public.activity_days enable row level security;

-- 全員閲覧可
create policy "activity_rules_select" on public.activity_rules
  for select to authenticated using (true);
create policy "activity_days_select" on public.activity_days
  for select to authenticated using (true);

-- 管理者のみ更新可
create policy "activity_rules_update" on public.activity_rules
  for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

create policy "activity_days_insert" on public.activity_days
  for insert to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin));
create policy "activity_days_update" on public.activity_days
  for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin));
create policy "activity_days_delete" on public.activity_days
  for delete to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

-- 5. votes_insert ポリシーを「活動日のみ」に更新
drop policy if exists "votes_insert" on public.votes;
create policy "votes_insert" on public.votes
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and public.is_activity_day(date)
  );
