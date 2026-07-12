// components/AuctionScreen/auctionData.ts
// ---------------------------------------------------------------------------
// 경매 도메인의 "데이터 접근 계층" — Supabase에 직접 쓰기/읽기 하는 헬퍼를 한곳에 모은다.
// 여러 곳에서 중복되던 (1) 경매 초기화 시퀀스와 (2) 실명/PIN 조회를 여기로 통합했다.
//
// ★ 기밀성(confidentiality) 모델 — 실명이 어디서 어떻게 나오는지 한눈에:
//   · 실명(비제이명)은 오직 participant_secrets 테이블에만 있다.
//   · fetchSecretNames() : 진행자(Supabase Auth)만 RLS로 읽힘 → 진행자 화면 실명 표시용.
//   · fetchResultNames() : result_names() RPC. page_state.reveal_until > now()(전체 공개 중)일 때만 anon에게 실명 반환.
//   · participants 테이블에는 real_name 컬럼이 없다(공개 컬럼 reveal_name은 팀장만 채워짐).
//   → 따라서 이 파일이 "실명이 클라이언트로 흘러나가는 유일한 통로"이며, 그 통로는 전부 서버(RLS/RPC)가 게이팅한다.
// ---------------------------------------------------------------------------
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { rowsToMap } from './utils';

// auction_meta(단일 행, id=1)를 "대기(idle)" 상태로 되돌리는 값.
// 경매 시작 전/중단/종료/초기화 시 공유되는 표준 초기 상태.
export const IDLE_META = { timer_end_at: null, status: 'idle', current_p_token: null };

// Supabase는 "전체 행"을 대상으로 하는 update/delete에도 필터를 요구한다.
// 아래는 "항상 참"이 되어 모든 행을 매치시키는 관용 필터다(의미: 전체 대상).
const MATCH_ALL_BY_ID = { col: 'id', op: 'neq', val: 0 } as const;         // 정수 PK 테이블
const MATCH_ALL_BY_TEAM = { col: 'team_name', op: 'neq', val: '' } as const; // leader_pins

// ── 경매 초기화 ────────────────────────────────────────────────────────────

// 경매 관련 데이터를 초기화한다. drawLeaders/releaseLeaders/resetAuction 이 공유.
//  - keepLeaders=false : 전원 팀장직/팀배정/공개명 해제 + 팀장 PIN 폐기 (추첨/해제 → 완전 재설정)
//  - keepLeaders=true  : 팀장은 유지, 경매로 채운 팀원만 해제 + PIN 유지 (경매 전체 초기화)
// 두 경우 공통: 입찰 전체 삭제 · 로그 전체 삭제 · auction_meta 를 idle 로.
// 첫 오류를 반환(없으면 null)해 호출부가 사용자 안내를 결정한다.
// ※ 보안: 이 write들은 진행자(authenticated + is_admin) 세션에서만 RLS를 통과한다.
export async function resetAuctionData({ keepLeaders }: { keepLeaders: boolean }): Promise<PostgrestError | null> {
    if (keepLeaders) {
        // 팀장(is_leader=true)은 그대로 두고, 낙찰로 채워진 팀원의 배정/공개명만 해제
        const { error } = await supabase.from('participants')
            .update({ team_name: null, reveal_name: null })
            .eq('is_leader', false);
        if (error) return error;
    } else {
        // 전원 팀장직·팀배정·공개명 해제
        const { error } = await supabase.from('participants')
            .update({ team_name: null, is_leader: false, reveal_name: null })
            .not('p_token', 'is', null);
        if (error) return error;
        // 팀장 PIN 폐기 (재추첨/해제 시 기존 PIN 무효화)
        const { error: pinErr } = await supabase.from('leader_pins')
            .delete().neq(MATCH_ALL_BY_TEAM.col, MATCH_ALL_BY_TEAM.val);
        if (pinErr) return pinErr;
    }

    const { error: bidErr } = await supabase.from('auction_bids')
        .delete().neq(MATCH_ALL_BY_ID.col, MATCH_ALL_BY_ID.val);
    if (bidErr) return bidErr;

    const { error: logErr } = await supabase.from('auction_logs')
        .delete().neq(MATCH_ALL_BY_ID.col, MATCH_ALL_BY_ID.val);
    if (logErr) return logErr;

    const { error: metaErr } = await supabase.from('auction_meta')
        .update(IDLE_META).eq('id', 1);
    return metaErr ?? null;
}

// ── 실명/PIN 조회 (전부 서버가 권한을 게이팅) ──────────────────────────────

// 팀장 PIN 맵 { "N팀": "PIN" }. leader_pins 는 진행자만 RLS로 읽힘(anon은 빈 배열).
// 사용처: DrawScreen(진행자에게 각 팀 PIN 표시).
export async function fetchLeaderPins(): Promise<Record<string, string>> {
    const { data } = await supabase.from('leader_pins').select('team_name, pin');
    return rowsToMap(data as { team_name: string; pin: string }[] | null, (r) => r.team_name, (r) => r.pin);
}

// 진행자 전용 실명 맵 { p_token: "실명" }. participant_secrets 는 진행자만 RLS로 읽힘.
// 사용처: useAdminNames(진행자 실명 모드에서 화면 표시), drawActions(팀장 공개명 세팅).
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
