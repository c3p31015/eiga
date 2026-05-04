-- ============================================
-- 活動日に教室を追加
-- ============================================

alter table public.activity_rules add column if not exists room text;
alter table public.activity_days add column if not exists room text;
