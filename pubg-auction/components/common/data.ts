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
// ---------------------------------------------------------------------------
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/lib/toast';
import { rowsToMap } from './utils';

// ── 식별자 회전 (블라인드 유지의 핵심) ─────────────────────────────────────

// [진행자] 전 참가자에게 새 p_token을 발급한다(rotate_participant_tokens RPC).
//
// ★ 왜 필요한가: participants는 anon도 읽을 수 있고 팀장은 그 행에 실명(reveal_name)이 공개된다.
//   p_token이 고정이면 "한 번 팀장이었던 사람"의 p_token↔실명 쌍이 F12로 영구히 남아, 다음 판에서
//   익명 카드가 누구인지 역추적된다(팀장 티어를 바꿔 재추첨할수록 매핑이 누적된다).
//   그래서 익명을 다시 뿌리는 모든 지점에서 토큰도 함께 갈아, 과거 캡처를 무효화한다.
//
// ※ 호출 순서 주의: 토큰이 바뀌면 이미 조회해 둔 participants의 p_token은 전부 낡은 값이 된다.
//   반드시 "회전 → 재조회 → 나머지 작업" 순서로 쓸 것.
export async function rotateParticipantTokens(): Promise<boolean> {
    const { error } = await supabase.rpc('rotate_participant_tokens');
    if (error) {
        toast.error('참가자 식별자 재발급 실패: ' + error.message);
        return false;
    }
    return true;
}

// ── 편성 초기화 ────────────────────────────────────────────────────────────

// 팀 편성 데이터를 초기화한다. 팀장 추첨/해제가 공유.
//  - keepLeaders=false : 전원 팀장직/팀배정/공개명 해제 (추첨/해제 → 완전 재설정)
//  - keepLeaders=true  : 팀장은 유지, 스네이크로 채운 팀원만 해제
// 첫 오류를 반환(없으면 null)해 호출부가 사용자 안내를 결정한다.
// ※ 보안: 이 write들은 진행자(authenticated + is_admin) 세션에서만 RLS를 통과한다.
export async function resetDraftData({ keepLeaders }: { keepLeaders: boolean }): Promise<PostgrestError | null> {
    if (keepLeaders) {
        // 팀장(is_leader=true)은 그대로 두고, 지명으로 채워진 팀원의 배정/공개명만 해제
        const { error } = await supabase.from('participants')
            .update({ team_name: null, reveal_name: null, assigned_randomly: false })
            .eq('is_leader', false);
        return error ?? null;
    }

    // 전원 팀장직·팀배정·공개명 해제
    const { error } = await supabase.from('participants')
        .update({ team_name: null, is_leader: false, reveal_name: null, assigned_randomly: false })
        .not('p_token', 'is', null);
    return error ?? null;
}

// ── 실명 조회 (전부 서버가 권한을 게이팅) ──────────────────────────────────

// 진행자 전용 실명 맵 { p_token: "실명" }. participant_secrets 는 진행자만 RLS로 읽힘.
// 사용처: useAdminNames(진행자 실명 모드에서 화면 표시), 팀장 추첨(공개명 세팅).
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
