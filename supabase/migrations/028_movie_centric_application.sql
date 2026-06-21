-- ============================================
-- 028_movie_centric_application.sql
-- 申請モデルを「映画中心」に作り替える。
--  - これまで: 希望日(順位) × 映画(順位) を同順位で結合して抽選していた。
--    第1希望日が外れて第2希望日で当選すると映画も別物に変わってしまう。
--  - これから: 1本の映画に「候補日(優先順)＋各日の開始時刻」を持たせる。
--    上位の候補日が外れても映画は固定のまま次の候補日へ落ちる。
--    1人で複数本の映画を別々の日に主催できる。
--
-- 入力テーブル:
--   period_movie_wishes … 映画（rank は表示順 position として使う）
--   period_movie_dates  … 映画ごとの候補日（新規）
-- 出力テーブル(activity_assignments)とカレンダー/参加表明は不変。
-- ============================================

-- 1. 映画ごとの候補日
create table if not exists public.period_movie_dates (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.activity_periods(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  movie_wish_id uuid not null references public.period_movie_wishes(id) on delete cascade,
  date date not null,
  priority int not null check (priority >= 1),
  start_time time,
  submitted_at timestamptz,
  created_at timestamptz default now(),
  -- 1申請内で各活動日は1映画のみの候補にできる
  unique (user_id, period_id, date)
);

create index if not exists period_movie_dates_period_date_idx
  on public.period_movie_dates(period_id, date);
create index if not exists period_movie_dates_movie_idx
  on public.period_movie_dates(movie_wish_id);

alter table public.period_movie_dates enable row level security;

-- 全員閲覧可、書き込みは security definer RPC 経由のみ（既存テーブルと同方針）
drop policy if exists "period_movie_dates_select" on public.period_movie_dates;
create policy "period_movie_dates_select" on public.period_movie_dates
  for select to authenticated using (true);

-- 2. 旧 RPC は廃止（新モデルに置換）
drop function if exists public.set_my_preferences(uuid, date[]);
drop function if exists public.set_my_movie_wishes(uuid, jsonb);
drop function if exists public.set_my_date_start_time(uuid, date, text);
drop function if exists public.submit_my_preferences(uuid);
drop function if exists public.admin_delete_preference(uuid);

-- 3. set_my_application: 映画＋候補日を一括保存（下書き）
--    p_movies は JSON 配列。配列順が映画の表示順(position)。
--    各要素: { title, duration_minutes, genre, watch_url, description,
--             has_gore, source_watchlist_id,
--             dates: [ { date, start_time }, ... ] }  -- dates 順が優先順(priority)
create or replace function public.set_my_application(
  p_period_id uuid,
  p_movies jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.activity_periods%rowtype;
  v_user uuid;
  v_movie jsonb;
  v_date_elem jsonb;
  v_position int := 0;
  v_priority int;
  v_title text;
  v_duration int;
  v_src uuid;
  v_movie_id uuid;
  v_date date;
  v_start time;
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

  -- 既存の自分の映画＋候補日を全削除（候補日は FK cascade で消えるが明示的に消す）
  delete from public.period_movie_dates
    where user_id = v_user and period_id = p_period_id;
  delete from public.period_movie_wishes
    where user_id = v_user and period_id = p_period_id;

  if p_movies is not null and jsonb_typeof(p_movies) = 'array' then
    for v_movie in select * from jsonb_array_elements(p_movies) loop
      v_title := nullif(trim(coalesce(v_movie->>'title', '')), '');
      if v_title is null then
        raise exception 'movie title is required';
      end if;

      v_duration := nullif(v_movie->>'duration_minutes', '')::int;
      if v_duration is null or v_duration <= 0 then
        raise exception 'duration_minutes must be positive for %', v_title;
      end if;

      -- 来歴は本人のリスト項目のみ採用（他人・無効なIDは無視）
      v_src := nullif(v_movie->>'source_watchlist_id', '')::uuid;
      if v_src is not null and not exists (
        select 1 from public.movie_watchlist where id = v_src and user_id = v_user
      ) then
        v_src := null;
      end if;

      v_position := v_position + 1;
      insert into public.period_movie_wishes (
        period_id, user_id, rank,
        movie_title, movie_duration_minutes,
        movie_genre, movie_watch_url, movie_description, movie_has_gore,
        source_watchlist_id
      ) values (
        p_period_id, v_user, v_position,
        v_title, v_duration,
        nullif(trim(coalesce(v_movie->>'genre', '')), ''),
        nullif(trim(coalesce(v_movie->>'watch_url', '')), ''),
        nullif(trim(coalesce(v_movie->>'description', '')), ''),
        coalesce((v_movie->>'has_gore')::boolean, false),
        v_src
      )
      returning id into v_movie_id;

      -- 候補日（優先順）
      v_priority := 0;
      if v_movie ? 'dates' and jsonb_typeof(v_movie->'dates') = 'array' then
        for v_date_elem in select * from jsonb_array_elements(v_movie->'dates') loop
          v_date := nullif(v_date_elem->>'date', '')::date;
          if v_date is null then
            continue;
          end if;
          if not public.is_activity_day(v_date) then
            raise exception 'date % is not an activity day', v_date;
          end if;
          if extract(year from v_date)::int != v_period.year
             or extract(month from v_date)::int != v_period.month then
            raise exception 'date % is not in period', v_date;
          end if;
          if v_date = any(v_seen_dates) then
            raise exception 'date % is used by more than one movie', v_date;
          end if;
          v_seen_dates := array_append(v_seen_dates, v_date);

          v_start := nullif(v_date_elem->>'start_time', '')::time;

          v_priority := v_priority + 1;
          insert into public.period_movie_dates (
            period_id, user_id, movie_wish_id, date, priority, start_time
          ) values (
            p_period_id, v_user, v_movie_id, v_date, v_priority, v_start
          );
        end loop;
      end if;
    end loop;
  end if;
end;
$$;

grant execute on function public.set_my_application(uuid, jsonb) to authenticated;

-- 4. submit_my_application: 提出。映画≥1／各映画に候補日≥1／全候補日に開始時刻必須。
create or replace function public.submit_my_application(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.activity_periods%rowtype;
  v_user uuid;
  v_movie_count int;
  v_movie_without_date int;
  v_missing_time int;
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

  select count(*) into v_movie_count
  from public.period_movie_wishes
  where user_id = v_user and period_id = p_period_id;

  if v_movie_count = 0 then
    raise exception 'at least one movie is required';
  end if;

  -- 候補日が1件も無い映画があるか
  select count(*) into v_movie_without_date
  from public.period_movie_wishes mw
  where mw.user_id = v_user and mw.period_id = p_period_id
    and not exists (
      select 1 from public.period_movie_dates d where d.movie_wish_id = mw.id
    );
  if v_movie_without_date > 0 then
    raise exception 'every movie needs at least one candidate date';
  end if;

  -- 開始時刻が未入力の候補日があるか
  select count(*) into v_missing_time
  from public.period_movie_dates
  where user_id = v_user and period_id = p_period_id
    and start_time is null;
  if v_missing_time > 0 then
    raise exception 'start time is required for all candidate dates';
  end if;

  update public.period_movie_wishes set submitted_at = now()
  where user_id = v_user and period_id = p_period_id;
  update public.period_movie_dates set submitted_at = now()
  where user_id = v_user and period_id = p_period_id;
end;
$$;

grant execute on function public.submit_my_application(uuid) to authenticated;

-- 5. admin_delete_movie_date: 管理者が候補日1件を削除（ロック前のみ）
create or replace function public.admin_delete_movie_date(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid;
  v_row public.period_movie_dates%rowtype;
  v_period public.activity_periods%rowtype;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.profiles where id = v_caller and is_admin) then
    raise exception 'admin only';
  end if;

  select * into v_row from public.period_movie_dates where id = p_id;
  if not found then
    raise exception 'candidate date not found';
  end if;

  select * into v_period from public.activity_periods where id = v_row.period_id;
  if found and v_period.locked_at is not null then
    raise exception 'period is already locked';
  end if;

  delete from public.period_movie_dates where id = p_id;

  -- 残りの候補日の priority を 1..N に振り直し（同じ映画内）
  with renumbered as (
    select id, row_number() over (order by priority, created_at) as new_priority
    from public.period_movie_dates
    where movie_wish_id = v_row.movie_wish_id
  )
  update public.period_movie_dates d
  set priority = renumbered.new_priority
  from renumbered
  where d.id = renumbered.id
    and d.priority <> renumbered.new_priority;
end;
$$;

grant execute on function public.admin_delete_movie_date(uuid) to authenticated;

-- 6. _lock_activity_period: 映画中心マッチングに書き換え
--    優先順 p=1.. で、各空き活動日にその priority の候補から1本を抽選。
--    既に割当済みの映画(movie_wish_id)は除外＝各映画は高々1日に固定で当選。
create or replace function public._lock_activity_period(
  p_period_id uuid,
  p_ignore_deadline boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.activity_periods%rowtype;
  v_first_day date;
  v_last_day date;
  v_max_priority int;
  v_priority int;
  v_date date;
  v_winner public.period_movie_dates%rowtype;
  v_wish public.period_movie_wishes%rowtype;
  v_scheduled uuid[] := array[]::uuid[];
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

  select coalesce(max(priority), 0) into v_max_priority
    from public.period_movie_dates
    where period_id = p_period_id
      and submitted_at is not null;

  for v_priority in 1..v_max_priority loop
    for v_date in
      select d::date
      from generate_series(v_first_day, v_last_day, interval '1 day') as d
      where public.is_activity_day(d::date)
        and not exists (
          select 1 from public.activity_assignments where date = d::date
        )
    loop
      -- この日・この優先順の候補のうち、まだ当選していない映画から1本を抽選
      select pmd.* into v_winner
      from public.period_movie_dates pmd
      where pmd.period_id = p_period_id
        and pmd.date = v_date
        and pmd.priority = v_priority
        and pmd.submitted_at is not null
        and pmd.start_time is not null
        and pmd.movie_wish_id <> all(v_scheduled)
      order by random()
      limit 1;

      if found then
        select * into v_wish
        from public.period_movie_wishes
        where id = v_winner.movie_wish_id;

        insert into public.activity_assignments (
          date, period_id, host_user_id,
          movie_title, movie_start_time, movie_duration_minutes,
          movie_genre, movie_watch_url, movie_description, movie_has_gore,
          movie_updated_at
        )
        values (
          v_date, p_period_id, v_winner.user_id,
          v_wish.movie_title, v_winner.start_time, v_wish.movie_duration_minutes,
          v_wish.movie_genre, v_wish.movie_watch_url, v_wish.movie_description,
          coalesce(v_wish.movie_has_gore, false),
          case when v_wish.movie_title is not null then now() else null end
        );

        v_scheduled := array_append(v_scheduled, v_winner.movie_wish_id);

        -- リストから選んだ映画が上映確定したら、本人のリストから削除する
        if v_wish.source_watchlist_id is not null then
          delete from public.movie_watchlist
            where id = v_wish.source_watchlist_id
              and user_id = v_winner.user_id;
        end if;
      end if;
    end loop;
  end loop;

  update public.activity_periods set locked_at = now() where id = p_period_id;
end;
$$;

revoke execute on function public._lock_activity_period(uuid, boolean) from public;
revoke execute on function public._lock_activity_period(uuid, boolean) from authenticated;
