-- ============================================
-- 031_admin_manual_assignment.sql
-- 管理者が締切前でも「日付ごとに候補から1本を選んで」主催映画を
-- 手動確定できるようにする。自動抽選は従来どおり残し、手動で確定した
-- 日付は抽選対象から外れる（既存の「割当済み日付はスキップ」で成立）。
--
--  (1) activity_assignments に movie_wish_id（来歴）を追加。
--      これにより、手動で確定した映画を後続の自動抽選が
--      別の日に二重当選させないよう除外できる。
--  (2) admin_assign_movie_date: 候補日(period_movie_dates)1件を確定する。
--  (3) admin_clear_assignment: 手動確定を解除する（ロック前のみ）。
--  (4) _lock_activity_period: 既存の確定済み映画を除外して抽選し、
--      ウォッチリストの消費はロック時にまとめて行う。
--
-- ※ 公表タイミングを「集計時」へ変える変更は 032 で行う。
-- ============================================

-- (1) 来歴列。元の候補(映画)が消えても割当は残るよう on delete set null。
alter table public.activity_assignments
  add column if not exists movie_wish_id uuid
    references public.period_movie_wishes(id) on delete set null;

-- (2) 候補日1件を主催映画として手動確定する。
--     締切前でも実行可能。ロック後は不可（先にロック解除すること）。
create or replace function public.admin_assign_movie_date(p_movie_date_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid;
  v_pmd public.period_movie_dates%rowtype;
  v_period public.activity_periods%rowtype;
  v_wish public.period_movie_wishes%rowtype;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.profiles where id = v_caller and is_admin) then
    raise exception 'admin only';
  end if;

  select * into v_pmd from public.period_movie_dates where id = p_movie_date_id;
  if not found then
    raise exception 'candidate date not found';
  end if;

  select * into v_period from public.activity_periods where id = v_pmd.period_id for update;
  if not found then
    raise exception 'period not found';
  end if;
  if v_period.locked_at is not null then
    raise exception 'period is already locked';
  end if;

  if v_pmd.submitted_at is null then
    raise exception 'candidate date is not submitted';
  end if;
  if v_pmd.start_time is null then
    raise exception 'candidate date has no start time';
  end if;

  -- その日が既に（手動/自動問わず）確定済みなら、まず解除を促す。
  if exists (select 1 from public.activity_assignments where date = v_pmd.date) then
    raise exception 'date % is already decided', v_pmd.date;
  end if;

  -- 同じ映画が他の日に既に確定していないか（二重上映の防止）。
  if exists (
    select 1 from public.activity_assignments
    where period_id = v_pmd.period_id
      and movie_wish_id = v_pmd.movie_wish_id
  ) then
    raise exception 'movie is already decided on another date';
  end if;

  select * into v_wish from public.period_movie_wishes where id = v_pmd.movie_wish_id;

  insert into public.activity_assignments (
    date, period_id, host_user_id, movie_wish_id,
    movie_title, movie_start_time, movie_duration_minutes,
    movie_genre, movie_watch_url, movie_description, movie_has_gore,
    movie_updated_at
  )
  values (
    v_pmd.date, v_pmd.period_id, v_pmd.user_id, v_pmd.movie_wish_id,
    v_wish.movie_title, v_pmd.start_time, v_wish.movie_duration_minutes,
    v_wish.movie_genre, v_wish.movie_watch_url, v_wish.movie_description,
    coalesce(v_wish.movie_has_gore, false),
    case when v_wish.movie_title is not null then now() else null end
  );
  -- ウォッチリストの消費はロック時にまとめて行う（解除で巻き戻せるように）。
end;
$$;

grant execute on function public.admin_assign_movie_date(uuid) to authenticated;

-- (3) 手動確定の解除（ロック前のみ）。
create or replace function public.admin_clear_assignment(p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid;
  v_assign public.activity_assignments%rowtype;
  v_period public.activity_periods%rowtype;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.profiles where id = v_caller and is_admin) then
    raise exception 'admin only';
  end if;

  select * into v_assign from public.activity_assignments where date = p_date;
  if not found then
    raise exception 'assignment not found';
  end if;

  select * into v_period from public.activity_periods where id = v_assign.period_id;
  if found and v_period.locked_at is not null then
    raise exception 'period is already locked';
  end if;

  delete from public.activity_assignments where date = p_date;
end;
$$;

grant execute on function public.admin_clear_assignment(date) to authenticated;

-- (4) _lock_activity_period:
--     - 既に確定済み(手動)の映画(movie_wish_id)を抽選対象から除外して開始する。
--     - 抽選で確定した割当にも movie_wish_id を記録する。
--     - ウォッチリストの消費はロックの最後にまとめて行う（手動/自動を統一）。
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
  v_scheduled uuid[];
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

  -- 手動で先に確定済みの映画は二重当選させない。
  select coalesce(array_agg(movie_wish_id), array[]::uuid[])
    into v_scheduled
    from public.activity_assignments
    where period_id = p_period_id
      and movie_wish_id is not null;

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
          date, period_id, host_user_id, movie_wish_id,
          movie_title, movie_start_time, movie_duration_minutes,
          movie_genre, movie_watch_url, movie_description, movie_has_gore,
          movie_updated_at
        )
        values (
          v_date, p_period_id, v_winner.user_id, v_winner.movie_wish_id,
          v_wish.movie_title, v_winner.start_time, v_wish.movie_duration_minutes,
          v_wish.movie_genre, v_wish.movie_watch_url, v_wish.movie_description,
          coalesce(v_wish.movie_has_gore, false),
          case when v_wish.movie_title is not null then now() else null end
        );

        v_scheduled := array_append(v_scheduled, v_winner.movie_wish_id);
      end if;
    end loop;
  end loop;

  -- 上映確定した映画のうち、ウォッチリスト由来のものを本人のリストから削除する。
  -- 手動確定・自動抽選のどちらで確定した割当もここでまとめて消費する。
  delete from public.movie_watchlist w
  using public.activity_assignments a
  join public.period_movie_wishes mw on mw.id = a.movie_wish_id
  where a.period_id = p_period_id
    and a.movie_wish_id is not null
    and mw.source_watchlist_id = w.id
    and w.user_id = a.host_user_id;

  update public.activity_periods set locked_at = now() where id = p_period_id;
end;
$$;

revoke execute on function public._lock_activity_period(uuid, boolean) from public;
revoke execute on function public._lock_activity_period(uuid, boolean) from authenticated;
