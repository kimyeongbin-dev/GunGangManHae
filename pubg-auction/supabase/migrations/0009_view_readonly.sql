-- =====================================================================
-- 0009_view_readonly.sql
-- 0008 이 만든 구멍 차단 — participants_public 뷰가 쓰기 가능한 상태였다.
--
-- ★ 무엇이 뚫렸나 (2차 감사 실측)
--   익명 키만으로 아래가 성공했다:
--       PATCH /rest/v1/participants_public?p_token=eq.<아무거나>  {"team_name":"1팀"}
--       → HTTP 200, 실제로 지명이 조작됨
--
--   원인 두 가지가 겹쳤다:
--     1) Supabase 는 public 스키마의 새 객체에 anon·authenticated 로 ALL 권한을
--        자동 부여한다(ALTER DEFAULT PRIVILEGES). 0008 의 `grant select` 는
--        '추가'일 뿐이라 이미 딸려 온 INSERT/UPDATE/DELETE 를 회수하지 못했다.
--     2) 이 뷰는 security_invoker 를 켜지 않아 **소유자(postgres) 권한으로 실행**된다.
--        그래서 기반 테이블의 RLS 가 아예 적용되지 않는다 — anon 쓰기를 막던 유일한
--        방어선이 뷰 뒤에서 무력화됐다.
--     (단순 뷰는 Postgres 가 자동으로 갱신 가능(auto-updatable)하게 만들기 때문에
--      CASE 식이 있는 avg_damage·intro 를 빼고 나머지 컬럼은 그대로 쓰기가 통했다.)
--
-- ★ 조치: 뷰에서 쓰기 권한을 전부 회수하고 SELECT 만 남긴다.
--   진행자는 뷰로 쓰지 않는다 — 판 변경은 0007 의 원자적 RPC, 참가자 CRUD 는 기반 테이블을
--   직접 쓴다(진행자만 RLS 통과). 따라서 authenticated 에서도 회수해도 기능 영향이 없다.
--
-- 선행: 0001 ~ 0008 실행 완료. (재실행 안전)
-- =====================================================================

revoke all on public.participants_public from public;
revoke all on public.participants_public from anon;
revoke all on public.participants_public from authenticated;

grant select on public.participants_public to anon, authenticated;

-- ---------------------------------------------------------------------
-- 검증 (SQL Editor 에서 실행)
--   select grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_name = 'participants_public'
--   order by grantee, privilege_type;
--     → anon / authenticated 는 SELECT 만 있어야 한다.
--
-- REST 로도 확인:
--   PATCH /rest/v1/participants_public?p_token=eq.<토큰>  {"team_name":"1팀"}  (anon 키)
--     → 401/403 이어야 하고, 절대 200 이면 안 된다.
-- ---------------------------------------------------------------------
