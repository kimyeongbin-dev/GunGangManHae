-- =====================================================================
-- 0004_snake_only.sql
-- 경매 방식을 걷어내고 스네이크 드래프트 전용으로 전환하면서 필요해진 것 두 가지.
--   1) page_state.snake_plan : 스네이크 진행 계획(팀 순서·티어 순서)을 전원이 같이 보도록 공유.
--   2) roster_names()        : 참가자 목록 화면에 티어별 실명 명단을 전원에게 공개.
-- 선행: 0001 ~ 0003 실행 완료.
--
-- ★ 경매 테이블(auction_bids/auction_logs/auction_meta/leader_pins)과 place_bid 등의 RPC는
--   일부러 남겨 둔다. 경매 버전(git 태그 v1-auction)이 그대로 실행되려면 스키마가 필요하기 때문.
--   현재 앱 코드는 이 테이블들을 더 이상 읽지도 쓰지도 않는다.
-- =====================================================================

-- 1) 스네이크 진행 계획. { "teams": [팀 번호 순서 16개], "tiers": [진행할 티어 순서 3개] }
--    · teams : 진행자가 '뽑기 순서 리롤'을 누르면 1~16을 섞어 저장. null이면 기본(1팀 → 16팀).
--    · tiers : 어느 티어부터 뽑을지 진행자가 고른 순서. null이면 기본(팀장 티어를 뺀 오름차순).
--    전원이 realtime으로 같은 계획을 본다. 쓰기 권한은 0001의 page_state 진행자 update 정책이
--    그대로 게이팅한다(anon은 읽기만).
alter table public.page_state add column if not exists snake_plan jsonb;

-- 2) 참가자 명단 공개 RPC (전원 실행 가능).
--    ★ 블라인드 유지의 핵심: p_token을 반환하지 않는다.
--      실명과 내부 식별자를 함께 주면 스네이크 화면의 익명 카드가 누구인지 역추적되므로,
--      여기서는 (티어, 실명)만 내려보내고 정렬도 이름순으로 고정해 슬롯 순서 단서를 남기지 않는다.
--      딜량·소갯말도 같은 이유로 제외한다(값으로 익명 카드와 대조 가능).
create or replace function public.roster_names()
returns table(tier text, real_name text)
language sql
stable
security definer
set search_path = public
as $$
  select p.tier, s.real_name
  from public.participants p
  join public.participant_secrets s on s.p_token = p.p_token
  order by p.tier, s.real_name;
$$;
grant execute on function public.roster_names() to anon, authenticated;
