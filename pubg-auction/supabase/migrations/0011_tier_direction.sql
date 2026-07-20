-- =====================================================================
-- 0011_tier_direction.sql
-- 지그재그 방향을 '배열 위치'가 아니라 '티어별 저장값'으로 바꾼다.
--
-- ★ 왜 (0007 draft_order → 0010 tombstone 도 못 잡은 케이스)
--   방향을 draft_order 배열에서의 인덱스로 유도하면 두 요구를 동시에 만족할 수 없다:
--     · array_remove : 앞 티어를 초기화하면 뒤(진행 중) 티어 인덱스가 당겨져 방향이 뒤집힘.
--     · tombstone(빈칸) : 죽은 자리가 남아, 초기화한 티어를 '다시' 뽑을 때 순번이 밀려 뒤집힘.
--   실측 버그: 1티어 한 명 뽑고 → 1티어 초기화 → draft_order=[''](길이1) → 다시 1티어가 역순(16팀).
--
-- ★ 해결: 방향을 티어별로 명시 저장한다. page_state.tier_direction = {"1":"asc","3":"desc"}.
--   · 어떤 티어를 '처음' 뽑는 순간, 지금까지 방향이 정해진 티어 수의 짝/홀로 방향을 확정해 저장한다
--     (0개=asc(1팀부터), 1개=desc(16팀부터), 2개=asc …).
--   · 초기화/랜덤배치는 그 티어의 키만 지운다 → 다른 티어 방향은 그대로, 그 티어는 다시 처음처럼 됨.
--   시뮬레이션으로 세 경우(초기화 후 복귀 / 진행 중 티어 보존 / 정·역·정 순차) 모두 검증.
--
-- 선행: 0001 ~ 0010 실행 완료. (재실행 안전)
-- =====================================================================

-- 컬럼 교체: draft_order(text[]) → tier_direction(jsonb 맵)
alter table public.page_state add column if not exists tier_direction jsonb not null default '{}'::jsonb;
alter table public.page_state drop column if exists draft_order;

-- [지명] 배정 + 이 티어를 처음 뽑는 것이면 방향 확정 저장.
create or replace function public.snake_assign_pick(p_target text, p_team text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_tier text;
begin
  perform public.assert_admin();

  update public.participants
    set team_name = p_team, assigned_randomly = false
    where p_token = p_target
    returning tier into v_tier;

  if v_tier is null then
    raise exception '대상 참가자를 찾을 수 없습니다.';
  end if;

  -- 이미 방향이 있으면 유지, 없으면 '지금까지 방향이 정해진 티어 수'의 짝/홀로 확정.
  -- ★ jsonb 의 키 개수는 jsonb_object_keys(set 반환)를 세어 구한다(jsonb_object_length 는 없는 함수).
  update public.page_state
    set tier_direction = case
          when tier_direction ? v_tier then tier_direction
          else tier_direction || jsonb_build_object(
                 v_tier,
                 case when (select count(*) from jsonb_object_keys(tier_direction)) % 2 = 0
                      then 'asc' else 'desc' end)
        end,
        updated_at = now()
    where id = 1;
end;
$$;
revoke execute on function public.snake_assign_pick(text, text) from public;
grant  execute on function public.snake_assign_pick(text, text) to authenticated;

-- [티어 초기화] 배정 해제 + 그 티어의 방향만 제거(다른 티어 방향은 불변).
create or replace function public.snake_reset_tier(p_tier text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_admin();
  update public.participants
    set team_name = null, assigned_randomly = false
    where tier = p_tier and is_leader = false;
  update public.page_state
    set tier_direction = tier_direction - p_tier, updated_at = now()
    where id = 1;
end;
$$;
revoke execute on function public.snake_reset_tier(text) from public;
grant  execute on function public.snake_reset_tier(text) to authenticated;

-- [티어 랜덤 배치] 16명 통째 무작위 배치 + 그 티어 방향 제거(직접 뽑은 순번이 아니므로).
create or replace function public.snake_fill_tier_randomly(p_tier text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  perform public.assert_admin();

  select count(*) into v_n from public.participants where tier = p_tier and is_leader = false;
  if v_n <> 16 then
    raise exception '% 티어의 비팀장 인원이 %명입니다. 16명이어야 합니다.', p_tier, v_n;
  end if;

  update public.participants p
    set team_name = t.team, assigned_randomly = true
    from (
      select p_token, (row_number() over (order by random()))::text || '팀' as team
      from public.participants
      where tier = p_tier and is_leader = false
    ) t
    where p.p_token = t.p_token;

  update public.page_state
    set tier_direction = tier_direction - p_tier, updated_at = now()
    where id = 1;
end;
$$;
revoke execute on function public.snake_fill_tier_randomly(text) from public;
grant  execute on function public.snake_fill_tier_randomly(text) to authenticated;

-- [팀장 추첨] 초기화 시 tier_direction 도 비운다(기존 draft_order=null → tier_direction='{}').
create or replace function public.snake_draw_leaders(p_leader_tier text, p_names text[])
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text;
  v_bad  int;
begin
  perform public.assert_admin();

  select count(*) into v_bad
    from (select tier, count(*) c from public.participants group by tier) x
    where x.c <> 16;
  if v_bad > 0 or (select count(distinct tier) from public.participants) <> 4 then
    raise exception '티어별 정확히 16명이어야 팀장 추첨을 할 수 있습니다.';
  end if;

  if p_leader_tier is not null and p_leader_tier not in ('1','2','3','4') then
    raise exception '팀장 티어 값이 올바르지 않습니다: %', p_leader_tier;
  end if;
  v_tier := coalesce(p_leader_tier, (array['1','2','3','4'])[floor(random() * 4)::int + 1]);

  update public.participants
    set team_name = null, is_leader = false, reveal_name = null, assigned_randomly = false
    where p_token is not null;
  update public.page_state
    set tier_direction = '{}'::jsonb, active_tier = null, reveal_until = null, updated_at = now()
    where id = 1;

  update public.participants
    set p_token = 'p_' || replace(gen_random_uuid()::text, '-', '')
    where p_token is not null;

  perform public.snake_reassign_anonymous(p_names);

  update public.participants p
    set is_leader = true,
        team_name = r.rn::text || '팀',
        reveal_name = s.real_name
    from (
      select p_token, row_number() over (order by random()) as rn
      from public.participants
      where tier = v_tier
    ) r
    left join public.participant_secrets s on s.p_token = r.p_token
    where p.p_token = r.p_token;

  return v_tier;
end;
$$;
revoke execute on function public.snake_draw_leaders(text, text[]) from public;
grant  execute on function public.snake_draw_leaders(text, text[]) to authenticated;

-- [팀장 해제] 마찬가지로 tier_direction 초기화.
create or replace function public.snake_release_leaders(p_names text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_admin();

  update public.participants
    set team_name = null, is_leader = false, reveal_name = null, assigned_randomly = false
    where p_token is not null;
  update public.page_state
    set tier_direction = '{}'::jsonb, active_tier = null, reveal_until = null, updated_at = now()
    where id = 1;

  update public.participants
    set p_token = 'p_' || replace(gen_random_uuid()::text, '-', '')
    where p_token is not null;

  perform public.snake_reassign_anonymous(p_names);
end;
$$;
revoke execute on function public.snake_release_leaders(text[]) from public;
grant  execute on function public.snake_release_leaders(text[]) to authenticated;
