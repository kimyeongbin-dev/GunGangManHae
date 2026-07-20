-- =====================================================================
-- 0007_integrity_and_atomic_ops.sql
-- 점검 보고서(docs/audit-2026-07-20.md)의 1·2·4번 조치.
--
--   (1) page_state.draft_order : 스네이크 '뽑은 순번'을 기록해 지그재그 방향을 고정한다.
--       기존에는 방향을 매 렌더 "지금 완료된 티어 수"로 재계산해서, 완료된 티어의 지명을
--       하나 취소하면 진행 중 티어의 방향이 소급해서 뒤집혔다.
--
--   (2) 파괴적 연산을 원자적 RPC로 이관 : 추첨/익명재배정/랜덤배치/순서리롤/지명.
--       기존 클라이언트는 64건을 8건씩 나눠 PATCH해서, 중간 실패 시 절반만 반영된
--       상태로 남았다(슬롯 중복 → 그리드에서 참가자 소실). 한 트랜잭션으로 묶어 해소한다.
--       덤으로 RLS 0행 무시 문제도 사라진다 — 권한이 없으면 예외가 난다.
--
--   (4) 무결성 제약 : 팀당 티어별 1명 / 슬롯 유일 / 티어·팀명·딜량 값 검증.
--       ★ 유니크 제약은 반드시 DEFERRABLE 이어야 한다. 순서 리롤이나 슬롯 셔플은
--         값을 '순열'로 바꾸므로 행 단위 즉시 검사면 전이적 중복으로 실패한다.
--         DEFERRABLE INITIALLY DEFERRED 로 두면 트랜잭션 커밋 시점에 한 번만 검사한다.
--         → 그래서 (2)의 원자적 RPC가 (4)의 전제 조건이다.
--
-- 선행: 0001 ~ 0006 실행 완료. (재실행 안전)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) 뽑은 순번 기록
--    직접 지명으로 처음 뽑기 시작한 티어를 순서대로 append 한다.
--    · 지명 취소는 이 배열을 건드리지 않는다 → 과거 순번이 보존돼 방향이 안 뒤집힌다.
--    · 티어 초기화 / 랜덤 배치는 그 티어를 배열에서 제거한다(직접 뽑은 티어가 아니게 되므로).
--    방향 = 배열에서의 위치 % 2 (짝수=정순 1팀부터, 홀수=역순 16팀부터).
-- ---------------------------------------------------------------------
alter table public.page_state add column if not exists draft_order text[];

-- ---------------------------------------------------------------------
-- 2) 무결성 제약
--    기존 데이터가 이미 위반 중이면 add constraint 가 실패하므로, 먼저 정리한다.
-- ---------------------------------------------------------------------

-- 값 범위 검증 (즉시 검사여도 순열 문제가 없다)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'participants_tier_chk') then
    alter table public.participants
      add constraint participants_tier_chk check (tier in ('1','2','3','4'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'participants_slot_range_chk') then
    alter table public.participants
      add constraint participants_slot_range_chk check (slot_index between 0 and 63);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'participants_damage_chk') then
    alter table public.participants
      add constraint participants_damage_chk check (avg_damage >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'participants_team_fmt_chk') then
    alter table public.participants
      add constraint participants_team_fmt_chk
      check (team_name is null or team_name ~ '^([1-9]|1[0-6])팀$');
  end if;
end $$;

-- 유일성 제약 (반드시 DEFERRABLE — 위 주석 참고)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'participants_slot_uniq') then
    alter table public.participants
      add constraint participants_slot_uniq unique (slot_index)
      deferrable initially deferred;
  end if;

  -- 팀당 티어별 1명. team_name 이 null 인 행끼리는 유니크 검사에서 서로 다른 것으로 취급되므로
  -- (SQL 표준: NULL은 서로 같지 않다) 미배정 인원 다수가 공존해도 문제없다.
  if not exists (select 1 from pg_constraint where conname = 'participants_team_tier_uniq') then
    alter table public.participants
      add constraint participants_team_tier_uniq unique (team_name, tier)
      deferrable initially deferred;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3) 원자적 연산 RPC
