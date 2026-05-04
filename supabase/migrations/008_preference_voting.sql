-- ============================================
-- 008_preference_voting.sql
-- 投票方式の全面刷新: 多数決 → 希望順位マッチング
-- 旧テーブル(movies/votes/comments/activity_decisions)を破棄し、
-- 新テーブル(activity_periods/date_preferences/activity_assignments)を作成
-- ============================================

-- 1. 旧テーブル・関数の削除
-- テーブルを先にCASCADE削除（依存ポリシーも一緒に削除される）してから関数を削除する
drop table if exists public.activity_decisions cascade;
drop table if exists public.votes cascade;
drop table if exists public.comments cascade;
drop table if exists public.movies cascade;
drop function if exists public.lock_activity_decision(date);
drop function if exists public.is_voting_open(date);

-- 2. 月単位の希望提出期間
create table if not exists public.activity_periods (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  month int not null check (month between 1 and 12),
  deadline_at timestamptz not null,
  locked_at timestamptz,
  created_at timestamptz default now(),
  unique (year, month)
);

-- 3. ユーザーの希望順位
create table if not exists public.date_preferences (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.activity_periods(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  rank int not null check (rank >= 1),
  created_at timestamptz default now(),
  unique (user_id, period_id, date),
  unique (user_id, period_id, rank)
);

create index if not exists date_preferences_period_date_idx
  on public.date_preferences(period_id, date);

-- 4. 集計後に確定した主催者と映画
create table if not exists public.activity_assignments (
  date date primary key,
  period_id uuid not null references public.activity_periods(id) on delete cascade,
  host_user_id uuid references public.profiles(id) on delete set null,
  movie_title text,
  movie_description text,
  movie_duration_minutes int,
  movie_genre text,
  movie_poster_url text,
  movie_watch_url text,
  locked_at timestamptz not null default now(),
  movie_updated_at timestamptz
);

create index if not exists activity_assignments_period_idx
  on public.activity_assignments(period_id);

-- ============================================
-- RPC関数
-- ============================================

-- ensure_period: 月の期間レコードを取得 or 作成
-- デフォルト締切は前月の最終日12:00 JST
create or replace function public.ensure_period(p_year int, p_month int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_default_deadline timestamptz;
begin
  select id into v_id from public.activity_periods
    where year = p_year and month = p_month;
  if v_id is not null then
    return v_id;
  end if;

  v_default_deadline := (
    (make_date(p_year, p_month, 1)::timestamp - interval '12 hours')
    at time zone 'Asia/Tokyo'
  );

  insert into public.activity_periods (year, month, deadline_at)
  values (p_year, p_month, v_default_deadline)
  on conflict (year, month) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.activity_periods
      where year = p_year and month = p_month;
  end if;
  return v_id;
end;
$$;

grant execute on function public.ensure_period(int, int) to authenticated;

-- set_my_preferences: 自分の希望順位を一括置換（dates配列の順序がそのまま順位になる）
create or replace function public.set_my_preferences(
  p_period_id uuid,
  p_dates date[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.activity_periods%rowtype;
  v_user uuid;
  v_date date;
  v_rank int;
  v_seen_dates date[] := array[]::date[];
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select * into v_period from public.activity_periods where id = p_period_id;
  if not found then
    raise exception 'period not found';
  end if;
  if v_period.locked_at is not null then
    raise exception 'period is already locked';
  end if;
  if v_period.deadline_at <= now() then
    raise exception 'period deadline has passed';
  end if;

  delete from public.date_preferences
  where user_id = v_user and period_id = p_period_id;

  v_rank := 1;
  foreach v_date in array p_dates loop
    if v_date = any(v_seen_dates) then
      raise exception 'duplicate date %', v_date;
    end if;
    v_seen_dates := array_append(v_seen_dates, v_date);

    if not public.is_activity_day(v_date) then
      raise exception 'date % is not an activity day', v_date;
    end if;
    if extract(year from v_date)::int != v_period.year
       or extract(month from v_date)::int != v_period.month then
      raise exception 'date % is not in period', v_date;
    end if;
    insert into public.date_preferences (period_id, user_id, date, rank)
    values (p_period_id, v_user, v_date, v_rank);
    v_rank := v_rank + 1;
  end loop;
end;
$$;

grant execute on function public.set_my_preferences(uuid, date[]) to authenticated;

-- lock_activity_period: 段階的マッチングで主催者を確定
-- rank 1, 2, 3... の順で各日について抽選を行う
create or replace function public.lock_activity_period(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.activity_periods%rowtype;
  v_first_day date;
  v_last_day date;
  v_max_rank int;
  v_rank int;
  v_date date;
  v_winner uuid;
begin
  select * into v_period from public.activity_periods where id = p_period_id for update;
  if not found then
    raise exception 'period not found';
  end if;
  if v_period.locked_at is not null then
    return;
  end if;
  if v_period.deadline_at > now() then
    return;
  end if;

  v_first_day := make_date(v_period.year, v_period.month, 1);
  v_last_day := (v_first_day + interval '1 month - 1 day')::date;

  select coalesce(max(rank), 0) into v_max_rank
    from public.date_preferences
    where period_id = p_period_id;

  for v_rank in 1..v_max_rank loop
    for v_date in
      select d::date
      from generate_series(v_first_day, v_last_day, interval '1 day') as d
      where public.is_activity_day(d::date)
        and not exists (
          select 1 from public.activity_assignments where date = d::date
        )
    loop
      select user_id into v_winner
      from public.date_preferences
      where period_id = p_period_id
        and date = v_date
        and rank = v_rank
      order by random()
      limit 1;

      if v_winner is not null then
        insert into public.activity_assignments (date, period_id, host_user_id)
        values (v_date, p_period_id, v_winner);
      end if;
    end loop;
  end loop;

  update public.activity_periods set locked_at = now() where id = p_period_id;
end;
$$;

grant execute on function public.lock_activity_period(uuid) to authenticated;

-- update_my_assignment_movie: 主催者本人が映画情報を更新
create or replace function public.update_my_assignment_movie(
  p_date date,
  p_title text,
  p_description text,
  p_duration_minutes int,
  p_genre text,
  p_poster_url text,
  p_watch_url text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_host uuid;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select host_user_id into v_host from public.activity_assignments where date = p_date;
  if v_host is null then
    raise exception 'assignment not found or no host';
  end if;
  if v_host != v_user then
    raise exception 'only host can edit movie';
  end if;

  update public.activity_assignments
  set movie_title = nullif(trim(p_title), ''),
      movie_description = nullif(trim(coalesce(p_description, '')), ''),
      movie_duration_minutes = p_duration_minutes,
      movie_genre = nullif(trim(coalesce(p_genre, '')), ''),
      movie_poster_url = nullif(trim(coalesce(p_poster_url, '')), ''),
      movie_watch_url = nullif(trim(coalesce(p_watch_url, '')), ''),
      movie_updated_at = now()
  where date = p_date;
end;
$$;

grant execute on function public.update_my_assignment_movie(date, text, text, int, text, text, text) to authenticated;

-- ============================================
-- RLS
-- ============================================

alter table public.activity_periods enable row level security;
alter table public.date_preferences enable row level security;
alter table public.activity_assignments enable row level security;

-- activity_periods: 全員閲覧可、書き込みは管理者のみ
drop policy if exists "activity_periods_select" on public.activity_periods;
create policy "activity_periods_select" on public.activity_periods
  for select to authenticated using (true);

drop policy if exists "activity_periods_insert_admin" on public.activity_periods;
create policy "activity_periods_insert_admin" on public.activity_periods
  for insert to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

drop policy if exists "activity_periods_update_admin" on public.activity_periods;
create policy "activity_periods_update_admin" on public.activity_periods
  for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

-- date_preferences: 全員閲覧可、書き込みは set_my_preferences RPC 経由のみ（ポリシー定義なし=拒否）
drop policy if exists "date_preferences_select" on public.date_preferences;
create policy "date_preferences_select" on public.date_preferences
  for select to authenticated using (true);

-- activity_assignments: 全員閲覧可、書き込みは lock_activity_period / update_my_assignment_movie RPC 経由のみ
drop policy if exists "activity_assignments_select" on public.activity_assignments;
create policy "activity_assignments_select" on public.activity_assignments
  for select to authenticated using (true);
