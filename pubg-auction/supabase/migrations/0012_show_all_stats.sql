-- =====================================================================
-- 0012_show_all_stats.sql
-- 팀장(및 결과공개 중)의 딜량·소갯말을 다시 보이게 한다 — 0008/0010 의 은닉 철회.
--
-- ★ 배경(운영 결정)
--   0008/0010 은 '실명 ↔ 딜량' 지문으로 다음 판의 익명 카드를 역추적하는 것을 막으려고
--   팀장·결과공개 시 딜량/소갯말을 가렸다. 그러나 이 공격은 같은 사람들이 여러 대회를 하고
--   누군가 판을 넘나들며 데이터를 모을 때만 성립한다(한 대회 안에서는 안전 — 팀장은 뽑는 티어와
--   다른 티어이므로 현재 드래프트 카드가 뚫리지 않는다). 캐주얼 대회에는 과한 방어라, 팀장 스탯을
--   못 보는 불편을 없애기로 했다. 크로스라운드 지문 위험은 감수한다.
--
-- ★ 조치: participants_public 뷰를 '있는 그대로'(모든 컬럼 실제값) 통과시킨다.
--   여전히 anon 읽기 표면은 이 뷰다(0008 이 base participants 의 anon SELECT 를 회수했고 그대로 둔다).
--   participants 를 realtime publication 에서 뺀 것(구→신 토큰 누수 차단)도 그대로 유지된다.
--
--   ★ 쓰기 잠금 유지: 이 뷰는 단순 통과라 auto-updatable 이 되지만, anon/authenticated 에
--     쓰기 권한(INSERT/UPDATE/DELETE)이 없으면 PostgREST 가 거부한다. 0009 의 revoke 를 다시 건다.
--     (판 변경은 전부 원자적 RPC, 참가자 CRUD 는 진행자가 base 테이블에 직접 쓴다.)
--
-- 선행: 0001 ~ 0011 실행 완료. (재실행 안전)
-- =====================================================================

create or replace view public.participants_public as
select
  p_token,
  tier,
  fake_name,
  reveal_name,
  team_name,
  is_leader,
  slot_index,
  assigned_randomly,
  avg_damage,
  intro
from public.participants;

revoke all on public.participants_public from public;
revoke all on public.participants_public from anon;
revoke all on public.participants_public from authenticated;
grant select on public.participants_public to anon, authenticated;

-- ---------------------------------------------------------------------
-- 검증
--   set role anon;
--   select count(avg_damage) from participants_public where is_leader;  -- 16 (다시 보임)
--   reset role;
--   -- anon 쓰기 차단 확인:
--   PATCH /rest/v1/participants_public?p_token=eq.<토큰> {"team_name":"1팀"} (anon 키) → 거부
-- ---------------------------------------------------------------------
