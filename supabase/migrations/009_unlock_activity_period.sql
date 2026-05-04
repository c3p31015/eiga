-- ============================================
-- 009_unlock_activity_period.sql
-- 管理者が集計済みの期間をロック解除できるようにする
-- (locked_at をクリアし、その期間の activity_assignments を削除)
-- ============================================

create or replace function public.unlock_activity_period(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and is_admin
  ) then
    raise exception 'admin only';
  end if;

  delete from public.activity_assignments where period_id = p_period_id;
  update public.activity_periods set locked_at = null where id = p_period_id;
end;
$$;

grant execute on function public.unlock_activity_period(uuid) to authenticated;
