-- =====================================================================
-- 0008_blind_hardening.sql
-- 점검 보고서(docs/audit-2026-07-20.md) 1번 조치 — 블라인드 붕괴 두 경로를 막는다.
--
-- ★ 무엇이 뚫려 있었나 (둘 다 실측으로 확인)
--   (A) Realtime 이 구→신 토큰을 직접 배달
--       participants 가 supabase_realtime publication 에 있었고, 토큰 회전은 PK 를 바꾸는
--       UPDATE 라 논리 복제가 구 키를 함께 발행한다. 익명 구독자가 받은 실제 페이로드:
--           new: {"p_token":"p_7b3f...","reveal_name":"정동원","avg_damage":335, ...}
--           old: {"p_token":"p_181f..."}
--       → 과거에 캡처한 '구 토큰 ↔ 실명' 이 새 토큰으로 그대로 이월돼 회전이 무의미했다.
--
--   (B) avg_damage / intro 가 회전되지 않는 영구 지문
--       팀장은 reveal_name(실명)과 avg_damage 가 같은 anon 읽기 가능 행에 있었다.
--       실측: 64명 중 서로 다른 딜량 54개 → 44명이 딜량만으로 유일 식별.
--       한 판에서 (실명, 딜량) 16쌍을 모으고 팀장 티어를 바꿔 재추첨하면 또 16쌍.
--       토큰을 아무리 돌려도 딜량은 그대로라 매핑이 영구히 유효했다.
--
-- ★ 어떻게 막는가
--   (A) participants 를 publication 에서 빼고, page_state 한 행을 '변경 신호'로 쓴다.
--       클라이언트는 신호를 받으면 REST 로 다시 읽는다. REST 응답에는 구/신 쌍이 없다.
--   (B) 팀장인 동안에는 딜량·소갯말을 가리는 공개 뷰로만 읽게 한다.
--       → (실명, 딜량)이 같은 행에 동시에 존재한 적이 없어 두 판을 이어 붙일 수 없다.
--       팀장은 뽑히는 대상이 아니므로 딜량이 필요 없다(기능 손실 없음).
--
-- 선행: 0001 ~ 0007 실행 완료. (재실행 안전)
-- =====================================================================

-- ---------------------------------------------------------------------
-- (A) Realtime 경로 차단
-- ---------------------------------------------------------------------

-- 1) participants 를 publication 에서 제거. 이제 행 데이터가 실시간으로 나가지 않는다.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'participants'
  ) then
    alter publication supabase_realtime drop table public.participants;
  end if;
end $$;

-- 2) 변경 신호: participants 가 바뀌면 page_state.updated_at 을 올린다.
--    ★ FOR EACH STATEMENT 다 — 행 단위로 걸면 64행 UPDATE 가 신호 64개를 만든다.
--      한 문장당 한 번만 올려서 클라이언트가 한 번만 다시 읽게 한다.
create or replace function public.bump_page_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.page_state set updated_at = now() where id = 1;
  return null;
end;
$$;

drop trigger if exists participants_bump on public.participants;
create trigger participants_bump
  after insert or update or delete on public.participants
  for each statement execute function public.bump_page_state();

-- ---------------------------------------------------------------------
-- (B) 공개 뷰 — 팀장인 동안 딜량·소갯말 가리기
-- ---------------------------------------------------------------------

-- ★ security_invoker 를 켜지 않는다(기본값 유지). 뷰가 소유자 권한으로 동작해야
--   anon 에게서 기반 테이블 SELECT 를 회수한 뒤에도 뷰는 계속 읽힌다. 뷰 자체가 관문이다.
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
  -- 팀장은 실명이 공개되는 대상이므로, 그 동안에는 지문이 될 값을 내보내지 않는다.
  case when is_leader then null else avg_damage end as avg_damage,
  case when is_leader then null else intro       end as intro
from public.participants;

grant select on public.participants_public to anon, authenticated;

-- 기반 테이블 직접 읽기는 진행자만. anon 은 이제 뷰로만 접근한다.
-- (RLS 정책과 별개로 GRANT 가 없으면 접근 자체가 불가하다)
revoke select on public.participants from anon;

-- ---------------------------------------------------------------------
-- 검증용 참고 쿼리
--   select tablename from pg_publication_tables where pubname='supabase_realtime';
--     → participants 가 없어야 한다.
--   set role anon; select avg_damage from participants_public where is_leader; reset role;
--     → 전부 null 이어야 한다.
-- ---------------------------------------------------------------------
