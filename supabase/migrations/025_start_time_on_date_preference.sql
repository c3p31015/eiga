-- ============================================
-- 025_start_time_on_date_preference.sql
-- 開始時刻を「映画」ではなく「希望日（順位）」に紐づける。
--  - 希望日数が映画数より多く、映画の無い順位でも開始時刻を入力できるようにする。
--  - 保存先は date_preferences.movie_start_time。
--  - 提出時は、すべての希望日に開始時刻が必須。
--  - 抽選では当選した希望日の開始時刻を割り当てに用いる。
-- ============================================

-- 0. 列を保証（残置されていない環境でも安全に）
alter table public.date_preferences
  add column if not exists movie_start_time time;

-- 1. set_my_date_start_time: 指定した希望日の開始時刻を設定（提出状態はリセット）
create or replace function public.set_my_date_start_time(
  p_period_id uuid,
  p_date date,
  p_start_time text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.activity_periods%rowtype;
  v_user uuid;
  v_start time;
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

  v_start := nullif(p_start_time, '')::time;

  update public.date_preferences
  set movie_start_time = v_start,
      submitted_at = null
  where user_id = v_user
    and period_id = p_period_id
    and date = p_date;

  -- 内容が変わったので映画側の提出状態もリセット
  update public.period_movie_wishes set submitted_at = null
    where user_id = v_user and period_id = p_period_id;
end;
$$;

grant execute on function public.set_my_date_start_time(uuid, date, text) to authenticated;

-- 2. submit_my_preferences: 希望日>=1 / 映画>=1 / すべての希望日に開始時刻必須
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

  select count(*) into v_date_count
  from public.date_preferences
  where user_id = v_user and period_id = p_period_id;

  if v_date_count = 0 then
    raise exception 'no preferences to submit';
  end if;

  select count(*) into v_movie_count
  from public.period_movie_wishes
  where user_id = v_user and period_id = p_period_id;

  if v_movie_count = 0 then
    raise exception 'at least one movie wish is required';
  end if;

  -- すべての希望日に開始時刻が必須（映画の無い順位も含む）
  select count(*) into v_missing_time
  from public.date_preferences
  where user_id = v_user
    and period_id = p_period_id
    and movie_start_time is null;

  if v_missing_time > 0 then
    raise exception 'start time is required for all preferred dates';
  end if;

  update public.date_preferences set submitted_at = now()
  where user_id = v_user and period_id = p_period_id;

  update public.period_movie_wishes set submitted_at = now()
  where user_id = v_user and period_id = p_period_id;
end;
$$;

grant execute on function public.submit_my_preferences(uuid) to authenticated;

-- 3. _lock_activity_period: 開始時刻は当選した希望日のものを使う。
--    （映画タイトル等は同順位の映画から、開始時刻は当選日から取得）
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
      -- 同順位の映画を提出している希望者のみを当選候補にする
      select dp.* into v_winner_pref
      from public.date_preferences dp
      where dp.period_id = p_period_id
        and dp.date = v_date
        and dp.rank = v_rank
        and dp.submitted_at is not null
        and exists (
          select 1 from public.period_movie_wishes mw
          where mw.period_id = p_period_id
            and mw.user_id = dp.user_id
            and mw.rank = v_rank
            and mw.submitted_at is not null
        )
      order by random()
      limit 1;

      if found then
        -- 当選者の「同順位の映画」を取得（exists 条件により必ず存在する）
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
          v_wish.movie_title, v_winner_pref.movie_start_time, v_wish.movie_duration_minutes,
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