--    전부 SECURITY DEFINER + is_admin() 재검사 + PUBLIC EXECUTE 회수.
--    PostgREST 는 RPC 하나를 한 트랜잭션으로 실행하므로, 함수가 끝나면 전부 반영되거나
--    전부 롤백된다. DEFERRABLE 제약도 이 트랜잭션 끝에서 검사된다.
-- ---------------------------------------------------------------------

-- 공통 가드
create or replace function public.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '권한이 없습니다.' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.assert_admin() from public;
grant  execute on function public.assert_admin() to authenticated;

-- [지명] 참가자를 팀에 배정하고, 그 티어를 '직접 뽑은 순번'에 등록한다.
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

  -- 아직 기록되지 않은 티어면 순번 끝에 추가(이미 있으면 그대로).
  update public.page_state
    set draft_order = case
          when coalesce(draft_order, '{}') @> array[v_tier] then draft_order
          else coalesce(draft_order, '{}') || v_tier
        end,
        updated_at = now()
    where id = 1;
end;
$$;
revoke execute on function public.snake_assign_pick(text, text) from public;
grant  execute on function public.snake_assign_pick(text, text) to authenticated;

-- [지명 취소] 배정만 해제한다. ★ draft_order 는 건드리지 않는다 —
-- 과거에 그 티어를 직접 뽑았다는 사실은 유지되어야 진행 중 티어의 방향이 안 뒤집힌다.
create or replace function public.snake_cancel_pick(p_target text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_admin();
  update public.participants
    set team_name = null, assigned_randomly = false
    where p_token = p_target;
  if not found then
    raise exception '대상 참가자를 찾을 수 없습니다.';
  end if;
end;
$$;
revoke execute on function public.snake_cancel_pick(text) from public;
grant  execute on function public.snake_cancel_pick(text) to authenticated;

-- [티어 초기화] 그 티어 비팀장 전원 미배정 + 순번에서 제거.
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
    set draft_order = array_remove(draft_order, p_tier), updated_at = now()
    where id = 1;
end;
$$;
revoke execute on function public.snake_reset_tier(text) from public;
grant  execute on function public.snake_reset_tier(text) to authenticated;

-- [티어 랜덤 배치] 그 티어 16명을 통째로 1~16팀에 무작위 재배치.
-- 직접 뽑은 티어가 아니게 되므로 순번에서 제거한다.
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
    set draft_order = array_remove(draft_order, p_tier), updated_at = now()
    where id = 1;
end;
$$;
revoke execute on function public.snake_fill_tier_randomly(text) from public;
grant  execute on function public.snake_fill_tier_randomly(text) to authenticated;

-- [뽑기 순서 리롤] 팀 번호를 통째로 재배열한다. 팀장과 이미 뽑힌 팀원이 한 덩어리로 이동하므로
-- 기존 구성이 그대로 유지된다. 순열이라 DEFERRABLE 제약이 필수인 지점.
create or replace function public.snake_reroll_teams()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_leaders int;
begin
  perform public.assert_admin();

  select count(*) into v_leaders from public.participants where is_leader;
  if v_leaders <> 16 then
    raise exception '팀장이 %명입니다. 먼저 팀장 추첨을 해 주세요.', v_leaders;
  end if;

  update public.participants p
    set team_name = m.new_team
    from (
      select n::text || '팀' as old_team,
             (row_number() over (order by random()))::text || '팀' as new_team
      from generate_series(1, 16) n
    ) m
    where p.team_name = m.old_team;
end;
$$;
revoke execute on function public.snake_reroll_teams() from public;
grant  execute on function public.snake_reroll_teams() to authenticated;

-- [익명 재배정] 티어 안에서 슬롯을 섞고 새 익명 이름을 붙인다.
-- 이름 풀은 클라이언트(anonNames.ts)가 만들어 넘긴다 — 테마를 SQL에 중복 정의하지 않기 위해서다.
-- p_names 는 64개(SLOT_COUNT). slot_index 순열이라 여기서도 DEFERRABLE 이 필수다.
create or replace function public.snake_reassign_anonymous(p_names text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_admin();

  if array_length(p_names, 1) is distinct from 64 then
    raise exception '익명 이름이 %개입니다. 64개가 필요합니다.', coalesce(array_length(p_names, 1), 0);
  end if;

  update public.participants p
    set slot_index = t.new_slot,
        fake_name  = p_names[t.new_slot + 1]
    from (
      select p_token,
             ((tier::int - 1) * 16 + (row_number() over (partition by tier order by random()) - 1))::int as new_slot
      from public.participants
    ) t
    where p.p_token = t.p_token;
end;
$$;
revoke execute on function public.snake_reassign_anonymous(text[]) from public;
grant  execute on function public.snake_reassign_anonymous(text[]) to authenticated;

-- [팀장 추첨] 한 번의 트랜잭션으로: 검증 → 초기화 → 토큰 회전 → 익명 재배정 → 팀장 배정.
-- ★ 검증을 가장 먼저 한다. 예전에는 토큰 회전이 검증보다 앞서서, 인원 부족으로 튕겨도
--   토큰은 이미 갈려 있었다(진행자 실명 맵이 깨지는 원인).
-- p_leader_tier 가 null 이면 1~4 중 무작위.
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

  -- 검증: 티어가 정확히 4종이고 각 16명
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

  -- 초기화
  update public.participants
    set team_name = null, is_leader = false, reveal_name = null, assigned_randomly = false
    where p_token is not null;
  update public.page_state
    set draft_order = null, active_tier = null, reveal_until = null, updated_at = now()
    where id = 1;

  -- 토큰 회전 (과거 F12 캡처 무효화). FK on update cascade 로 secrets 도 따라온다.
  update public.participants
    set p_token = 'p_' || replace(gen_random_uuid()::text, '-', '')
    where p_token is not null;

  -- 익명 재배정
  perform public.snake_reassign_anonymous(p_names);

  -- 팀장 배정: 지정 티어를 무작위 순서로 1~16팀에. 공개명은 진행자 전용 secrets 의 실명.
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

-- [팀장 해제] 전원 미배정 + 토큰 회전 + 익명 재배정. 한 트랜잭션.
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
    set draft_order = null, active_tier = null, reveal_until = null, updated_at = now()
    where id = 1;

  update public.participants
    set p_token = 'p_' || replace(gen_random_uuid()::text, '-', '')
    where p_token is not null;

  perform public.snake_reassign_anonymous(p_names);
end;
$$;
revoke execute on function public.snake_release_leaders(text[]) from public;
grant  execute on function public.snake_release_leaders(text[]) to authenticated;

-- [전체 실명 공개] 서버 시계로 만료시각을 정한다.
-- 예전에는 클라이언트가 new Date(Date.now()+60초)를 보내서, 진행자 PC 시계가 빠르면
-- 60초가 아니라 그 오차만큼 더 오래 공개됐다(게이팅은 서버 now() 와 비교하므로).
create or replace function public.set_reveal_window(p_seconds int)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare v_until timestamptz;
begin
  perform public.assert_admin();

  if p_seconds is null or p_seconds <= 0 then
    v_until := null;                       -- 즉시 비공개
  elsif p_seconds > 600 then
    raise exception '공개 시간이 너무 깁니다(최대 600초).';
  else
    v_until := now() + make_interval(secs => p_seconds);
  end if;

  update public.page_state set reveal_until = v_until, updated_at = now() where id = 1;
  return v_until;
end;
$$;
revoke execute on function public.set_reveal_window(int) from public;
grant  execute on function public.set_reveal_window(int) to authenticated;

-- ---------------------------------------------------------------------
-- 4) 기존 SECURITY DEFINER 함수들의 PUBLIC EXECUTE 회수 (일관성)
--    0005 에서 rotate_participant_tokens 만 했던 것을 나머지에도 적용한다.
--    result_names / roster_names 는 anon 에게 의도적으로 공개하므로 grant 는 유지한다.
-- ---------------------------------------------------------------------
revoke execute on function public.result_names() from public;
grant  execute on function public.result_names() to anon, authenticated;
revoke execute on function public.roster_names() from public;
grant  execute on function public.roster_names() to anon, authenticated;
