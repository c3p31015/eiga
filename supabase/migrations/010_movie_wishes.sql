-- ============================================
-- 010_movie_wishes.sql
-- 活動申請時に「観たい映画」も登録できるようにする
-- 主催者確定時にwishをactivity_assignmentsへコピー
-- ============================================

-- 1. period_movie_wishes テーブル
create table if not exists public.period_movie_wishes (
  period_id uuid not null references public.activity_periods(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  movie_title text not null,
  movie_url text,
  movie_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (period_id, user_id)
);

-- 2. RLS
alter table public.period_movie_wishes enable row level security;

drop policy if exists "movie_wishes_select" on public.period_movie_wishes;
create policy "movie_wishes_select" on public.period_movie_wishes
  for select to authenticated using (true);
-- 書き込みは set_my_movie_wish RPC のみ（ポリシー定義なし=拒否）

-- 3. set_my_movie_wish RPC
-- 空タイトルなら削除、それ以外は upsert
create or replace function public.set_my_movie_wish(
  p_period_id uuid,
  p_title text,
  p_url text,
  p_note text
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
  if v_clean_title is null then
    delete from public.period_movie_wishes
      where period_id = p_period_id and user_id = v_user;
    return;
  end if;

  insert into public.period_movie_wishes (period_id, user_id, movie_title, movie_url, movie_note)
  values (
    p_period_id,
    v_user,
    v_clean_title,
    nullif(trim(coalesce(p_url, '')), ''),
    nullif(trim(coalesce(p_note, '')), '')
  )
  on conflict (period_id, user_id) do update set
    movie_title = excluded.movie_title,
    movie_url = excluded.movie_url,
    movie_note = excluded.movie_note,
    updated_at = now();
end;
$$;

grant execute on function public.set_my_movie_wish(uuid, text, text, text) to authenticated;

-- 4. lock_activity_period を更新: 当選者の wish を assignment にコピー
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
          movie_title, movie_watch_url, movie_description,
          movie_updated_at
        )
        values (
          v_date, p_period_id, v_winner,
          v_wish.movie_title, v_wish.movie_url, v_wish.movie_note,
          case when v_wish.movie_title is not null then now() else null end
        );
      end if;
    end loop;
  end loop;

  update public.activity_periods set locked_at = now() where id = p_period_id;
end;
$$;

grant execute on function public.lock_activity_period(uuid) to authenticated;
