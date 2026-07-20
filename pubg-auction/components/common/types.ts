// components/common/types.ts
// ---------------------------------------------------------------------------
// 도메인 공용 타입 + 상수.
// DB 테이블 구조와 1:1로 대응하므로, 여기 타입을 보면 스키마 전체를 파악할 수 있다.
// ---------------------------------------------------------------------------

// participants 테이블 한 행.
// ★ 실명(real_name)은 이 타입에 없다 — 실명은 participant_secrets(진행자 전용)로 분리됐다.
//   화면에 보이는 이름은 reveal_name(공개용) / fake_name(익명) 중 하나다(utils.participantLabel 참고).
export type Participant = {
    slot_index: number;         // 그리드 위치(0~63). 티어별로 16칸씩 연속(티어 = slot_index / 16 + 1).
    p_token: string;            // 참가자 고유 ID(PK). 배정/실명이 모두 이 값으로 연결된다.
    reveal_name: string | null; // 공개 표시명. 팀장/결과공개 시에만 실명이 채워지고, 그 외엔 null(블라인드).
    fake_name: string;          // 익명 이름(예: "프라이팬 붕대"). '익명 만들기'로 생성.
    tier: string;               // 티어 "1"~"4".
    // 평균 딜량 / 한 줄 소갯말 (뽑기 판단용 공개 정보).
    // ★ 팀장인 동안에는 null 이다 — 공개 뷰(participants_public)가 가린다.
    //   팀장은 실명이 공개되는 대상이라, 딜량이 같은 행에 함께 보이면 '실명 ↔ 딜량' 지문이 만들어지고
    //   다음 판에서 익명 카드를 역추적할 수 있게 된다(0008 마이그레이션 참고). 뽑히는 대상도 아니라
    //   가려도 기능 손실이 없다. 정확한 값은 진행자만 기반 테이블에서 읽는다.
    avg_damage: number | null;
    intro: string | null;
    team_name: string | null;   // 배정된 팀("N팀"). 팀장 배정 또는 스네이크 지명 시 채워진다.
    is_leader: boolean;         // 팀장 여부. true면 익명 대신 "실명(팀장)"으로 공개.
    assigned_randomly: boolean; // 배정 방식. true='티어 랜덤 배치'로 한 번에 채움 / false=직접 지명(또는 팀장).
                                // 스네이크 방향(1팀부터/16팀부터) 순번에서 랜덤 티어를 빼는 데 쓴다.
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
export const TEAM_COUNT = 16; // 팀 수 = 팀장 수 = 티어당 인원.
export const SLOT_COUNT = 64; // 참가자 슬롯 수 (티어 4개 × 티어당 16명).
