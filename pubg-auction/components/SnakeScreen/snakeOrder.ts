// components/SnakeScreen/snakeOrder.ts
// ---------------------------------------------------------------------------
// 스네이크 드래프트의 "순서 계산" 순수 헬퍼 (부수효과·DB 접근 없음).
//
// 규칙:
//   · 팀장 티어 = is_leader 참가자들의 티어. 그 티어 16명이 팀장(팀당 1명)이라 그 칸은 이미 채워짐.
//   · 지그재그(스네이크)는 "티어 번호"가 아니라 "몇 번째로 뽑은 티어인가"로 방향이 정해진다.
//       첫 번째로 뽑는 티어 → 1팀부터, 두 번째 → 16팀부터, 세 번째 → 다시 1팀부터.
//   · ★ 그 순번은 계산으로 유도하지 않고 page_state.draft_order 에 기록된 값을 쓴다.
//     예전에는 '지금 완료된 티어 수'로 매번 재계산했는데, 그러면 방향이 과거 사실이 아니라
//     현재 상태의 함수가 되어 — 완료된 티어의 지명을 하나 취소하는 순간 진행 중인 티어의
//     방향이 소급해서 뒤집혔다(16팀 라인에서 1팀 라인으로 점프). 기록해 두면 그런 일이 없다.
//   · 랜덤 배치로 채운 티어는 draft_order 에 들어가지 않는다(한 명씩 지명한 게 아니므로).
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

// 그 티어를 채울 팀 순서(["1팀" … "16팀"] 또는 그 역순).
// 방향 = draft_order 에서의 위치(짝수=정순, 홀수=역순). 아직 기록에 없는 티어(= 이제 처음 뽑는 티어)는
// 배열 끝에 붙을 예정이므로 draftOrder.length 를 위치로 본다.
function teamOrderFor(draftOrder: string[], tier: string): string[] {
    const idx = draftOrder.indexOf(tier);
    const round = idx === -1 ? draftOrder.length : idx;
    const order = Array.from({ length: TEAM_COUNT }, (_, i) => `${i + 1}팀`);
    return round % 2 === 1 ? order.reverse() : order;
}

// 특정 (팀, 티어) 칸에 배정된 스네이크 픽 참가자(팀장 제외). 없으면 null.
export function memberAt(participants: Participant[], team: string, tier: string): Participant | null {
    return participants.find((p) => p.team_name === team && p.tier === tier && !p.is_leader) ?? null;
}

// 그 티어의 현재 차례 팀명 = 순서상 아직 비어 있는 첫 칸. 전부 찼으면 null(그 티어 완료).
export function currentTeamFor(participants: Participant[], draftOrder: string[], tier: string): string | null {
    return teamOrderFor(draftOrder, tier)
        .find((team) => !memberAt(participants, team, tier)) ?? null;
}
