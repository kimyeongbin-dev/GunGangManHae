# Supabase 설정

이 폴더의 `migrations/*.sql` 은 **번호 순서대로** SQL Editor 에 붙여 실행한다.
(Supabase CLI 없이 직접 실행하는 방식)

## 권한 모델

| 역할 | 인증 방법 | 할 수 있는 일 |
|---|---|---|
| 참가자·관전자 (anon) | 없음 (공개 anon key) | 읽기만. `participants_public` 뷰 · `page_state` 조회, `roster_names()` / `result_names()` 호출 |
| 진행자 (admin) | Supabase Auth 이메일 + 비번 | 모든 쓰기. 실명(`participant_secrets`) 조회 |

- anon 에게는 **어떤 테이블에도 INSERT/UPDATE/DELETE 정책이 없다.** 쓰기는 전부 진행자 세션에서만 통과한다.
- 판을 바꾸는 조작(추첨·지명·리롤·랜덤배치 등)은 모두 **`SECURITY DEFINER` RPC** 로만 실행된다.
  각 RPC 는 첫 줄에서 `is_admin()` 을 재검사하고, `PUBLIC` EXECUTE 는 회수돼 있다.
- 앱에는 **서버 코드가 없다**(Server Action / API Route 없음). 따라서 보안 경계 전체가 여기 RLS/RPC 에 있다.

## 최초 설치 순서

1. Supabase 대시보드 → Authentication → Users → **Add user** 로 진행자 계정 1개 생성.
   이메일은 `0001_security_lockdown.sql` 의 `is_admin()` 및 `app/page.tsx` 의 `ADMIN_EMAIL` 과 **정확히 일치**해야 한다.
2. Authentication → Providers → Email 에서 **"Allow new users to sign up" 끄기**.
3. `migrations/` 의 SQL 을 **0001 → 0010 순서대로 빠짐없이** 실행.
   ⚠️ 특히 `0009_view_readonly.sql` 를 건너뛰면 anon 이 `participants_public` 뷰로 지명을
   조작할 수 있는 상태로 배포된다(2차 감사에서 실측된 구멍).

> ⚠️ `participants` · `page_state` · `auction_*` 테이블의 `create table` 문은 이 저장소에 없다.
> 대시보드에서 수동 생성됐기 때문이다. **DB 를 처음부터 재구축하려면 먼저
> `pg_dump --schema-only` 로 `0000_schema.sql` 을 뽑아 두어야 한다.** (점검 보고서 5번 항목)

## 마이그레이션 요약

| 파일 | 내용 |
|---|---|
| `0001_security_lockdown.sql` | RLS 전면 재구성(anon 읽기 전용 / 진행자 쓰기), `is_admin()`, 경매용 `place_bid`·`verify_leader_pin` |
| `0002_hide_real_names.sql` | 실명을 `participant_secrets` 로 분리, `participants.real_name` 제거 ⚠️ **재실행 불가** |
| `0003_public_reveal_toggle.sql` | 결과 공개를 `page_state.reveal_until`(시각 기반)로 전환, `current_page` 폐기 |
| `0004_snake_only.sql` | 스네이크 전용 전환. `roster_names()`(티어별 실명 명단) 추가 |
| `0005_rotate_tokens.sql` | `p_token` 회전 RPC, FK `on update cascade`, `active_tier` 추가 |
| `0006_pick_method.sql` | `assigned_randomly` — 랜덤 배치한 티어를 지그재그 순번에서 제외 |
| `0007_integrity_and_atomic_ops.sql` | 무결성 제약(팀당 티어별 1명·슬롯 유일 등) + 파괴적 연산을 원자적 RPC 로 이관 + `draft_order` |
| `0008_blind_hardening.sql` | Realtime 누수 차단(publication 제거 + 신호 트리거) + 팀장 딜량·소갯말 가리는 공개 뷰(→ 0012에서 철회) |
| `0009_view_readonly.sql` | ⚠️ 0008 뷰의 쓰기 권한 회수(anon 이 뷰로 지명을 조작할 수 있던 구멍 봉인) |
| `0010_audit2_fixes.sql` | 티어 초기화/랜덤배치 시 지그재그 방향 소급 뒤집힘 1차 수정(draft_order tombstone) + 결과공개창 비팀장 딜량·소갯말 은닉 |
| `0011_tier_direction.sql` | 방향 뒤집힘 근본 수정 — `draft_order` 배열 → `tier_direction`(jsonb 맵)으로 티어별 방향 명시 저장 |
| `0012_show_all_stats.sql` | 팀장·결과공개 딜량·소갯말 은닉 철회 — `participants_public` 뷰를 통과(passthrough)로(쓰기 잠금은 유지) |

