-- 020_require_movie_fields_on_submit.sql
-- Do not allow submission while any selected preference is missing required movie fields.

create or replace function public.submit_my_preferences(p_period_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.activity_periods%rowtype;
  v_user uuid;
  v_count int;
  v_incomplete_count int;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select * into v_period from public.activity_periods where id = p_period_id;
  if not found then
    raise exception 'period not found';
  end if;
  if v_period.locked_at is not null then
    raise exception 'period is already locked';
  end if;
  if v_period.deadline_at <= now() then
    raise exception 'period deadline has passed';
  end if;

  select count(*) into v_count
  from public.date_preferences
  where user_id = v_user
    and period_id = p_period_id;

  if v_count = 0 then
    raise exception 'no preferences to submit';
  end if;

  select count(*) into v_incomplete_count
  from public.date_preferences
  where user_id = v_user
    and period_id = p_period_id
    and (
      nullif(trim(coalesce(movie_title, '')), '') is null
      or movie_start_time is null
      or movie_duration_minutes is null
      or movie_duration_minutes <= 0
    );

  if v_incomplete_count > 0 then
    raise exception 'required movie fields are missing';
  end if;

  update public.date_preferences
  set submitted_at = now()
  where user_id = v_user
    and period_id = p_period_id;
end;
$$;

grant execute on function public.submit_my_preferences(uuid) to authenticated;
