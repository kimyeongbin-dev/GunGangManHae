// components/SnakeScreen/snakeActions.ts
// ---------------------------------------------------------------------------
// 스네이크 드래프트 DB 액션 (진행자 전용).
//
// ★ 판을 바꾸는 연산은 전부 서버의 원자적 RPC(0007 마이그레이션)를 호출한다.
//   예전에는 클라이언트가 64건을 8건씩 나눠 PATCH 했는데,
//     · 중간 실패 시 절반만 반영돼 slot_index/team_name 이 겹쳤고(그리드에서 참가자 소실),
//     · RLS 로 막히면 Supabase 가 "에러 없이 0행"을 주므로 실패를 성공으로 처리했고,
//     · 유니크 제약을 걸 수도 없었다(순열 도중 전이적 중복).
//   RPC 하나 = 한 트랜잭션이라 전부 반영되거나 전부 롤백되고, 권한이 없으면 예외가 난다.
//
//   · snake_draw_leaders     : 검증 → 초기화 → 토큰 회전 → 익명 재배정 → 팀장 배정
//   · snake_release_leaders  : 전원 해제 → 토큰 회전 → 익명 재배정
//   · snake_assign_pick      : 지명 + (그 티어를 처음 뽑으면) tier_direction 에 방향 확정 저장
//   · snake_cancel_pick      : 지명 취소 (tier_direction 은 건드리지 않음 — 방향 보존)
//   · snake_reset_tier       : 티어 초기화 + tier_direction 에서 그 티어 방향 제거
//   · snake_fill_tier_randomly : 티어 16명 통째 무작위 배치 + tier_direction 에서 제거
//   · snake_reroll_teams     : 팀 번호 순열 재배열(팀 구성 유지)
// ---------------------------------------------------------------------------
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/lib/toast';
import { generateAnonNames } from '../common/anonNames';
import { runExclusive } from '../common/actionLock';
import { SLOT_COUNT } from '../common/types';
import type { TierDirection } from './snakeOrder';

// RPC 호출 공통 처리. 실패하면 서버가 준 메시지를 그대로 보여준다
// (권한 없음 / 인원 부족 / 제약 위반이 전부 여기로 올라온다).
async function callRpc(fn: string, args: Record<string, unknown>, failMsg: string): Promise<boolean> {
    const { error } = await supabase.rpc(fn, args);
    if (error) {
        toast.error(`${failMsg}\n${error.message}`);
        return false;
    }
    return true;
}

// ── 판 전체를 바꾸는 조작 (전역 잠금으로 서로 겹치지 않게) ─────────────────

// [진행자] 팀장 추첨. leaderTier 가 null 이면 서버가 1~4 중 무작위로 고른다.
// 검증(티어별 16명)도 서버가 먼저 하므로, 인원이 안 맞으면 토큰이 회전되지 않고 그대로 튕긴다.
export async function drawSnakeLeaders(leaderTier: string | null): Promise<boolean> {
    const ok = await runExclusive(() =>
        callRpc('snake_draw_leaders',
            { p_leader_tier: leaderTier, p_names: generateAnonNames(SLOT_COUNT) },
            '팀장 추첨에 실패했습니다.'),
    );
    return ok ?? false;
}

// [진행자] 팀장 해제: 전원 익명 미배정으로 복귀 + 토큰 회전.
export async function releaseLeaders(): Promise<boolean> {
    const ok = await runExclusive(() =>
        callRpc('snake_release_leaders',
            { p_names: generateAnonNames(SLOT_COUNT) },
            '팀장 해제에 실패했습니다.'),
    );
    return ok ?? false;
}

// [진행자] 티어 초기화: 그 티어 비팀장 전원 미배정 + 뽑은 순번에서 제거.
export async function resetSnakeTier(tier: string): Promise<boolean> {
    const ok = await runExclusive(() =>
        callRpc('snake_reset_tier', { p_tier: tier }, '티어 초기화에 실패했습니다.'),
    );
    return ok ?? false;
}

// [진행자] 티어 랜덤 배치: 16명을 통째로 1~16팀에 재배치(누를 때마다 다시 섞임).
export async function fillTierRandomly(tier: string): Promise<boolean> {
    const ok = await runExclusive(() =>
        callRpc('snake_fill_tier_randomly', { p_tier: tier }, '랜덤 배치에 실패했습니다.'),
    );
    return ok ?? false;
}

// [진행자] 뽑기 순서 리롤: 팀 번호를 통째로 재배열. 팀장과 이미 뽑힌 팀원이 함께 이동해 구성이 유지된다.
export async function rerollTeamOrder(): Promise<boolean> {
    const ok = await runExclusive(() =>
        callRpc('snake_reroll_teams', {}, '순서 리롤에 실패했습니다.'),
    );
    return ok ?? false;
}

// ── 한 명 단위 조작 (빠른 경로. 전역 잠금이 걸려 있으면 조용히 건너뜀) ─────

// [진행자] 지명: 현재 차례 팀에 배정하고, 그 티어를 '뽑은 순번'에 기록한다.
export async function assignSnakePick(pToken: string, team: string): Promise<boolean> {
    const ok = await runExclusive(
        () => callRpc('snake_assign_pick', { p_target: pToken, p_team: team }, '지명에 실패했습니다.'),
        true,
    );
    return ok ?? false;
}

// [진행자] 지명 취소. ★ 방향 저장(tier_direction)은 건드리지 않는다 —
// 과거에 그 티어를 직접 뽑았다는 사실이 유지되어야 진행 중 티어의 방향이 안 뒤집힌다.
export async function cancelSnakePick(pToken: string): Promise<boolean> {
    const ok = await runExclusive(
        () => callRpc('snake_cancel_pick', { p_target: pToken }, '지명 취소에 실패했습니다.'),
        true,
    );
    return ok ?? false;
}

// ── 진행 상태 공유 (진행 티어 · 티어별 방향) ───────────────────────────────

// page_state 한 행에서 진행 티어와 티어별 뽑기 방향을 함께 읽는다.
export async function fetchDraftState(): Promise<{ activeTier: string | null; tierDirection: TierDirection }> {
    const { data } = await supabase.from('page_state').select('active_tier, tier_direction').eq('id', 1).maybeSingle();
    return {
        activeTier: (data?.active_tier as string | null) ?? null,
        tierDirection: (data?.tier_direction as TierDirection | null) ?? {},
    };
}

// [진행자] 진행 티어 저장 → 전원이 realtime 으로 같은 차례를 본다.
// RLS 로 막히면 Supabase 는 "에러 없이 0행"만 갱신하므로 .select() 로 반영을 확인한다.
export async function saveActiveTier(tier: string): Promise<boolean> {
    const { data, error } = await supabase.from('page_state')
        .update({ active_tier: tier, updated_at: new Date().toISOString() })
        .eq('id', 1)
        .select();
    if (error || !data?.length) {
        toast.error('진행 티어 저장에 실패했습니다.\n진행자 세션이 만료됐을 수 있어요.');
        return false;
    }
    return true;
}
