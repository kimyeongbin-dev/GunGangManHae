-- =====================================================================
-- 0003_public_reveal_toggle.sql
-- 결과 실명 공개를 'page_state.current_page = result 강제 이동' 방식에서
-- 'page_state.reveal_until 타임스탬프(공개 만료시각)' 방식으로 전환.
--   · 공개 = now() < reveal_until  (진행자가 결과 페이지 버튼으로 60초 공개; 만료·모드해제 시 자동 비공개)
--   · 화면 강제 이동(current_page)은 폐기 → 모두가 자유 이동, 결과도 일반 페이지.
-- 선행: 0001_security_lockdown.sql, 0002_hide_real_names.sql 실행 완료.
-- =====================================================================

-- 1) page_state 스키마 전환: 공개 만료시각 컬럼 추가 + 더 이상 안 쓰는 current_page 제거.
alter table public.page_state add column if not exists reveal_until timestamptz;
alter table public.page_state drop column if exists current_page;

-- 2) 결과 공개 RPC: reveal_until이 아직 안 지났을 때(now() 이전이면 비공개)만 전체 실명 반환.
--    (page_state는 anon도 read 가능 = 클라가 공개 여부를 실시간 구독. 쓰기는 진행자만 = 0001 admin_update 정책.)
create or replace function public.result_names()
returns table(p_token text, real_name text)
language sql
stable
security definer
set search_path = public
as $$
  select s.p_token, s.real_name
  from public.participant_secrets s
  where coalesce((select reveal_until from public.page_state where id = 1), 'epoch'::timestamptz) > now();
$$;
grant execute on function public.result_names() to anon, authenticated;
