// components/AuctionScreen/types.ts
// ---------------------------------------------------------------------------
// 경매 도메인 공용 타입 + 상수.
// DB 테이블 구조와 1:1로 대응하므로, 여기 타입을 보면 스키마 전체를 파악할 수 있다.
// ---------------------------------------------------------------------------

// participants 테이블 한 행.
// ★ 실명(real_name)은 이 타입에 없다 — 실명은 participant_secrets(진행자 전용)로 분리됐다.
//   화면에 보이는 이름은 reveal_name(공개용) / fake_name(익명) 중 하나다(utils.participantLabel 참고).
export type Participant = {
    slot_index: number;         // 미배정 그리드 위치(0~63). 티어 = slot_index / 16.
    p_token: string;            // 참가자 고유 ID(PK). 입찰/대상/실명/PIN이 모두 이 값으로 연결된다.
    reveal_name: string | null; // 공개 표시명. 팀장/결과공개 시에만 실명이 채워지고, 그 외엔 null(블라인드).
    fake_name: string;          // 익명 이름(예: "프라이팬 붕대"). '익명 만들기'로 생성.
    tier: string;               // 티어 "1"~"4".
    avg_damage: number;         // 평균 딜량(공개 정보).
    intro: string;              // 한 줄 소갯말(공개 정보).
    team_name: string | null;   // 배정된 팀("N팀"). 팀장 배정 또는 낙찰 시 채워진다.
    is_leader: boolean;         // 뽑기권(팀장) 여부. true면 익명 대신 "실명(팀장)"으로 공개.
};

// auction_bids 테이블 한 행. 입찰 1건 = 어떤 참가자(p_token)에 어느 팀이 얼마를 걸었는가.
export type AuctionBid = {
    team_name: string;
    bid_amount: number;
    p_token: string;
};

// auction_logs 테이블 한 행. 경매 이벤트 로그(= 전원에게 방송 토스트로도 표시됨).
export type Log = {
    id: number;
    message: string;
    created_at: string;
};

// 참가자 등록/수정 모달의 폼 상태.
// real_name은 여기(폼)에만 있고, 저장 시 participant_secrets로 들어간다(participants에는 안 감).
export type ModalForm = {
    p_token: string;   // 빈 문자열이면 신규 등록, 값이 있으면 해당 참가자 수정.
    real_name: string; // 비제이명(실명 입력).
    tier: string;
    avg_damage: string; // 폼에서는 문자열, 저장 시 parseInt.
    intro: string;
};

// ── 대회 설정 상수 (여기 값만 바꾸면 규모/규칙 조정) ──────────────────────────
export const TEAM_COUNT = 16;             // 팀 수 = 팀장 수.
export const SLOT_COUNT = 64;             // 참가자 슬롯 수 (16열 × 4티어).
export const TEAM_BUDGET = 10000;         // 팀별 보유 포인트(전 팀 동일). place_bid RPC의 예산 상수와 일치시켜야 함.
export const AUCTION_DURATION_SEC = 15;   // 경매 1회차 시작 시간(초). 입찰 시 10초룰로 연장됨.
