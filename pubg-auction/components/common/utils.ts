// components/common/utils.ts
// ---------------------------------------------------------------------------
// 순수 헬퍼 모음 (부수효과·DB 접근 없음).
// 참가자/추첨/스네이크/결과 화면 전반에서 공유한다. DB를 건드리는 데이터 접근은 data.ts에 있다.
// ---------------------------------------------------------------------------
import type { Participant } from './types';

// 슬롯 0~63은 티어별로 16칸씩 연속 배정된다(0~15=1티어, 16~31=2티어 …).
// ★ 화면 열 수와는 무관하다 — 진행자 그리드는 8열이라 한 티어가 두 줄을 차지한다.
// getTierBySlot / firstFreeSlotInTier 가 공유하는 상수.
const TIER_SIZE = 16;

// ── 슬롯 ↔ 티어 매핑 ───────────────────────────────────────────────────────

// 슬롯 인덱스(0~63)로 티어("1"~"4")를 계산한다.
// 0~15 = 1티어, 16~31 = 2티어, 32~47 = 3티어, 48~63 = 4티어.
// 사용처: ParticipantsScreen(진행자 그리드의 셀별 티어, 빈 칸 등록 시 티어 결정).
export const getTierBySlot = (slotIndex: number): string => {
    const tier = Math.floor(slotIndex / TIER_SIZE) + 1; // 행 번호(0~3) → 티어(1~4)
    return tier >= 1 && tier <= 4 ? String(tier) : '1';
};

// 특정 티어(행)에서 비어 있는 첫 슬롯 인덱스를 반환한다. 자리가 없으면 -1.
// 티어 T의 슬롯 범위는 (T-1)*16 ~ (T-1)*16 + 15.
// 사용처: useParticipantCrud.saveParticipant(신규 등록/티어 변경 시 자리 배정).
export const firstFreeSlotInTier = (tier: string, occupied: Set<number>): number => {
    const start = (parseInt(tier) - 1) * TIER_SIZE;
    for (let i = start; i < start + TIER_SIZE; i++) {
        if (!occupied.has(i)) return i;
    }
    return -1;
};

// ── 표시 이름 (블라인드 규칙의 핵심) ────────────────────────────────────────

// 참가자를 화면에 어떻게 표기할지 결정한다.
//  - realName: "이 참가자를 실명으로 보여줘도 되는가"를 호출부가 이미 판단해 넘긴 값.
//      · 진행자 실명 모드 → participant_secrets 맵에서, 결과 화면 → result_names() RPC 맵에서 넘어온다.
//      · realName 이 없으면(=undefined) 실명을 볼 권한/상황이 아니라는 뜻.
//  - 우선순위: realName(권한 있는 실명) → reveal_name(팀장/공개 대상) → fake_name(블라인드).
//  - 팀장은 항상 "…(팀장)" 접미사.
// 사용처: SnakeScreen, ResultScreen, ParticipantDetailModal.
export const participantLabel = (p: Participant, realName?: string): string => {
    const shown = realName ?? p.reveal_name ?? p.fake_name ?? '?';
    return p.is_leader ? `${shown}(팀장)` : shown;
};

// ── 기타 ────────────────────────────────────────────────────────────────

// 배열을 제자리(in-place) Fisher-Yates 로 섞고 그 배열을 반환한다.
// 사용처: generateAnonNames(익명 조합). 티어 내 슬롯 셔플·팀장 추첨은 서버 RPC 가 직접 수행한다.
export const shuffle = <T>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

// DB 행 배열을 { key: value } 맵으로 변환한다. (key/val 접근자를 받아 타입 안전)
// 사용처: data.ts 의 실명 조회 헬퍼들이 "행 → 맵" 변환에 공유.
export const rowsToMap = <T>(
    rows: T[] | null | undefined,
    key: (row: T) => string,
    val: (row: T) => string,
): Record<string, string> => {
    const map: Record<string, string> = {};
    (rows ?? []).forEach((row) => { map[key(row)] = val(row); });
    return map;
};
