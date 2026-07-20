-- =====================================================================
-- 0010_audit2_fixes.sql
-- 2차 감사에서 나온 두 결함 조치.
--
--   (1) 지그재그 방향이 티어 초기화/랜덤배치로 소급해 뒤집히는 문제 (치명)
--       draft_order 에서 array_remove 로 원소를 빼면 뒤 티어들의 인덱스가 당겨져
--       round % 2 패리티가 반전된다 → 진행 중이던 티어의 뽑기 방향이 갑자기 뒤집힌다.
--       (1차 조치가 지명 취소만 막고 이 두 경로를 놓쳤다.)
--       실측: 2티어 완료(draft_order=['2']) → 3티어 역순 진행 중(16팀부터) → 2티어 초기화
--             → draft_order=[] → 3티어가 정순(1팀)으로 점프.
--       ★ 해결: 제거하지 말고 '빈 문자열' tombstone 으로 바꾼다. 인덱스가 유지돼 방향이 고정된다.
--         빈 문자열은 어떤 실제 티어와도 안 맞아 방향 계산에서 자리만 차지한다.
--
--   (2) 결과 전체공개창에서 (실명 ↔ 딜량/소갯말) 교차대회 지문 (높음)
--       공개 60초 동안 result_names() 는 전원의 (p_token, 실명)을, participants_public 은
--       비팀장 48명의 (p_token, 딜량, 소갯말)을 동시에 준다 → p_token 으로 조인하면
--       (실명, 딜량) 48쌍이 수집되고, 딜량은 회전 대상이 아니라 다음 대회 익명 카드를 역추적한다.
--       ★ 해결: 공개 중(reveal_until > now())에는 뷰가 비팀장 딜량·소갯말도 가린다.
--         결과 공개는 드래프트가 끝난 뒤라 그 순간 딜량이 필요 없다(기능 손실 없음).
--         공개가 꺼지면(다음 판 준비) 다시 보인다.
--
-- 선행: 0001 ~ 0009 실행 완료. (재실행 안전)
-- =====================================================================

-- ---------------------------------------------------------------------
-- (1) draft_order tombstone — array_remove → array_replace(…, '')
-- ---------------------------------------------------------------------

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
  -- 제거하지 않고 tombstone 처리 → 다른 티어의 순번(=방향)이 안 밀린다.
  update public.page_state
    set draft_order = array_replace(coalesce(draft_order, '{}'), p_tier, ''), updated_at = now()
    where id = 1;
end;
$$;

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

  -- 랜덤 배치 티어는 직접 뽑은 게 아니므로 순번에서 빼되, tombstone 으로 방향은 보존.
  update public.page_state
    set draft_order = array_replace(coalesce(draft_order, '{}'), p_tier, ''), updated_at = now()
    where id = 1;
end;
$$;

-- ---------------------------------------------------------------------
-- (2) 결과 공개 중에는 비팀장 딜량·소갯말도 가린다
--     create or replace view 는 컬럼 목록이 같으면 권한을 유지하지만,
--     안전하게 0009 의 권한 설정을 다시 적용한다.
--
--     ★ 부수효과(의도적): 아래 뷰는 cross join 이 있어 Postgres 가 '자동 업데이트 가능'으로
--       보지 않는다 → anon 뿐 아니라 누구의 INSERT/UPDATE/DELETE 도 SQL 구조 차원에서 거부된다
--       (55000). 0009 의 권한 회수와 합쳐 이중 방어. 정상 클라이언트는 이 뷰를 SELECT 만 하므로
--       기능 영향이 없다. 판을 바꾸는 쓰기는 전부 원자적 RPC(0007) 경유다.
-- ---------------------------------------------------------------------
create or replace view public.participants_public as
select
  p.p_token,
  p.tier,
  p.fake_name,
  p.reveal_name,
  p.team_name,
  p.is_leader,
  p.slot_index,
  p.assigned_randomly,
  -- 팀장이거나(항상) 결과 전체공개 중이면(그 순간엔 딜량 불필요) 가린다.
  case when p.is_leader or ps.revealing then null else p.avg_damage end as avg_damage,
  case when p.is_leader or ps.revealing then null else p.intro       end as intro
from public.participants p
cross join (
  select coalesce((select reveal_until from public.page_state where id = 1), 'epoch'::timestamptz) > now() as revealing
) ps;

revoke all on public.participants_public from public;
revoke all on public.participants_public from anon;
revoke all on public.participants_public from authenticated;
grant select on public.participants_public to anon, authenticated;

-- ---------------------------------------------------------------------
-- 검증
--   -- 방향 보존: 2티어 채우고 3티어 3명 지명 후 2티어 초기화 → 3티어 다음 차례가 안 바뀌어야 함.
--   -- 지문 차단: set_reveal_window(60) 후
--   set role anon; select count(avg_damage) from participants_public; reset role;  -- 0 이어야 함
--   -- 공개 종료 후엔 비팀장 딜량이 다시 보여야 함(48).
-- ---------------------------------------------------------------------
