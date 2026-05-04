-- ============================================
-- 012_extended_movie_wish.sql
-- 活動申請フォームに開始時刻・上映時間・ジャンル等を追加
-- 必須項目: タイトル / 開始時刻 / 上映時間
-- ============================================

-- 1. period_movie_wishes に列を追加 / リネーム
alter table public.period_movie_wishes
  add column if not exists movie_start_time time,
  add column if not exists movie_duration_minutes int,
  add column if not exists movie_genre text;

-- 旧列名を assignment 側と揃える
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'period_movie_wishes' and column_name = 'movie_url'
  ) then
    alter table public.period_movie_wishes rename column movie_url to movie_watch_url;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'period_movie_wishes' and column_name = 'movie_note'
  ) then
    alter table public.period_movie_wishes rename column movie_note to movie_description;
  end if;
end$$;

-- 2. activity_assignments に開始時刻列を追加（lock時にコピー）
alter table public.activity_assignments
  add column if not exists movie_start_time time;

-- 3. set_my_movie_wish RPC を新シグネチャで再定義
-- 空タイトル: 削除。タイトルあり: start_time/duration_minutes 必須
drop function if exists public.set_my_movie_wish(uuid, text, text, text);
drop function if exists public.set_my_movie_wish(uuid, text, time, int, text, text, text);

create or replace function public.set_my_movie_wish(
  p_period_id uuid,
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

  v_clean_title := nullif(trim(coalesce(p_title, '')), '');

  -- タイトル空 = 削除
  if v_clean_title is null then
    delete from public.period_movie_wishes
      where period_id = p_period_id and user_id = v_user;
    return;
  end if;

  -- タイトルあり: 開始時刻・上映時間が必須
  if p_start_time is null then
    raise exception 'start_time is required';
  end if;
  if p_duration_minutes is null or p_duration_minutes <= 0 then
    raise exception 'duration_minutes must be positive';
  end if;

  insert into public.period_movie_wishes (
    period_id, user_id,
    movie_title, movie_start_time, movie_duration_minutes,
    movie_genre, movie_watch_url, movie_description
  )
  values (
    p_period_id, v_user,
    v_clean_title, p_start_time, p_duration_minutes,
    nullif(trim(coalesce(p_genre, '')), ''),
    nullif(trim(coalesce(p_watch_url, '')), ''),
    nullif(trim(coalesce(p_description, '')), '')
  )
  on conflict (period_id, user_id) do update set
    movie_title = excluded.movie_title,
    movie_start_time = excluded.movie_start_time,
    movie_duration_minutes = excluded.movie_duration_minutes,
    movie_genre = excluded.movie_genre,
    movie_watch_url = excluded.movie_watch_url,
    movie_description = excluded.movie_description,
    updated_at = now();
end;
$$;

grant execute on function public.set_my_movie_wish(uuid, text, time, int, text, text, text) to authenticated;

-- 4. lock_activity_period: 拡張フィールドもコピー
create or replace function public.lock_activity_period(p_period_id uuid)
returns void
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
  v_winner uuid;
  v_wish public.period_movie_wishes%rowtype;
begin
  select * into v_period from public.activity_periods where id = p_period_id for update;
  if not found then
    raise exception 'period not found';
  end if;
  if v_period.locked_at is not null then
    return;
  end if;
  if v_period.deadline_at > now() then
    return;
  end if;

  v_first_day := make_date(v_period.year, v_period.month, 1);
  v_last_day := (v_first_day + interval '1 month - 1 day')::date;

  select coalesce(max(rank), 0) into v_max_rank
    from public.date_preferences
    where period_id = p_period_id;

  for v_rank in 1..v_max_rank loop
    for v_date in
      select d::date
      from generate_series(v_first_day, v_last_day, interval '1 day') as d
      where public.is_activity_day(d::date)
        and not exists (
          select 1 from public.activity_assignments where date = d::date
        )
    loop
      select user_id into v_winner
      from public.date_preferences
      where period_id = p_period_id
        and date = v_date
        and rank = v_rank
      order by random()
      limit 1;

      if v_winner is not null then
        select * into v_wish from public.period_movie_wishes
          where period_id = p_period_id and user_id = v_winner;

        insert into public.activity_assignments (
          date, period_id, host_user_id,
          movie_title, movie_start_time, movie_duration_minutes,
          movie_genre, movie_watch_url, movie_description,
          movie_updated_at
        )
        values (
          v_date, p_period_id, v_winner,
          v_wish.movie_title, v_wish.movie_start_time, v_wish.movie_duration_minutes,
          v_wish.movie_genre, v_wish.movie_watch_url, v_wish.movie_description,
          case when v_wish.movie_title is not null then now() else null end
        );
      end if;
    end loop;
  end loop;

  update public.activity_periods set locked_at = now() where id = p_period_id;
end;
$$;

grant execute on function public.lock_activity_period(uuid) to authenticated;