## 경매 시절 잔재 (의도적 보존)

`auction_bids` · `auction_logs` · `auction_meta` · `leader_pins` 테이블과
`place_bid` · `verify_leader_pin` RPC 는 **현재 앱이 전혀 쓰지 않는다.**
git 태그 `v1-auction`(경매 방식 버전)이 그대로 실행되려면 스키마가 필요해서 남겨 둔 것이다.
현재 운영 절차와는 무관하다.

> 태그 버전을 실제로 되살릴 경우, `verify_leader_pin` 에 레이트리밋이 없어
> 6자리 PIN 을 전수 탐색당할 수 있다. 복귀 시 함께 보완해야 한다.

## 블라인드 모델 (이 앱의 핵심 제약)

실명이 클라이언트로 나가는 통로는 셋뿐이고 전부 서버가 게이팅한다.

| 통로 | 조건 |
|---|---|
| `participant_secrets` 직접 조회 | 진행자만 (RLS) |
| `result_names()` | `page_state.reveal_until > now()` 인 동안만 (서버 시각 기준) |
| `roster_names()` | 전원. 단 **`p_token` 을 반환하지 않아** 익명 카드와 대조 불가 |

추가 방어 (0005 · 0008):

- **토큰 회전** — 익명을 다시 뿌릴 때마다 `p_token` 을 새로 발급해 과거 캡처를 무효화한다.
- **Realtime 미노출** — `participants` 는 publication 에서 빠져 있다. PK 를 바꾸는 UPDATE 는
  페이로드의 `old` 에 구 토큰을 실어 '구→신' 연결을 노출하므로, 행 데이터를 실시간으로 흘리지 않는다.
  대신 `page_state` 변경을 신호로 삼아 클라이언트가 REST 로 다시 읽는다.

### 감수한 위험 — 딜량·소갯말 지문 (0012)

실명이 공개되는 대상(팀장)과 같은 행에 딜량이 보이면 '실명 ↔ 딜량' 쌍이 생기고, 딜량은 토큰
회전 대상이 아닌 고정값이라 **여러 대회에 걸쳐 수집하면** 다음 판의 익명 카드를 역추적할 수 있다.
0008/0010 은 이를 막으려 팀장·결과공개 시 딜량·소갯말을 가렸으나, 한 대회 안에서는 안전하고
(팀장은 뽑는 티어와 다른 티어) 팀장 스탯을 못 보는 불편이 커서 **0012 에서 은닉을 철회**했다.
`participants_public` 뷰는 이제 전원의 딜량·소갯말을 그대로 보여준다. 크로스라운드 지문 위험은
운영상 감수한 것이다(단일 대회 위주면 무해).

### 운영 시 주의

`intro`(소갯말)는 전원에게 공개된다. 참가자가 소갯말에 자신을 특정할 수 있는 내용을 쓰면
블라인드가 약해지므로, 등록 단계에서 안내가 필요하다.

## 확인용 쿼리

```sql
-- 정책이 의도대로 깔렸는지
select tablename, policyname, cmd, roles from pg_policies
where schemaname = 'public' order by tablename, cmd;

-- participants 가 실시간으로 새지 않는지 (목록에 없어야 정상)
select tablename from pg_publication_tables where pubname = 'supabase_realtime';

-- 익명이 뷰로 쓰기 못 하는지 (anon/authenticated 는 SELECT 만 있어야 정상)
select grantee, privilege_type from information_schema.role_table_grants
where table_name = 'participants_public' order by grantee, privilege_type;
```
