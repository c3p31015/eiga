-- ============================================
-- 016_admin_delete_preference.sql
-- 管理者が他メンバーの希望提出を削除できるRPCを追加
-- - 管理者チェック
-- - ロック済み期間は削除不可
-- - 削除後はそのユーザーの残り希望のrankを1から振り直し
-- ============================================

create or replace function public.admin_delete_preference(p_preference_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid;
  v_pref public.date_preferences%rowtype;
  v_period public.activity_periods%rowtype;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.profiles where id = v_caller and is_admin) then
    raise exception 'admin only';
  end if;

  select * into v_pref from public.date_preferences where id = p_preference_id;
  if not found then
    raise exception 'preference not found';
  end if;

  select * into v_period from public.activity_periods where id = v_pref.period_id;
  if found and v_period.locked_at is not null then
    raise exception 'period is already locked';
  end if;

  delete from public.date_preferences where id = p_preference_id;

  -- 残りの希望の rank を 1..N に振り直し
  with renumbered as (
    select id, row_number() over (order by rank, created_at) as new_rank
    from public.date_preferences
    where user_id = v_pref.user_id and period_id = v_pref.period_id
  )
  update public.date_preferences dp
  set rank = renumbered.new_rank
  from renumbered
  where dp.id = renumbered.id
    and dp.rank <> renumbered.new_rank;
end;
$$;

grant execute on function public.admin_delete_preference(uuid) to authenticated;
