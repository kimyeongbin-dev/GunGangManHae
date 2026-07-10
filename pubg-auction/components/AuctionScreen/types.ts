// components/AuctionScreen/types.ts

export type Participant = {
    slot_index: number;
    p_token: string;
    reveal_name: string | null; // 공개 표시용 이름. 팀장/결과공개 시에만 채워짐(그 외 null=블라인드)
    fake_name: string;
    tier: string;
    avg_damage: number;
    intro: string;
    team_name: string | null;
    is_leader: boolean; // 뽑기권(팀장) 여부 — 익명 제거, 비제이명(팀장)으로 공개
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

// 참가자 등록/수정 모달 폼 (익명 fake_name은 '익명 만들기'로 자동 생성 → 폼에 없음)
export type ModalForm = {
    p_token: string;
    real_name: string;
    tier: string;
    avg_damage: string;
    intro: string;
};

export const TEAM_COUNT = 16;
export const SLOT_COUNT = 64; // 16 x 4
export const TEAM_BUDGET = 10000; // 팀별 보유 포인트 (전 팀 동일, 추후 조정)
