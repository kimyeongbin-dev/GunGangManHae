// components/SnakeScreen/snakeOrder.ts
// ---------------------------------------------------------------------------
// 스네이크 드래프트의 "순서 계산" 순수 헬퍼 (부수효과·DB 접근 없음).
//
// 규칙:
//   · 팀장 티어 = is_leader 참가자들의 티어. 그 티어 16명이 팀장(팀당 1명)이라 그 칸은 이미 채워짐.
//   · 지그재그(스네이크)는 "티어 번호"가 아니라 "몇 번째로 뽑는 티어인가"로 방향이 정해진다.
//       첫 번째로 채우는 티어 → 1팀부터, 두 번째 → 16팀부터, 세 번째 → 다시 1팀부터.
//     ★ 그 순번은 '직접 지명으로 다 채운 티어의 개수'로 계산한다.
//       '티어 랜덤 배치'로 통째로 채운 티어는 뽑은 순번에 끼지 않는다 — 한 명씩 지명한 게 아니라
//       운에 맡긴 것이므로, 그걸 세면 실제 지명 순서와 방향이 어긋난다.
//       (예: 1티어를 랜덤으로 채우고 2티어부터 직접 뽑기 시작하면, 2티어가 '첫 번째'라 1팀부터다)
//     ★ 진행자가 어떤 티어를 먼저 고르든 participants만 보면 전원이 같은 방향을 계산하므로
//       방향을 따로 공유할 필요가 없다.
//   · 한 티어 안에서의 순서는 위에서 정해진 방향대로 1→16 또는 16→1 고정이다.
//     순서를 바꾸고 싶으면 '뽑기 순서 리롤'로 팀 전체(팀장+뽑힌 팀원)를 통째로 다른 번호에 옮긴다.
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
export function pickedCountIn(participants: Participant[], tier: string): number {
    return participants.filter((p) => p.tier === tier && !p.is_leader && p.team_name).length;
}

// 그 티어가 전부 찼는지(= 더 뽑을 게 없는지).
export function isTierDone(participants: Participant[], tier: string): boolean {
    return pickedCountIn(participants, tier) === TEAM_COUNT;
}

// 그 티어가 '직접 지명으로' 다 채워졌는지. 랜덤 배치로 채운 티어는 여기서 false다.
// 랜덤 배치는 16명을 한꺼번에 assigned_randomly=true로 덮으므로, 한 명이라도 랜덤이면 랜덤 티어로 본다.
export function isTierDrafted(participants: Participant[], tier: string): boolean {
    if (!isTierDone(participants, tier)) return false;
    return participants
        .filter((p) => p.tier === tier && !p.is_leader && p.team_name)
        .every((p) => !p.assigned_randomly);
}

// 그 티어를 채울 팀 순서(["1팀" … "16팀"] 또는 그 역순).
// 방향 = 이 티어보다 먼저 '직접 뽑아' 끝낸 티어가 몇 개인가 → 짝수면 정순(1팀부터), 홀수면 역순(16팀부터).
export function teamOrderFor(participants: Participant[], leaderTier: string, tier: string): string[] {
    const draftedBefore = remainingTiers(leaderTier)
        .filter((t) => t !== tier && isTierDrafted(participants, t)).length;
    const order = Array.from({ length: TEAM_COUNT }, (_, i) => `${i + 1}팀`);
    return draftedBefore % 2 === 1 ? order.reverse() : order;
}

// 특정 (팀, 티어) 칸에 배정된 스네이크 픽 참가자(팀장 제외). 없으면 null.
export function memberAt(participants: Participant[], team: string, tier: string): Participant | null {
    return participants.find((p) => p.team_name === team && p.tier === tier && !p.is_leader) ?? null;
}

// 그 티어의 현재 차례 팀명 = 순서상 아직 비어 있는 첫 칸. 전부 찼으면 null(그 티어 완료).
export function currentTeamFor(participants: Participant[], leaderTier: string, tier: string): string | null {
    return teamOrderFor(participants, leaderTier, tier)
        .find((team) => !memberAt(participants, team, tier)) ?? null;
}
