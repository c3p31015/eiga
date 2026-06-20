-- ============================================
-- 023_movie_min_one_discard_surplus_dates.sql
-- 申請条件の変更:
--  1. 提出に必要な映画は「希望日と同数以上」ではなく「1件以上」とする。
--  2. 抽選時、同順位の映画が無い希望日（＝映画件数を超える下位順位）は
--     当選対象から除外して破棄する。
--     （入力した映画がすべて当選した場合に、映画の無い下位順位の希望日が
--       映画なしで割り当てられてしまうのを防ぐ）
-- ============================================

-- 1. submit_my_preferences: 希望日>=1 かつ 映画>=1 で提出可（同数制約は撤廃）
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

  if v_movie_count = 0 then
    raise exception 'at least one movie wish is required';
  end if;

  update public.date_preferences set submitted_at = now()
  where user_id = v_user and period_id = p_period_id;

  update public.period_movie_wishes set submitted_at = now()
  where user_id = v_user and period_id = p_period_id;
end;
$$;

grant execute on function public.submit_my_preferences(uuid) to authenticated;

-- 2. _lock_activity_period: 当選候補は「同順位の映画を提出している」希望日のみ。
--    同順位の映画が無い下位順位の希望日は破棄（当選対象外）。
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
