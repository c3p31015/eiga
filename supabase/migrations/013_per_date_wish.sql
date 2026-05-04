-- ============================================
-- 013_per_date_wish.sql
-- 観たい映画を「希望日ごと」に持たせるデータモデルへ再設計
-- - date_preferences に movie_* 列を追加
-- - period_movie_wishes を廃止
-- - set_my_date_wish RPC 追加
-- - set_my_preferences を保全型に変更（再保存しても映画情報が消えない）
-- - lock_activity_period は当選した date_preferences 行から映画情報を assignment にコピー
-- ============================================

-- 1. date_preferences に映画情報の列を追加
alter table public.date_preferences
  add column if not exists movie_title text,
  add column if not exists movie_start_time time,
  add column if not exists movie_duration_minutes int,
  add column if not exists movie_genre text,
  add column if not exists movie_watch_url text,
  add column if not exists movie_description text;

-- 2. (user_id, period_id, rank) のユニーク制約を撤去
-- 並び替え時のUPSERTで一時的に衝突するため。順位の一意性は RPC 側で担保。
do $$
declare v_constraint text;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.date_preferences'::regclass
      and contype = 'u'
      and (
        select array_agg(attname::text order by attnum)
        from pg_attribute
        where attrelid = pg_constraint.conrelid and attnum = any(pg_constraint.conkey)
      ) = array['user_id', 'period_id', 'rank']::text[]
  loop
    execute format('alter table public.date_preferences drop constraint %I', v_constraint);
  end loop;
end$$;

-- 3. 旧テーブル / RPC を削除
drop function if exists public.set_my_movie_wish(uuid, text, text, text);
drop function if exists public.set_my_movie_wish(uuid, text, time, int, text, text, text);
drop table if exists public.period_movie_wishes cascade;

-- 4. set_my_preferences を保全型に変更
-- 既存の date_preferences 行があれば残し rank だけ更新、無いものは新規追加、入力に無いものは削除
create or replace function public.set_my_preferences(
  p_period_id uuid,
  p_dates date[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.activity_periods%rowtype;
  v_user uuid;
  v_date date;
  v_rank int;
  v_seen_dates date[] := array[]::date[];
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

  -- 入力検証
  foreach v_date in array p_dates loop
    if v_date = any(v_seen_dates) then
      raise exception 'duplicate date %', v_date;
    end if;
    v_seen_dates := array_append(v_seen_dates, v_date);

    if not public.is_activity_day(v_date) then
      raise exception 'date % is not an activity day', v_date;
    end if;
    if extract(year from v_date)::int != v_period.year
       or extract(month from v_date)::int != v_period.month then
      raise exception 'date % is not in period', v_date;
    end if;
  end loop;

  -- 入力に含まれない日付を削除（映画情報も一緒に消える）
  delete from public.date_preferences
  where user_id = v_user
    and period_id = p_period_id
    and not (date = any(coalesce(p_dates, array[]::date[])));

  -- 入力配列の順序で rank を再付与
  v_rank := 1;
  foreach v_date in array p_dates loop
    insert into public.date_preferences (period_id, user_id, date, rank)
    values (p_period_id, v_user, v_date, v_rank)
    on conflict (user_id, period_id, date) do update set rank = excluded.rank;
    v_rank := v_rank + 1;
  end loop;
end;
$$;

grant execute on function public.set_my_preferences(uuid, date[]) to authenticated;

-- 5. set_my_date_wish: 希望日1件分の映画情報を更新
-- タイトル空: 映画情報を全クリア（希望日自体は残る）
-- タイトルあり: start_time / duration_minutes 必須
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

-- 6. lock_activity_period: 当選した date_preferences 行から映画情報をコピー
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
  v_winner_pref public.date_preferences%rowtype;
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
      select * into v_winner_pref
      from public.date_preferences
      where period_id = p_period_id
        and date = v_date
        and rank = v_rank
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

grant execute on function public.lock_activity_period(uuid) to authenticated;
