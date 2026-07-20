// components/SnakeScreen/snakeOrder.ts
// ---------------------------------------------------------------------------
// 스네이크 드래프트의 "순서 계산" 순수 헬퍼 (부수효과·DB 접근 없음).
//
// 규칙:
//   · 팀장 티어 = is_leader 참가자들의 티어. 그 티어 16명이 팀장(팀당 1명)이라 그 칸은 이미 채워짐.
//   · 지그재그(스네이크)는 "티어 번호"가 아니라 "몇 번째로 뽑은 티어인가"로 방향이 정해진다.
//       첫 번째로 뽑는 티어 → 1팀부터, 두 번째 → 16팀부터, 세 번째 → 다시 1팀부터.
//   · ★ 방향은 배열 위치로 유도하지 않고 page_state.tier_direction({"1":"asc"…})에 저장된 값을 쓴다.
//     배열 인덱스로 유도하면 초기화 시 방향이 뒤집혔다(제거하면 뒤 티어가 당겨지고, tombstone 이면
//     초기화한 티어를 다시 뽑을 때 밀린다). 티어별로 방향을 못 박아 저장하면 두 경우 다 안전하다.
//     아직 안 뽑은 티어는 '지금까지 방향이 정해진 티어 수'의 짝/홀로 확정될 방향을 미리 보여준다.
//   · 랜덤 배치로 채운 티어는 방향 저장에서 빠진다(한 명씩 지명한 게 아니므로).
//   · 현재 차례 = 그 티어에서 아직 비어 있는 첫 칸. (칸을 취소하면 차례가 그 지점으로 되돌아감)
// ---------------------------------------------------------------------------
import { TEAM_COUNT } from '../common/types';
import type { Participant } from '../common/types';

// 전체 티어 목록(문자열). participants.tier 와 동일한 표현.
export const ALL_TIERS = ['1', '2', '3', '4'] as const;

// 스네이크로 채울 남은 티어 (팀장 티어 제외, 오름차순).
export function remainingTiers(leaderTier: string): string[] {
    return ALL_TIERS.filter((t) => t !== leaderTier);
}

// 그 티어에 지금까지 지명된 인원 수(팀장 제외).
function pickedCountIn(participants: Participant[], tier: string): number {
    return participants.filter((p) => p.tier === tier && !p.is_leader && p.team_name).length;
}

// 그 티어가 전부 찼는지(= 더 뽑을 게 없는지).
export function isTierDone(participants: Participant[], tier: string): boolean {
    return pickedCountIn(participants, tier) === TEAM_COUNT;
}

// 티어별 뽑기 방향 맵. page_state.tier_direction 그대로. 없는 티어는 아직 안 뽑은 것.
export type TierDirection = Record<string, 'asc' | 'desc'>;

// 그 티어를 채울 팀 순서(["1팀" … "16팀"] 또는 그 역순).
//  · 이미 방향이 정해진 티어 → 저장된 방향.
//  · 아직 안 뽑은 티어 → 지금까지 방향이 정해진 티어 수의 짝/홀로 '확정될' 방향을 미리 보여준다
//    (서버가 첫 지명 때 같은 규칙으로 확정하므로 첫 지명에 방향이 튀지 않는다).
function teamOrderFor(dir: TierDirection, tier: string): string[] {
    const d = dir[tier] ?? (Object.keys(dir).length % 2 === 0 ? 'asc' : 'desc');
    const order = Array.from({ length: TEAM_COUNT }, (_, i) => `${i + 1}팀`);
    return d === 'desc' ? order.reverse() : order;
}

// 특정 (팀, 티어) 칸에 배정된 스네이크 픽 참가자(팀장 제외). 없으면 null.
export function memberAt(participants: Participant[], team: string, tier: string): Participant | null {
    return participants.find((p) => p.team_name === team && p.tier === tier && !p.is_leader) ?? null;
}

// 그 티어의 현재 차례 팀명 = 순서상 아직 비어 있는 첫 칸. 전부 찼으면 null(그 티어 완료).
export function currentTeamFor(participants: Participant[], dir: TierDirection, tier: string): string | null {
    return teamOrderFor(dir, tier)
        .find((team) => !memberAt(participants, team, tier)) ?? null;
}
