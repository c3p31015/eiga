-- ============================================
-- 033_admin_delete_movie_wish.sql
-- 管理者が「映画（希望）」を丸ごと削除できるようにする（ロック前のみ）。
-- 候補日(period_movie_dates)・手動選択の予約(period_manual_assignments)は
-- FK の on delete cascade で一緒に消える。
-- 残った映画の rank（表示順）は 1..N に振り直す。
-- ============================================

create or replace function public.admin_delete_movie_wish(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid;
  v_row public.period_movie_wishes%rowtype;
  v_period public.activity_periods%rowtype;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.profiles where id = v_caller and is_admin) then
    raise exception 'admin only';
  end if;

  select * into v_row from public.period_movie_wishes where id = p_id;
  if not found then
    raise exception 'movie wish not found';
  end if;

  select * into v_period from public.activity_periods where id = v_row.period_id;
  if found and v_period.locked_at is not null then
    raise exception 'period is already locked';
  end if;

  delete from public.period_movie_wishes where id = p_id;

  -- 残りの映画の rank を 1..N に振り直す（同じユーザー内）。
  with renumbered as (
    select id, row_number() over (order by rank, created_at) as new_rank
    from public.period_movie_wishes
    where period_id = v_row.period_id
      and user_id = v_row.user_id
  )
  update public.period_movie_wishes w
  set rank = renumbered.new_rank
  from renumbered
  where w.id = renumbered.id
    and w.rank <> renumbered.new_rank;
end;
$$;

grant execute on function public.admin_delete_movie_wish(uuid) to authenticated;
