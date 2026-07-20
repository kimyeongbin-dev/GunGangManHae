// components/common/data.ts
// ---------------------------------------------------------------------------
// "데이터 접근 계층" — Supabase에 직접 쓰기/읽기 하는 공용 헬퍼를 한곳에 모은다.
//
// ★ 기밀성(confidentiality) 모델 — 실명이 어디서 어떻게 나오는지 한눈에:
//   · 실명(비제이명)은 오직 participant_secrets 테이블에만 있다.
//   · fetchSecretNames() : 진행자(Supabase Auth)만 RLS로 읽힘 → 진행자 화면 실명 표시용.
//   · fetchResultNames() : result_names() RPC. page_state.reveal_until > now()(전체 공개 중)일 때만 anon에게 실명 반환.
//   · fetchRosterNames() : roster_names() RPC. 전원에게 (티어, 실명)만 반환 — p_token이 없어 익명 카드와 매칭 불가.
//   · participants 테이블에는 real_name 컬럼이 없다(공개 컬럼 reveal_name은 팀장만 채워짐).
//   → 따라서 이 파일이 "실명이 클라이언트로 흘러나가는 유일한 통로"이며, 그 통로는 전부 서버(RLS/RPC)가 게이팅한다.
//
// ★ 판을 바꾸는 쓰기는 여기 없다 — 전부 원자적 RPC(snakeActions.ts)로 옮겼다.
//   여러 행을 나눠 PATCH 하던 방식은 중간 실패 시 절반만 반영돼 슬롯이 겹치는 사고를 냈다.
// ---------------------------------------------------------------------------
import { supabase } from '@/lib/supabaseClient';
import { rowsToMap } from './utils';

// ── 실명 조회 (전부 서버가 권한을 게이팅) ──────────────────────────────────

// 진행자 전용 실명 맵 { p_token: "실명" }. participant_secrets 는 진행자만 RLS로 읽힘.
// 사용처: useAdminNames(진행자 실명 모드에서 화면 표시).
export async function fetchSecretNames(): Promise<Record<string, string>> {
    const { data } = await supabase.from('participant_secrets').select('p_token, real_name');
    return rowsToMap(data as { p_token: string; real_name: string }[] | null, (r) => r.p_token, (r) => r.real_name);
}

// 결과 공개 실명 맵 { p_token: "실명" }. result_names() RPC 는 page_state.reveal_until > now()(전체 공개 중)일 때만 실명 반환.
// 사용처: ResultScreen(진행자가 '전체 실명 공개'를 눌러 공개 중일 때만).
export async function fetchResultNames(): Promise<Record<string, string>> {
    const { data } = await supabase.rpc('result_names');
    return rowsToMap(data as { p_token: string; real_name: string }[] | null, (r) => r.p_token, (r) => r.real_name);
}

// 참가자 명단 [{ tier, real_name }]. roster_names() RPC 는 전원이 실행할 수 있다.
// ★ 일부러 p_token을 받지 않는다 — 실명과 식별자를 함께 쥐면 스네이크 화면의 익명 카드가 역추적돼
//   블라인드가 깨진다. 딜량·소갯말도 같은 이유로 서버가 내려주지 않는다.
// 사용처: ParticipantsScreen(티어별 명단).
export async function fetchRosterNames(): Promise<{ tier: string; real_name: string }[]> {
    const { data } = await supabase.rpc('roster_names');
    return (data ?? []) as { tier: string; real_name: string }[];
}

// ── 전체 실명 공개 창 ──────────────────────────────────────────────────────

// [진행자] 공개 만료시각을 서버 시계로 설정한다. seconds<=0 이면 즉시 비공개.
// ★ 클라이언트가 만료시각을 계산해 보내면 안 된다 — 게이팅은 서버 now() 와 비교하므로,
//   진행자 PC 시계가 빠르면 그 오차만큼 실명이 더 오래 공개된다. 그래서 서버가 직접 계산한다.
// 반환: 설정된 만료시각(비공개면 null). 실패하면 예외 대신 undefined 를 돌려준다.
export async function setRevealWindow(seconds: number): Promise<string | null | undefined> {
    const { data, error } = await supabase.rpc('set_reveal_window', { p_seconds: seconds });
    if (error) return undefined;
    return (data as string | null) ?? null;
}
