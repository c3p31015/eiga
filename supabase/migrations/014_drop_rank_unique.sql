-- ============================================
-- 014_drop_rank_unique.sql
-- 013で削除し損ねた (user_id, period_id, rank) のユニーク制約を確実に落とす
-- 並び替え時のUPSERTで一時的にrankが衝突するため、この制約があると失敗する
-- 順位の一意性は set_my_preferences RPC が保証する
-- ============================================

alter table public.date_preferences
  drop constraint if exists date_preferences_user_id_period_id_rank_key;

-- 念のため別名で作られた可能性もカバー
do $$
declare v_constraint text;
begin
  for v_constraint in
    select conname
    from pg_constraint c
    where conrelid = 'public.date_preferences'::regclass
      and contype = 'u'
      and (
        select count(*) = 3
          and bool_and(attname::text in ('user_id', 'period_id', 'rank'))
        from pg_attribute
        where attrelid = c.conrelid and attnum = any(c.conkey)
      )
  loop
    execute format('alter table public.date_preferences drop constraint %I', v_constraint);
  end loop;
end$$;
