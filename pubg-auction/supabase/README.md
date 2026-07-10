# Supabase 보안 설정

이 폴더의 `migrations/`는 DB 스키마·RLS·RPC를 코드로 관리하기 위한 SQL입니다.
지금은 Supabase CLI 없이 **SQL Editor에 직접 붙여 실행**하는 방식으로 씁니다.

## 보안 모델 (A안: 클라이언트 직결 + RLS/RPC 잠금)

| 역할 | 인증 | 권한 |
|------|------|------|
| 참가자/관전자 | 없음 (anon) | **읽기 전용**. 입찰 불가 |
| 팀장 | 팀장 PIN | `place_bid` RPC로만 입찰 (자기 팀만) |
| 진행자 | Supabase Auth 로그인 | 모든 직접 쓰기 (`is_admin`) |

anon 키는 공개돼도 안전합니다 — 쓰기가 전부 RLS/RPC 뒤에 잠겨 있기 때문입니다.

## 적용 절차 (0001_security_lockdown.sql)

1. **진행자 계정 생성** — 대시보드 > Authentication > Users > *Add user*
   - 이메일: `admin@gungang.local` (SQL의 `ADMIN_EMAIL`과 반드시 동일. 바꾸려면 양쪽 다 수정)
   - 비밀번호: 진행자들끼리만 공유할 값
2. **가입 차단** — Authentication > Providers > Email > *Allow new users to sign up* **끄기**
   (진행자 외 아무도 authenticated가 될 수 없게)
3. **마이그레이션 실행** — SQL Editor에 `migrations/0001_security_lockdown.sql` 전체 붙여넣고 Run
4. 클라이언트의 `ADMIN_EMAIL` 상수(`app/page.tsx`)가 1번 이메일과 같은지 확인

## 실명 블라인드 (0002_hide_real_names.sql)

0001 실행 후 이어서 `migrations/0002_hide_real_names.sql`도 실행하세요.

- `participants.real_name` 제거 → **anon/Realtime로 실명이 더 이상 안 나감** (F12 방어)
- 실명은 `participant_secrets`(진행자만)로 이동. 기존 데이터는 자동 이관됨
- 공개 표시는 `participants.reveal_name` — **팀장만** 채워짐(그 외 블라인드)
- 결과 화면은 `result_names()` RPC로 `page_state='result'`일 때만 실명 공개

> **주의(시드 데이터)**: 0002 이후에는 참가자를 추가할 때 `participants`에
> `real_name`을 넣으면 안 됩니다. `participants`(real_name 제외) + `participant_secrets`
> 두 곳에 나눠 INSERT 하세요. (앱의 참가자 등록은 이미 이렇게 동작함)

## 팀장 PIN 운영

- 진행자가 **추첨**을 하면 16팀 PIN이 자동 발급되어 `leader_pins`에 저장됩니다.
- 추첨 화면(진행자)에서 각 팀의 PIN이 보입니다 → 해당 팀장에게 개별 전달.
- 팀장은 경매 화면에서 PIN 입력 → 자기 팀으로만 입찰.
- **팀장 해제**를 하면 PIN도 함께 폐기됩니다.

## 알려진 잔여 항목 (다음 단계 후보)

- PIN 무차별 대입 방지용 레이트리밋 (현재 6자리, 단기 대회엔 충분).
- `intro`(소갯말)는 여전히 anon에게 공개됨 — 블라인드 바이오로 의도된 것이지만,
  식별 정보가 담기면 노출될 수 있으니 운영 시 주의.
