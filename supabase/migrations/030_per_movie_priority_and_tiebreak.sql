-- ============================================
-- 030_per_movie_priority_and_tiebreak.sql
-- 希望順の数え方と競合の優先を修正する。
--  (1) 候補日の priority は「映画ごとに第1から」採番する
--      （029 では申請全体の通し番号にしていたのを戻す）。
--  (2) 抽選で同じ日・同じ順位（例：両方とも第1希望）に
--      "自分の複数の映画" が重なったら、先に登録した映画
--      （period_movie_wishes.rank が小さい方）を代表にする。
--      他人とは従来どおりランダム抽選。
-- 同じ日を複数映画の候補にできる点（029）と
-- unique(movie_wish_id, date) は維持する。
-- ============================================

-- A. set_my_application: priority を映画ごとにリセット（第1から）
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
  v_movie_dates date[];
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

      -- 候補日は映画ごとに第1から採番（優先順＝映画内の並び順）
      v_priority := 0;
      v_movie_dates := array[]::date[];
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
          -- 同じ映画内での同日重複だけ弾く（別の映画とは同じ日でもよい）
          if v_date = any(v_movie_dates) then
            continue;
          end if;
          v_movie_dates := array_append(v_movie_dates, v_date);

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

-- B. _lock_activity_period: 同一ユーザー内は映画の希望順を優先、他人とはランダム
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
      -- この日・この優先順の候補。まだ当選していない映画のみ。
      -- 同じユーザー内では希望順が上(rank小)の映画を代表にし、他人とはランダム。
      select pmd.* into v_winner
      from public.period_movie_dates pmd
      join public.period_movie_wishes mw on mw.id = pmd.movie_wish_id
      where pmd.period_id = p_period_id
        and pmd.date = v_date
        and pmd.priority = v_priority
        and pmd.submitted_at is not null
        and pmd.start_time is not null
        and pmd.movie_wish_id <> all(v_scheduled)
        and not exists (
          select 1
          from public.period_movie_dates pmd2
          join public.period_movie_wishes mw2 on mw2.id = pmd2.movie_wish_id
          where pmd2.period_id = p_period_id
            and pmd2.date = v_date
            and pmd2.priority = v_priority
            and pmd2.submitted_at is not null
            and pmd2.start_time is not null
            and pmd2.user_id = pmd.user_id
            and pmd2.movie_wish_id <> all(v_scheduled)
            and mw2.rank < mw.rank
        )
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
