-- 019_manual_lock_before_deadline.sql
-- Keep the existing lock_activity_period RPC for deadline-based automatic locking,
-- and add a manual admin RPC that can lock immediately before the deadline.

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
          movie_genre, movie_watch_url, movie_description,
          movie_updated_at
        )
        values (
          v_date, p_period_id, v_winner_pref.user_id,
          v_winner_pref.movie_title, v_winner_pref.movie_start_time, v_winner_pref.movie_duration_minutes,
          v_winner_pref.movie_genre, v_winner_pref.movie_watch_url, v_winner_pref.movie_description,
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
