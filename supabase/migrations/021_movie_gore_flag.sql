-- 021_movie_gore_flag.sql
-- Track whether a requested movie contains graphic/gory depictions.

alter table public.date_preferences
  add column if not exists movie_has_gore boolean not null default false;

alter table public.activity_assignments
  add column if not exists movie_has_gore boolean not null default false;

drop function if exists public.set_my_date_wish(uuid, date, text, time, int, text, text, text);
drop function if exists public.set_my_date_wish(uuid, date, text, time, int, text, text, text, boolean);

create or replace function public.set_my_date_wish(
  p_period_id uuid,
  p_date date,
  p_title text,
  p_start_time time,
  p_duration_minutes int,
  p_genre text,
  p_watch_url text,
  p_description text,
  p_has_gore boolean default false
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
      movie_description = null,
      movie_has_gore = false
    where user_id = v_user and period_id = p_period_id and date = p_date;
    return;
  end if;

  if p_start_time is null then
    raise exception 'start_time is required';
  end if;
  if p_duration_minutes is null or p_duration_minutes <= 0 then
    raise exception 'duration_minutes must be positive';
  end if;

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
    movie_description = nullif(trim(coalesce(p_description, '')), ''),
    movie_has_gore = coalesce(p_has_gore, false)
  where user_id = v_user and period_id = p_period_id and date = p_date;
end;
$$;

grant execute on function public.set_my_date_wish(uuid, date, text, time, int, text, text, text, boolean) to authenticated;

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
        insert into public.activity_assignments (
          date, period_id, host_user_id,
          movie_title, movie_start_time, movie_duration_minutes,
          movie_genre, movie_watch_url, movie_description, movie_has_gore,
          movie_updated_at
        )
        values (
          v_date, p_period_id, v_winner_pref.user_id,
          v_winner_pref.movie_title, v_winner_pref.movie_start_time, v_winner_pref.movie_duration_minutes,
          v_winner_pref.movie_genre, v_winner_pref.movie_watch_url, v_winner_pref.movie_description,
          v_winner_pref.movie_has_gore,
          case when v_winner_pref.movie_title is not null then now() else null end
        );
      end if;
    end loop;
  end loop;

  update public.activity_periods set locked_at = now() where id = p_period_id;
end;
$$;

revoke execute on function public._lock_activity_period(uuid, boolean) from public;
revoke execute on function public._lock_activity_period(uuid, boolean) from authenticated;
