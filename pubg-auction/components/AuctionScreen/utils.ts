// components/AuctionScreen/utils.ts

// 슬롯 인덱스 기준 티어 계산 (16x4 구조)
export const getTierBySlot = (slotIndex: number): string => {
    const row = Math.floor(slotIndex / 16);
    if (row === 0) return "1";
    if (row === 1) return "2";
    if (row === 2) return "3";
    if (row === 3) return "4";
    return "1";
};

import type { Participant } from './types';

// 참가자 표시 이름: 팀장은 항상 "비제이명(팀장)"으로 공개, 그 외엔 showReal에 따라 실명/익명.
export const participantLabel = (p: Participant, showReal: boolean): string =>
    p.is_leader ? `${p.real_name}(팀장)` : (showReal ? p.real_name : (p.fake_name || '?'));

// 팀 표시 이름: "비제이명팀(N팀)". 팀장이 없으면 원래 "N팀".
export const teamLabel = (teamName: string, participants: Participant[]): string => {
    const leader = participants.find((p) => p.is_leader && p.team_name === teamName);
    return leader ? `${leader.real_name}팀-${teamName}` : teamName;
};

// 티어(1~4) 행에서 비어있는 첫 슬롯 인덱스. 자리가 없으면 -1.
// 그리드는 16열 × 4행(행=티어) 구조라, 티어 T의 슬롯 범위는 (T-1)*16 ~ (T-1)*16+15.
export const firstFreeSlotInTier = (tier: string, occupied: Set<number>): number => {
    const start = (parseInt(tier) - 1) * 16;
    for (let i = start; i < start + 16; i++) {
        if (!occupied.has(i)) return i;
    }
    return -1;
};

// 남은 초 -> "mm:ss" (실시간 타이머 표시용)
export const formatTime = (totalSeconds: number): string => {
    const s = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};
