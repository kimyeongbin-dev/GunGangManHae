// components/SnakeScreen/snakeOrder.ts
// ---------------------------------------------------------------------------
// 스네이크 드래프트의 "순서 계산" 순수 헬퍼 (부수효과·DB 접근 없음).
//
// 규칙:
//   · 팀장 티어 = is_leader 참가자들의 티어. 그 티어 16명이 팀장(팀당 1명)이라 그 칸은 이미 채워짐.
//   · 남은 3개 티어를 지그재그(스네이크)로 채운다:
//       첫 티어 1팀→16팀, 다음 티어 16팀→1팀, 다음 티어 1팀→16팀.
//   · 현재 차례 = 이 순서에서 아직 비어 있는 첫 칸. (칸을 취소하면 차례가 그 지점으로 되돌아감)
// ---------------------------------------------------------------------------
import { TEAM_COUNT } from '../AuctionScreen/types';
import type { Participant } from '../AuctionScreen/types';

// 전체 티어 목록(문자열). participants.tier 와 동일한 표현.
export const ALL_TIERS = ['1', '2', '3', '4'] as const;

// 스네이크 픽 순서의 한 칸: 어느 팀의 어느 티어를, 순서상 몇 번째로 뽑는가.
export type PickCell = { tier: string; team: string; index: number };

// 팀장 티어(is_leader 참가자의 티어). 아직 팀장 추첨 전이면 null.
export function leaderTierOf(participants: Participant[]): string | null {
    return participants.find((p) => p.is_leader)?.tier ?? null;
}

// 스네이크로 채울 남은 티어 3개 (팀장 티어 제외, 오름차순).
export function remainingTiers(leaderTier: string): string[] {
    return ALL_TIERS.filter((t) => t !== leaderTier);
}

// 전체 스네이크 순서(48칸 = 3티어 × 16팀). 라운드마다 방향을 뒤집어 지그재그를 만든다.
export function buildSnakeSequence(leaderTier: string): PickCell[] {
    const seq: PickCell[] = [];
    remainingTiers(leaderTier).forEach((tier, round) => {
        const order = Array.from({ length: TEAM_COUNT }, (_, i) => i + 1);
        if (round % 2 === 1) order.reverse(); // 홀수 라운드(2번째)는 16팀→1팀 역순
        order.forEach((n) => seq.push({ tier, team: `${n}팀`, index: seq.length }));
    });
    return seq;
}

// 특정 (팀, 티어) 칸에 배정된 스네이크 픽 참가자(팀장 제외). 없으면 null.
export function memberAt(participants: Participant[], team: string, tier: string): Participant | null {
    return participants.find((p) => p.team_name === team && p.tier === tier && !p.is_leader) ?? null;
}

// 현재 차례 = 순서상 아직 비어 있는 첫 칸. 전부 찼으면 null(완료).
export function currentPick(seq: PickCell[], participants: Participant[]): PickCell | null {
    return seq.find((c) => !memberAt(participants, c.team, c.tier)) ?? null;
}
