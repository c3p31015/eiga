-- ============================================
-- 投票ルール: 1日1票、前日23:59締切、自動確定
-- ============================================

-- 1. 既存の重複投票を掃除（同一ユーザー×同一日で複数ある場合、最古を残して削除）
delete from public.votes v1
using public.votes v2
where v1.user_id = v2.user_id
  and v1.date = v2.date
  and v1.id <> v2.id
  and v1.created_at > v2.created_at;

-- 2. 既存の unique 制約を張り替え
alter table public.votes drop constraint if exists votes_user_id_movie_id_date_key;
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'votes_user_id_date_key'
  ) then
    alter table public.votes add constraint votes_user_id_date_key unique (user_id, date);
  end if;
end $$;

-- 3. 締め切り判定: 活動日 d の日本時間 00:00 が deadline
create or replace function public.is_voting_open(d date)
returns boolean
language sql
stable
as $$
  select public.is_activity_day(d)
    and now() < (d::timestamp at time zone 'Asia/Tokyo');
$$;

-- 4. votes_insert ポリシー更新: 締め切り前のみ可
drop policy if exists "votes_insert" on public.votes;
create policy "votes_insert" on public.votes
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and public.is_voting_open(date)
  );

-- 5. votes_update ポリシー追加: 自分の投票を映画差し替え可（締め切り前）
create policy "votes_update" on public.votes
  for update to authenticated
  using (auth.uid() = user_id and public.is_voting_open(date))
  with check (auth.uid() = user_id and public.is_voting_open(date));

-- 6. votes_delete ポリシー更新: 締め切り前のみ取消可
drop policy if exists "votes_delete" on public.votes;
create policy "votes_delete" on public.votes
  for delete to authenticated
  using (auth.uid() = user_id and public.is_voting_open(date));

-- 7. activity_decisions テーブル: 確定済みの上映作品
create table if not exists public.activity_decisions (
  date date primary key,
  movie_id uuid references public.movies(id) on delete set null,
  locked_at timestamptz not null default now(),
  method text not null default 'auto'
);

alter table public.activity_decisions enable row level security;

create policy "activity_decisions_select" on public.activity_decisions
  for select to authenticated using (true);

-- INSERT/UPDATE/DELETE はクライアントから直接は不可。lock_activity_decision() 経由のみ

-- 8. 確定 RPC: 締め切り済み・未確定の日に呼ぶと勝者を決めて保存
create or replace function public.lock_activity_decision(d date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_movie uuid;
  decided_movie uuid;
begin
  -- 既に確定済みならそれを返す
  select movie_id into existing_movie from public.activity_decisions where date = d;
  if found then
    return existing_movie;
  end if;

  -- 活動日でない / まだ締め切り前 → null を返すだけで insert しない
  if not public.is_activity_day(d) then
    return null;
  end if;
  if now() < (d::timestamp at time zone 'Asia/Tokyo') then
    return null;
  end if;

  -- 勝者選出: 最多票 → 同票は random()
  select movie_id into decided_movie
  from public.votes
  where date = d
  group by movie_id
  order by count(*) desc, random()
  limit 1;

  -- 票0でも確定レコードは作る（method='auto', movie_id=null）
  insert into public.activity_decisions (date, movie_id, locked_at, method)
  values (d, decided_movie, now(), 'auto')
  on conflict (date) do nothing;

  -- レースしても最終的に保存された値を返す
  select movie_id into decided_movie from public.activity_decisions where date = d;
  return decided_movie;
end;
$$;

-- 認証済みユーザーにRPC実行を許可
grant execute on function public.lock_activity_decision(date) to authenticated;
