-- 018_submit_preferences.sql
-- 希望日の下書きと提出済みを分離する。
-- date_preferences は下書き保存にも使い、submitted_at が入っている行だけを集計対象にする。

alter table public.date_preferences
  add column if not exists submitted_at timestamptz;

create index if not exists date_preferences_submitted_period_date_idx
  on public.date_preferences(period_id, date)
  where submitted_at is not null;

-- 既存の未ロック期間の希望は提出状態を判定できないため、未提出として扱う。
-- ユーザーは申請画面で内容を確認して「提出」する必要がある。

-- 希望日の選択・並び替えは下書き保存。
-- 変更が入ったら、その月の自分の希望は未提出に戻す。
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

  foreach v_date in array coalesce(p_dates, array[]::date[]) loop
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

  delete from public.date_preferences
  where user_id = v_user
    and period_id = p_period_id
    and not (date = any(coalesce(p_dates, array[]::date[])));

  v_rank := 1;
  foreach v_date in array coalesce(p_dates, array[]::date[]) loop
    insert into public.date_preferences (period_id, user_id, date, rank, submitted_at)
    values (p_period_id, v_user, v_date, v_rank, null)
    on conflict (user_id, period_id, date) do update set
      rank = excluded.rank,
      submitted_at = null;
    v_rank := v_rank + 1;
  end loop;

  update public.date_preferences
  set submitted_at = null
  where user_id = v_user
    and period_id = p_period_id;
end;
$$;

grant execute on function public.set_my_preferences(uuid, date[]) to authenticated;

-- 現在の下書きを提出済みにする。
create or replace function public.submit_my_preferences(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.activity_periods%rowtype;
  v_user uuid;
  v_count int;
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

  select count(*) into v_count
  from public.date_preferences
  where user_id = v_user
    and period_id = p_period_id;

  if v_count = 0 then
    raise exception 'no preferences to submit';
  end if;

  update public.date_preferences
  set submitted_at = now()
  where user_id = v_user
    and period_id = p_period_id;
end;
$$;

grant execute on function public.submit_my_preferences(uuid) to authenticated;

-- 集計は提出済みの希望だけを見る。
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

grant execute on function public.lock_activity_period(uuid) to authenticated;
