-- =====================================================================
-- 0005_rotate_tokens.sql
-- 블라인드 구멍 차단: p_token 회전(rotation) + 진행 상태 컬럼 정리.
-- ※ 여러 번 실행해도 안전하다(전부 if exists / if not exists / create or replace / 조건부 재생성).
--   다만 맨 아래 토큰 회전은 실행할 때마다 새로 돌아간다(그게 목적이라 무해).
--
-- ★ 무엇이 문제였나
--   participants는 anon도 읽을 수 있고, 팀장은 reveal_name(실명)이 그 행에 공개된다.
--   그런데 p_token은 한 번 만들면 절대 바뀌지 않았다 → 팀장을 한 번이라도 맡은 사람은
--   "p_token ↔ 실명" 쌍이 F12로 영구 노출된다. 익명 재배정은 fake_name·slot_index만 섞을 뿐
--   p_token은 그대로라, 캡처해 둔 쌍이 다음 판에도 계속 유효했다.
--   팀장 티어를 바꿔가며 재추첨하면 티어별로 매핑이 누적돼 결국 전원이 식별된다.
--
-- ★ 해결
--   익명을 다시 뿌릴 때(익명 만들기 / 팀장 추첨 / 팀장 해제) p_token도 함께 새로 발급한다.
--   그러면 과거에 캡처한 매핑이 전부 무효가 된다.
--   p_token을 참조하는 FK들이 같이 움직이도록 on update cascade를 걸고,
--   회전은 진행자 전용 RPC 한 번의 트랜잭션으로 처리한다.
-- 선행: 0001 ~ 0004 실행 완료.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) 진행 상태 컬럼 정리
--    · snake_plan(팀 순서 + 티어 순서 배열) 폐기:
--        - 팀 순서는 늘 1팀 → 16팀 고정이고, 바꾸고 싶으면 팀 번호를 통째로 재배열한다.
--        - 지그재그 방향은 '이미 다 찬 티어 수'로 계산되므로 저장할 필요가 없다.
--    · active_tier 추가: 진행자가 보고 있는 = 지금 뽑는 티어.
--        참가자는 각자 다른 티어를 열람할 수 있어야 하므로, '지명 대기'를 전원에게 같게 보여주려면
--        진행자의 현재 티어만은 공유되어야 한다. 쓰기는 0001의 진행자 update 정책이 게이팅한다.
-- ---------------------------------------------------------------------
alter table public.page_state drop column if exists snake_plan;
alter table public.page_state add column if not exists active_tier text;

-- ---------------------------------------------------------------------
-- 2) participants(p_token)을 참조하는 FK 전부에 on update cascade 부여
--    ★ 특정 테이블만 손대면 안 된다 — participant_secrets 외에 auction_bids·leader_pins 등이
--      p_token을 참조하고 있으면, 그 테이블에 행이 남아 있는 순간 아래 4)의 UPDATE가
--      FK 위반으로 통째로 실패한다. 그래서 참조하는 제약을 전부 찾아 옮겨 단다.
--    기존 정의(pg_get_constraintdef)를 그대로 재사용하므로 on delete 동작 등은 보존된다.
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.conname, c.conrelid::regclass::text as tbl, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.confrelid = 'public.participants'::regclass and c.contype = 'f'
  loop
    -- 이미 on update cascade가 걸린 제약은 건드리지 않는다(재실행 안전).
    if position('ON UPDATE CASCADE' in upper(r.def)) = 0 then
      execute format('alter table %s drop constraint %I', r.tbl, r.conname);
      execute format('alter table %s add constraint %I %s on update cascade', r.tbl, r.conname, r.def);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3) 토큰 회전 RPC (진행자 전용)
--    모든 참가자에게 새 무작위 p_token을 발급한다. FK cascade로 참조 테이블도 함께 따라온다.
--    · gen_random_uuid()는 PG13+ 내장이라 별도 확장이 필요 없다.
--    · 한 문장(update)이라 전체가 하나의 트랜잭션 → 중간에 실패하면 통째로 롤백된다.
--    · 방어 2겹:
--        (a) PUBLIC의 기본 EXECUTE를 회수해 anon은 호출 자체가 불가(아래 revoke).
--            ※ create function은 PUBLIC에 EXECUTE를 자동 부여한다. anon은 PUBLIC을 통해
--              권한을 상속받으므로 'revoke from anon'만으로는 막히지 않는다 — 반드시 from public.
--        (b) 그래도 authenticated 계정이 늘어날 경우를 대비해 함수 안에서 is_admin()을 재검사.
-- ---------------------------------------------------------------------
create or replace function public.rotate_participant_tokens()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '권한이 없습니다.';
  end if;

  -- ★ where 절이 반드시 있어야 한다.
  --   Supabase는 API 역할(anon/authenticated) 세션에 safeupdate 가드를 걸어 두어서
  --   WHERE 없는 UPDATE/DELETE를 '21000: UPDATE requires a WHERE clause'로 거부한다.
  --   security definer로 실행 주체가 바뀌어도 세션 설정은 그대로라 이 가드는 계속 적용된다.
  --   (클라이언트 쿼리들이 .not('p_token','is',null) 같은 '항상 참' 필터를 붙이는 것과 같은 이유)
  update public.participants
    set p_token = 'p_' || replace(gen_random_uuid()::text, '-', '')
    where p_token is not null;
end;
$$;
revoke execute on function public.rotate_participant_tokens() from public;
grant  execute on function public.rotate_participant_tokens() to authenticated;

-- ---------------------------------------------------------------------
-- 4) 지금 이미 노출돼 있는 토큰을 즉시 한 번 무효화
--    RPC는 is_admin() 검사가 있어 SQL Editor(서비스 역할, JWT 없음)에서는 통과하지 못하므로
--    여기서는 같은 UPDATE를 직접 실행한다.
-- ---------------------------------------------------------------------
update public.participants
  set p_token = 'p_' || replace(gen_random_uuid()::text, '-', '')
  where p_token is not null;
