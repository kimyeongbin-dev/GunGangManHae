// components/AuctionScreen/types.ts

export type Participant = {
    slot_index: number;
    p_token: string;
    real_name: string;
    fake_name: string;
    tier: string;
    avg_damage: number;
    intro: string;
    team_name: string | null;
};

export type AuctionBid = {
    team_name: string;
    bid_amount: number;
    p_token: string;
};

export type Log = {
    id: number;
    message: string;
    created_at: string;
};

// 참가자 등록/수정 모달 폼
export type ModalForm = {
    p_token: string;
    real_name: string;
    fake_name: string;
    avg_damage: string;
    intro: string;
};

export const TEAM_COUNT = 16;
export const SLOT_COUNT = 64; // 16 x 4
export const TEAM_BUDGET = 10000; // 팀별 보유 포인트 (전 팀 동일, 추후 조정)
