-- ============================================
-- 029_shared_candidate_dates.sql
-- 「同じ活動日を複数の映画の候補日にできる」ように緩和する。
--  - これまで: period_movie_dates.unique(user_id, period_id, date) で
--    1申請内の各日は1映画のみの候補だった。
--  - これから: 同じ日を複数の映画の候補にできる。
--    優先順位は「映画を登録した順（希望順）→ その映画内の候補日の順」で決まる。
--    period_movie_dates.priority に、申請全体での通し順（1始まり）を入れる。
--    抽選(_lock_activity_period)はこの priority 昇順で処理するため、
--    先に登録した映画の候補日が優先される。
-- ============================================

-- 1. (user_id, period_id, date) のユニーク制約を撤廃し、
--    代わりに「同じ映画内で同じ日は1回まで」のユニーク制約にする。
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.period_movie_dates'::regclass and contype = 'u'
  loop
    execute format('alter table public.period_movie_dates drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.period_movie_dates
  add constraint period_movie_dates_movie_date_key unique (movie_wish_id, date);

-- 2. set_my_application: 候補日の date 重複チェックを外し、
--    priority を申請全体の通し番号（映画順→映画内の日順）にする。
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
  v_priority int := 0; -- 申請全体での通し優先順（映画順→映画内の日順）
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

      -- 候補日（映画内の順＝優先順。date は申請内で複数映画にまたがってもよい）
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
          -- 同じ映画内での同日重複だけ弾く
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
