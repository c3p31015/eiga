-- ============================================
-- 017_admin_member_management.sql
-- 管理者がメンバーアカウントを管理できるRPCを追加
-- - admin_update_member: 表示名 / 管理者フラグの更新
-- - admin_reset_password: パスワードのリセット（bcryptで上書き）
-- - admin_delete_member: アカウント削除（auth.usersから消すとprofilesへカスケード）
-- いずれも管理者のみ実行可。自分自身の削除や、最後の管理者の権限剥奪は禁止。
-- ============================================

-- 1. 表示名 / 管理者フラグの更新
create or replace function public.admin_update_member(
  p_user_id uuid,
  p_display_name text,
  p_is_admin boolean
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
        is_admin = p_is_admin
    where id = p_user_id;
  if not found then
    raise exception 'member not found';
  end if;
end;
$$;

grant execute on function public.admin_update_member(uuid, text, boolean) to authenticated;

-- 2. パスワードのリセット
-- bcryptハッシュで auth.users.encrypted_password を上書き
create or replace function public.admin_reset_password(
  p_user_id uuid,
  p_new_password text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.profiles where id = v_caller and is_admin) then
    raise exception 'admin only';
  end if;
  if p_new_password is null or length(p_new_password) < 6 then
    raise exception 'password must be at least 6 characters';
  end if;

  update auth.users
    set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf', 10)),
        updated_at = now()
    where id = p_user_id;
  if not found then
    raise exception 'user not found';
  end if;
end;
$$;

grant execute on function public.admin_reset_password(uuid, text) to authenticated;

-- 3. アカウント削除
-- auth.users から削除すると、profiles, date_preferences, activity_attendances 等へカスケード
create or replace function public.admin_delete_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.profiles where id = v_caller and is_admin) then
    raise exception 'admin only';
  end if;
  if p_user_id = v_caller then
    raise exception 'cannot delete self';
  end if;

  delete from auth.users where id = p_user_id;
  if not found then
    raise exception 'user not found';
  end if;
end;
$$;

grant execute on function public.admin_delete_member(uuid) to authenticated;
