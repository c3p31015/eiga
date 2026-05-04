-- ============================================
-- comments テーブルを Realtime publication に追加
-- Supabase の SQL Editor で実行してください
--
-- 代替: Supabase ダッシュボード > Table Editor > comments
--   > 右上の「Realtime」トグルをONでも同じ効果
-- ============================================

alter publication supabase_realtime add table public.comments;
