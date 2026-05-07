-- ============================================
-- 015_validate_wish_within_activity_hours.sql
-- 観たい映画の開始時刻〜終了時刻が、その日の活動時間内に収まることを保証する
-- - resolve_activity_window: 日付から (start_time, end_time) を解決するヘルパ
-- - set_my_date_wish: 開始/終了が活動時間外なら例外
-- ============================================

-- 1. その日の活動時間を解決するヘルパ
-- activity_days で上書きされていればそれを優先、無ければ activity_rules を使う
-- 上書き行で start/end が NULL なら rule の値にフォールバック
create or replace function public.resolve_activity_window(d date)
returns table(active boolean, start_time time, end_time time)
language plpgsql
stable
as $$
declare
  v_override public.activity_days%rowtype;
  v_override_exists boolean;
  v_rule public.activity_rules%rowtype;
begin
  select * into v_override from public.activity_days where date = d;
  v_override_exists := found;
  select * into v_rule from public.activity_rules
    where weekday = extract(isodow from d)::int;

  if v_override_exists then
    if v_override.is_active then
      return query select
        true,
        coalesce(v_override.start_time, v_rule.start_time),
        coalesce(v_override.end_time, v_rule.end_time);
      return;
    end if;
    return query select false, null::time, null::time;
    return;
  end if;

  if coalesce(v_rule.enabled, false) then
    return query select true, v_rule.start_time, v_rule.end_time;
    return;
  end if;

  return query select false, null::time, null::time;
end;
$$;

grant execute on function public.resolve_activity_window(date) to authenticated;

-- 2. set_my_date_wish に活動時間チェックを追加
create or replace function public.set_my_date_wish(
  p_period_id uuid,
  p_date date,
  p_title text,
  p_start_time time,
  p_duration_minutes int,
  p_genre text,
  p_watch_url text,
  p_description text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.activity_periods%rowtype;
  v_user uuid;
  v_clean_title text;
  v_window record;
  v_end_minutes int;
  v_window_end_minutes int;
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

  if not exists (
    select 1 from public.date_preferences
    where user_id = v_user and period_id = p_period_id and date = p_date
  ) then
    raise exception 'date % is not in your preferences', p_date;
  end if;

  v_clean_title := nullif(trim(coalesce(p_title, '')), '');

  if v_clean_title is null then
    update public.date_preferences set
      movie_title = null,
      movie_start_time = null,
      movie_duration_minutes = null,
      movie_genre = null,
      movie_watch_url = null,
      movie_description = null
    where user_id = v_user and period_id = p_period_id and date = p_date;
    return;
  end if;

  if p_start_time is null then
    raise exception 'start_time is required';
  end if;
  if p_duration_minutes is null or p_duration_minutes <= 0 then
    raise exception 'duration_minutes must be positive';
  end if;

  -- 活動時間外チェック
  select * into v_window from public.resolve_activity_window(p_date);
  if v_window.start_time is not null and p_start_time < v_window.start_time then
    raise exception 'start_time % is before activity start %', p_start_time, v_window.start_time;
  end if;
  if v_window.end_time is not null then
    v_end_minutes := (extract(hour from p_start_time)::int) * 60
                   + (extract(minute from p_start_time)::int)
                   + p_duration_minutes;
    v_window_end_minutes := (extract(hour from v_window.end_time)::int) * 60
                          + (extract(minute from v_window.end_time)::int);
    if v_end_minutes > v_window_end_minutes then
      raise exception 'movie end time exceeds activity end %', v_window.end_time;
    end if;
  end if;

  update public.date_preferences set
    movie_title = v_clean_title,
    movie_start_time = p_start_time,
    movie_duration_minutes = p_duration_minutes,
    movie_genre = nullif(trim(coalesce(p_genre, '')), ''),
    movie_watch_url = nullif(trim(coalesce(p_watch_url, '')), ''),
    movie_description = nullif(trim(coalesce(p_description, '')), '')
  where user_id = v_user and period_id = p_period_id and date = p_date;
end;
$$;

grant execute on function public.set_my_date_wish(uuid, date, text, time, int, text, text, text) to authenticated;
