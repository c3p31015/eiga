-- ============================================
-- 027_watchlist_consume_on_confirm.sql
-- 「観たい映画リストから追加した映画」が上映作品として確定したら、
-- その映画をリストから自動削除する。
--  - period_movie_wishes に source_watchlist_id を追加して来歴を保持
--    （タイトル一致ではなく、リストから選んだ映画だけを対象にする）
--  - set_my_movie_wishes: source_watchlist_id を保存（本人のリスト項目のみ採用）
--  - _lock_activity_period: 当選＝上映確定時に、来歴のあるリスト項目を削除
-- ============================================

-- 1. 来歴列。リスト項目が消えても希望は残るよう on delete set null。
alter table public.period_movie_wishes
  add column if not exists source_watchlist_id uuid
    references public.movie_watchlist(id) on delete set null;

-- 2. set_my_movie_wishes: source_watchlist_id を受け取り保存する
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
  v_src uuid;
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

      -- 来歴は本人のリスト項目のみ採用（他人・無効なIDは無視）
      v_src := nullif(v_elem->>'source_watchlist_id', '')::uuid;
      if v_src is not null and not exists (
        select 1 from public.movie_watchlist where id = v_src and user_id = v_user
      ) then
        v_src := null;
      end if;

      v_rank := v_rank + 1;
      insert into public.period_movie_wishes (
        period_id, user_id, rank,
        movie_title, movie_start_time, movie_duration_minutes,
        movie_genre, movie_watch_url, movie_description, movie_has_gore,
        source_watchlist_id
      ) values (
        p_period_id, v_user, v_rank,
        v_title, v_start, v_duration,
        nullif(trim(coalesce(v_elem->>'genre', '')), ''),
        nullif(trim(coalesce(v_elem->>'watch_url', '')), ''),
        nullif(trim(coalesce(v_elem->>'description', '')), ''),
        coalesce((v_elem->>'has_gore')::boolean, false),
        v_src
      );
    end loop;
  end if;

  update public.date_preferences set submitted_at = null
    where user_id = v_user and period_id = p_period_id;
end;
$$;

grant execute on function public.set_my_movie_wishes(uuid, jsonb) to authenticated;

-- 3. _lock_activity_period: 上映確定時に来歴のあるリスト項目を削除
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

        -- リストから選んだ映画が上映確定したら、本人のリストから削除する
        if v_wish.source_watchlist_id is not null then
          delete from public.movie_watchlist
            where id = v_wish.source_watchlist_id
              and user_id = v_winner_pref.user_id;
        end if;
      end if;
    end loop;
  end loop;

  update public.activity_periods set locked_at = now() where id = p_period_id;
end;
$$;

revoke execute on function public._lock_activity_period(uuid, boolean) from public;
revoke execute on function public._lock_activity_period(uuid, boolean) from authenticated;
