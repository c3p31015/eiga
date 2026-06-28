-- ============================================
-- 034_viewer_role.sql
-- 「閲覧者」権限を追加する。
--  - profiles.is_viewer を追加。
--  - 閲覧者は申請一覧（候補）を閲覧できるが、管理者が手動で設定した映画
--    （period_manual_assignments の予約）は閲覧できない。
--    予約テーブルの RLS は is_admin のみ select 可なので、閲覧者には見えない。
--  - admin_update_member に is_viewer を追加（表示名/管理者/閲覧者をまとめて更新）。
-- ============================================

alter table public.profiles
  add column if not exists is_viewer boolean not null default false;

-- 表示名 / 管理者フラグ / 閲覧者フラグ の更新。
-- 引数が増えるため旧シグネチャを破棄して作り直す。
drop function if exists public.admin_update_member(uuid, text, boolean);

create or replace function public.admin_update_member(
  p_user_id uuid,
  p_display_name text,
  p_is_admin boolean,
  p_is_viewer boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid;
  v_clean_name text;
  v_admin_count int;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.profiles where id = v_caller and is_admin) then
    raise exception 'admin only';
  end if;

  v_clean_name := nullif(trim(coalesce(p_display_name, '')), '');
  if v_clean_name is null then
    raise exception 'display_name cannot be empty';
  end if;

  -- 自分の管理者権限を外そうとする場合、他に管理者が居るか確認
  if p_user_id = v_caller and not p_is_admin then
    select count(*) into v_admin_count from public.profiles where is_admin;
    if v_admin_count <= 1 then
      raise exception 'cannot remove the last admin';
    end if;
  end if;

  update public.profiles
    set display_name = v_clean_name,
        is_admin = p_is_admin,
        is_viewer = coalesce(p_is_viewer, false)
    where id = p_user_id;
  if not found then
    raise exception 'member not found';
  end if;
end;
$$;

grant execute on function public.admin_update_member(uuid, text, boolean, boolean) to authenticated;
