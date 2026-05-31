-- ============================================
-- 映画鑑賞サークル — Supabase データベーススキーマ
-- 投票方式: 希望順位マッチング（多数決ではない）
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

-- 2. activity_rules テーブル（曜日ごとの活動日ルール）
create table public.activity_rules (
  weekday int primary key check (weekday between 1 and 7),
  enabled boolean not null default false,
  start_time time not null default '19:00',
  end_time time not null default '21:00',
  room text,
  updated_at timestamptz default now()
);

insert into public.activity_rules (weekday, enabled, start_time, end_time) values
  (1, false, '19:00', '21:00'),
  (2, false, '19:00', '21:00'),
  (3, false, '19:00', '21:00'),
  (4, false, '19:00', '21:00'),
  (5, false, '19:00', '21:00');

-- 3. activity_days テーブル（日付単位の上書き）
create table public.activity_days (
  date date primary key,
  is_active boolean not null,
  start_time time,
  end_time time,
  room text,
  note text,
  updated_at timestamptz default now()
);

-- 4. is_activity_day 関数
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

-- 5. activity_attendances テーブル: 活動日への参加表明
create table public.activity_attendances (
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  status text not null check (status in ('going', 'not_going')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (user_id, date)
);

create index activity_attendances_date_idx on public.activity_attendances(date);

-- ============================================
-- 希望順位マッチング関連
-- ============================================

-- 6. activity_periods テーブル: 月単位の希望提出期間
create table public.activity_periods (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  month int not null check (month between 1 and 12),
  deadline_at timestamptz not null,
  locked_at timestamptz,
  created_at timestamptz default now(),
  unique (year, month)
);

-- 7. date_preferences テーブル: ユーザーの希望順位
create table public.date_preferences (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.activity_periods(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  rank int not null check (rank >= 1),
  submitted_at timestamptz,
  movie_has_gore boolean not null default false,
  created_at timestamptz default now(),
  unique (user_id, period_id, date),
  unique (user_id, period_id, rank)
);

create index date_preferences_period_date_idx
  on public.date_preferences(period_id, date);

-- 8. activity_assignments テーブル: 集計後の主催者と映画
create table public.activity_assignments (
  date date primary key,
  period_id uuid not null references public.activity_periods(id) on delete cascade,
  host_user_id uuid references public.profiles(id) on delete set null,
  movie_title text,
  movie_description text,
  movie_duration_minutes int,
  movie_genre text,
  movie_poster_url text,
  movie_watch_url text,
  movie_has_gore boolean not null default false,
  locked_at timestamptz not null default now(),
  movie_updated_at timestamptz
);

create index activity_assignments_period_idx
  on public.activity_assignments(period_id);

-- 9. ensure_period RPC: 月の期間レコードを取得 or 作成
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

-- 10. set_my_preferences RPC: 自分の希望順位を一括置換
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

create or replace function public.submit_my_preferences(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.activity_periods%rowtype;
  v_user uuid;
  v_count int;
  v_incomplete_count int;
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

  select count(*) into v_count
  from public.date_preferences
  where user_id = v_user and period_id = p_period_id;

  if v_count = 0 then
    raise exception 'no preferences to submit';
  end if;

  select count(*) into v_incomplete_count
  from public.date_preferences
  where user_id = v_user
    and period_id = p_period_id
    and (
      nullif(trim(coalesce(movie_title, '')), '') is null
      or movie_start_time is null
      or movie_duration_minutes is null
      or movie_duration_minutes <= 0
    );

  if v_incomplete_count > 0 then
    raise exception 'required movie fields are missing';
  end if;

  update public.date_preferences
  set submitted_at = now()
  where user_id = v_user and period_id = p_period_id;
end;
$$;

grant execute on function public.submit_my_preferences(uuid) to authenticated;

-- 11. lock_activity_period RPC: 段階的マッチングで主催者を確定
create or replace function public._lock_activity_period(
  p_period_id uuid,
  p_ignore_deadline boolean
)
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
  if not p_ignore_deadline and v_period.deadline_at > now() then
    return;
  end if;

  v_first_day := make_date(v_period.year, v_period.month, 1);
  v_last_day := (v_first_day + interval '1 month - 1 day')::date;

  select coalesce(max(rank), 0) into v_max_rank
    from public.date_preferences
    where period_id = p_period_id
      and submitted_at is not null;

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
        and submitted_at is not null
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

revoke execute on function public._lock_activity_period(uuid, boolean) from public;
revoke execute on function public._lock_activity_period(uuid, boolean) from authenticated;

create or replace function public.lock_activity_period(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._lock_activity_period(p_period_id, false);
end;
$$;

grant execute on function public.lock_activity_period(uuid) to authenticated;

create or replace function public.lock_activity_period_now(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and is_admin
  ) then
    raise exception 'admin only';
  end if;

  perform public._lock_activity_period(p_period_id, true);
end;
$$;

grant execute on function public.lock_activity_period_now(uuid) to authenticated;

-- 12. update_my_assignment_movie RPC: 主催者本人が映画情報を更新
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
-- Row Level Security (RLS)
-- ============================================

alter table public.profiles enable row level security;
alter table public.activity_rules enable row level security;
alter table public.activity_days enable row level security;
alter table public.activity_attendances enable row level security;
alter table public.activity_periods enable row level security;
alter table public.date_preferences enable row level security;
alter table public.activity_assignments enable row level security;

-- profiles: 認証済みユーザーは全員閲覧可
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

create policy "profiles_update" on public.profiles
  for update to authenticated using (id = auth.uid());

create policy "profiles_insert" on public.profiles
  for insert to authenticated with check (true);

-- activity_rules: 全員閲覧可、管理者のみ更新可
create policy "activity_rules_select" on public.activity_rules
  for select to authenticated using (true);
create policy "activity_rules_update" on public.activity_rules
  for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

-- activity_days: 全員閲覧可、管理者のみ編集可
create policy "activity_days_select" on public.activity_days
  for select to authenticated using (true);
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

-- activity_attendances: 全員閲覧可、自分の参加表明のみ操作可
create policy "activity_attendances_select" on public.activity_attendances
  for select to authenticated using (true);
create policy "activity_attendances_insert" on public.activity_attendances
  for insert to authenticated
  with check (auth.uid() = user_id and public.is_activity_day(date));
create policy "activity_attendances_update" on public.activity_attendances
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "activity_attendances_delete" on public.activity_attendances
  for delete to authenticated
  using (auth.uid() = user_id);

-- activity_periods: 全員閲覧可、書き込みは管理者のみ
create policy "activity_periods_select" on public.activity_periods
  for select to authenticated using (true);
create policy "activity_periods_insert_admin" on public.activity_periods
  for insert to authenticated
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin));
create policy "activity_periods_update_admin" on public.activity_periods
  for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin));

-- date_preferences: 全員閲覧可、書き込みは set_my_preferences RPC 経由のみ
create policy "date_preferences_select" on public.date_preferences
  for select to authenticated using (true);

-- activity_assignments: 全員閲覧可、書き込みは RPC 経由のみ
create policy "activity_assignments_select" on public.activity_assignments
  for select to authenticated using (true);
