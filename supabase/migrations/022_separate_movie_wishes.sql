-- ============================================
-- 022_separate_movie_wishes.sql
-- 「観たい映画」を「希望日」から分離する。
--  - period_movie_wishes: ユーザー×期間で順位付きの映画希望を保持
--  - date_preferences は日付＋順位のみ（movie_* 列は使用停止・残置）
--  - 集計時は「希望日・第N希望」当選者の「映画・第N希望」を割り当てる
--  - 提出時、希望日の件数は映画の件数を超えてはならない
--  - 映画の開始時刻は「正の上映時間・時刻必須」のみ検証（活動時間内チェックは廃止＝案B）
-- ============================================

-- 1. 映画希望テーブル（順位付き）
create table if not exists public.period_movie_wishes (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.activity_periods(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rank int not null check (rank >= 1),
  movie_title text not null,
  movie_start_time time,
  movie_duration_minutes int,
  movie_genre text,
  movie_watch_url text,
  movie_description text,
  movie_has_gore boolean not null default false,
  submitted_at timestamptz,
  created_at timestamptz default now(),
  unique (user_id, period_id, rank)
);

create index if not exists period_movie_wishes_period_idx
  on public.period_movie_wishes(period_id);

alter table public.period_movie_wishes enable row level security;

-- 全員閲覧可、書き込みは RPC（security definer）経由のみ
drop policy if exists "period_movie_wishes_select" on public.period_movie_wishes;
create policy "period_movie_wishes_select" on public.period_movie_wishes
  for select to authenticated using (true);

-- 2. 旧: 日付ごとの映画入力 RPC は廃止
drop function if exists public.set_my_date_wish(uuid, date, text, time, int, text, text, text);
drop function if exists public.set_my_date_wish(uuid, date, text, time, int, text, text, text, boolean);

-- 3. set_my_movie_wishes: 映画希望を順位付きで一括置換（下書き）
--    p_movies は JSON 配列。配列の順序が順位（先頭=第1希望）。
--    各要素: { title, start_time, duration_minutes, genre, watch_url, description, has_gore }
create or replace function public.set_my_movie_wishes(
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
  v_elem jsonb;
  v_rank int := 0;
  v_title text;
  v_start time;
  v_duration int;
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

  -- 既存の映画希望を全削除して入れ直す
  delete from public.period_movie_wishes
    where user_id = v_user and period_id = p_period_id;

  if p_movies is not null and jsonb_typeof(p_movies) = 'array' then
    for v_elem in select * from jsonb_array_elements(p_movies) loop
      v_title := nullif(trim(coalesce(v_elem->>'title', '')), '');
      if v_title is null then
        raise exception 'movie title is required';
      end if;

      v_start := nullif(v_elem->>'start_time', '')::time;
      if v_start is null then
        raise exception 'start_time is required for %', v_title;
      end if;

      v_duration := nullif(v_elem->>'duration_minutes', '')::int;
      if v_duration is null or v_duration <= 0 then
        raise exception 'duration_minutes must be positive for %', v_title;
      end if;

      v_rank := v_rank + 1;
      insert into public.period_movie_wishes (
        period_id, user_id, rank,
        movie_title, movie_start_time, movie_duration_minutes,
        movie_genre, movie_watch_url, movie_description, movie_has_gore
      ) values (
        p_period_id, v_user, v_rank,
        v_title, v_start, v_duration,
        nullif(trim(coalesce(v_elem->>'genre', '')), ''),
        nullif(trim(coalesce(v_elem->>'watch_url', '')), ''),
        nullif(trim(coalesce(v_elem->>'description', '')), ''),
        coalesce((v_elem->>'has_gore')::boolean, false)
      );
    end loop;
  end if;

  -- 内容が変わったので、希望日・映画とも未提出に戻す
  update public.date_preferences set submitted_at = null
    where user_id = v_user and period_id = p_period_id;
end;
$$;

grant execute on function public.set_my_movie_wishes(uuid, jsonb) to authenticated;

-- 4. set_my_preferences: 希望日の保存。変更したら映画側も未提出に戻す。
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

  foreach v_date in array coalesce(p_dates, array[]::date[]) loop
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
  end loop;

  delete from public.date_preferences
  where user_id = v_user
    and period_id = p_period_id
    and not (date = any(coalesce(p_dates, array[]::date[])));

  v_rank := 1;
  foreach v_date in array coalesce(p_dates, array[]::date[]) loop
    insert into public.date_preferences (period_id, user_id, date, rank, submitted_at)
    values (p_period_id, v_user, v_date, v_rank, null)
    on conflict (user_id, period_id, date) do update set
      rank = excluded.rank,
      submitted_at = null;
    v_rank := v_rank + 1;
  end loop;

  -- 希望日が変わったら映画側の提出状態もリセット
  update public.date_preferences set submitted_at = null
    where user_id = v_user and period_id = p_period_id;
  update public.period_movie_wishes set submitted_at = null
    where user_id = v_user and period_id = p_period_id;
end;
$$;

grant execute on function public.set_my_preferences(uuid, date[]) to authenticated;

-- 5. submit_my_preferences: 希望日・映画をまとめて提出。
--    制約: 希望日が1件以上 / 希望日の件数 <= 映画の件数。
create or replace function public.submit_my_preferences(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.activity_periods%rowtype;
  v_user uuid;
  v_date_count int;
  v_movie_count int;
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

  select count(*) into v_date_count
  from public.date_preferences
  where user_id = v_user and period_id = p_period_id;

  if v_date_count = 0 then
    raise exception 'no preferences to submit';
  end if;

  select count(*) into v_movie_count
  from public.period_movie_wishes
  where user_id = v_user and period_id = p_period_id;

  if v_date_count > v_movie_count then
    raise exception 'date preferences (%) exceed movie wishes (%)', v_date_count, v_movie_count;
  end if;

  update public.date_preferences set submitted_at = now()
  where user_id = v_user and period_id = p_period_id;

  update public.period_movie_wishes set submitted_at = now()
  where user_id = v_user and period_id = p_period_id;
end;
$$;

grant execute on function public.submit_my_preferences(uuid) to authenticated;

-- 6. _lock_activity_period: 当選者の「同順位の映画」を割り当てる
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
  v_max_rank int;
  v_rank int;
  v_date date;
  v_winner_pref public.date_preferences%rowtype;
  v_wish public.period_movie_wishes%rowtype;
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
      select * into v_winner_pref
      from public.date_preferences
      where period_id = p_period_id
        and date = v_date
        and rank = v_rank
        and submitted_at is not null
      order by random()
      limit 1;

      if found then
        -- 当選者の「同順位の映画」を取得
        select * into v_wish
        from public.period_movie_wishes
        where period_id = p_period_id
          and user_id = v_winner_pref.user_id
          and rank = v_rank
          and submitted_at is not null;

        insert into public.activity_assignments (
          date, period_id, host_user_id,
          movie_title, movie_start_time, movie_duration_minutes,
          movie_genre, movie_watch_url, movie_description, movie_has_gore,
          movie_updated_at
        )
        values (
          v_date, p_period_id, v_winner_pref.user_id,
          v_wish.movie_title, v_wish.movie_start_time, v_wish.movie_duration_minutes,
          v_wish.movie_genre, v_wish.movie_watch_url, v_wish.movie_description,
          coalesce(v_wish.movie_has_gore, false),
          case when v_wish.movie_title is not null then now() else null end
        );
      end if;
    end loop;
  end loop;

  update public.activity_periods set locked_at = now() where id = p_period_id;
end;
$$;

revoke execute on function public._lock_activity_period(uuid, boolean) from public;
revoke execute on function public._lock_activity_period(uuid, boolean) from authenticated;
