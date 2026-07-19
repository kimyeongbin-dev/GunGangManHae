// components/common/anonNames.ts
// 익명 이름 생성용 단어 풀과 조합기.
// "무기 × 회복아이템" = 8×8 = 64개 조합 → 참가자 익명(fake_name)으로 사용.
// 사용처:
//   · generateAnonNames  → reassignAnonymous(anonActions.ts): 등록/추첨/해제 시 익명 "전체" 재배정.
//   · pickUnusedAnonName → saveParticipant(useParticipantCrud.ts): 신규 참가자 "1명"에게 중복 없는 익명 배정.
import { shuffle } from './utils';

// 필요 시 이 두 목록만 교체하면 익명 테마를 바꿀 수 있다(각 8개 유지 권장).
export const WEAPON_NAMES = ['프라이팬', '수류탄', '연막탄', '섬광탄', '화염병', '크로우바', '마체테', '낫'];
export const HEAL_NAMES = ['붕대', '구급상자', '응급처치', '진통제', '에너지드링크', '아드레날린', '부스터', '회복제'];

// 8×8 = 64개 전체 조합을 만든다. 유일성 판단·생성의 공통 소스(둘 다 이걸 기반으로 동작).
function buildCombos(): string[] {
    const combos: string[] = [];
    for (const w of WEAPON_NAMES) for (const h of HEAL_NAMES) combos.push(`${w} ${h}`);
    return combos;
}

// count개의 서로 다른 익명 이름을 무작위 순서로 생성한다(전체 재배정용).
// 64개(=8×8)를 초과하면 "이름 2", "이름 3"처럼 접미 번호를 붙여 유일성을 유지한다.
export function generateAnonNames(count: number): string[] {
    const combos = shuffle(buildCombos());

    return Array.from({ length: count }, (_, i) =>
        i < combos.length
            ? combos[i]
            : `${combos[i % combos.length]} ${Math.floor(i / combos.length) + 1}`,
    );
}

// 이미 사용 중인 이름들(used)과 겹치지 않는 익명 하나를 무작위로 고른다(신규 1명용).
// 1순위: 아직 안 쓴 기본 조합. 64개가 모두 소진되면 "이름 2", "이름 3"… 접미 번호로 유일성을 잇는다.
// (실사용은 64슬롯 상한이라 접미 경로엔 사실상 도달하지 않는다.)
export function pickUnusedAnonName(used: Iterable<string>): string {
    const taken = new Set(used);
    const combos = shuffle(buildCombos());

    const base = combos.find((c) => !taken.has(c));
    if (base) return base;

    for (let n = 2; n < 1000; n++) {
        const found = combos.find((c) => !taken.has(`${c} ${n}`));
        if (found) return `${found} ${n}`;
    }
    return `익명 ${taken.size + 1}`; // 이론상 도달 불가한 최종 안전망
}
