-- ============================================
-- 011_public_calendar.sql
-- 活動日確認ページを未ログインでも閲覧できるようにする
-- 関連テーブルに anon SELECT ポリシーを追加（書き込みは authenticated のみ）
-- ============================================

-- profiles: display_name の参照のため anon にも SELECT 許可
drop policy if exists "profiles_select_anon" on public.profiles;
create policy "profiles_select_anon" on public.profiles
  for select to anon using (true);

-- activity_periods
drop policy if exists "activity_periods_select_anon" on public.activity_periods;
create policy "activity_periods_select_anon" on public.activity_periods
  for select to anon using (true);

-- activity_rules / activity_days (週次ルールと個別オーバーライド)
drop policy if exists "activity_rules_select_anon" on public.activity_rules;
create policy "activity_rules_select_anon" on public.activity_rules
  for select to anon using (true);

drop policy if exists "activity_days_select_anon" on public.activity_days;
create policy "activity_days_select_anon" on public.activity_days
  for select to anon using (true);

-- activity_assignments (確定済み主催者・上映映画)
drop policy if exists "activity_assignments_select_anon" on public.activity_assignments;
create policy "activity_assignments_select_anon" on public.activity_assignments
  for select to anon using (true);

-- activity_attendances (参加表明)
drop policy if exists "activity_attendances_select_anon" on public.activity_attendances;
create policy "activity_attendances_select_anon" on public.activity_attendances
  for select to anon using (true);
