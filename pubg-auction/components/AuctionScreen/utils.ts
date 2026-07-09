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

// 남은 초 -> "mm:ss" (실시간 타이머 표시용)
export const formatTime = (totalSeconds: number): string => {
    const s = Math.max(0, Math.floor(totalSeconds));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};
