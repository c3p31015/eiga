-- ============================================
-- 024_movie_start_time_on_rank_page.sql
-- 開始時刻の入力タイミング変更:
--  - 映画の登録（set_my_movie_wishes）では開始時刻を任意にする
--    （開始時刻は「順位・時刻」ページで後から入力する）
--  - 提出（submit_my_preferences）では、希望日と対になる順位
--    （rank <= 希望日数）の映画に開始時刻が必須。
-- ============================================

-- 1. set_my_movie_wishes: start_time を任意化（title / duration は必須のまま）
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

  delete from public.period_movie_wishes
    where user_id = v_user and period_id = p_period_id;

  if p_movies is not null and jsonb_typeof(p_movies) = 'array' then
    for v_elem in select * from jsonb_array_elements(p_movies) loop
      v_title := nullif(trim(coalesce(v_elem->>'title', '')), '');
      if v_title is null then
        raise exception 'movie title is required';
      end if;

      -- 開始時刻は任意（順位・時刻ページで後から入力）
      v_start := nullif(v_elem->>'start_time', '')::time;

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

  update public.date_preferences set submitted_at = null
    where user_id = v_user and period_id = p_period_id;
end;
$$;

grant execute on function public.set_my_movie_wishes(uuid, jsonb) to authenticated;

-- 2. submit_my_preferences: 希望日>=1 / 映画>=1 / 対になる順位の映画に開始時刻必須
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

  -- 希望日と対になる順位（rank <= 希望日数）の映画は開始時刻が必須
  select count(*) into v_missing_time
  from public.period_movie_wishes
  where user_id = v_user
    and period_id = p_period_id
    and rank <= v_date_count
    and movie_start_time is null;

  if v_missing_time > 0 then
    raise exception 'start time is required for ranked movies';
  end if;

  update public.date_preferences set submitted_at = now()
  where user_id = v_user and period_id = p_period_id;

  update public.period_movie_wishes set submitted_at = now()
  where user_id = v_user and period_id = p_period_id;
end;
$$;

grant execute on function public.submit_my_preferences(uuid) to authenticated;
