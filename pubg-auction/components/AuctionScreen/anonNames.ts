// components/AuctionScreen/anonNames.ts
// 익명 이름 생성용 단어 풀과 조합기.
// "무기 × 회복아이템" = 8×8 = 64개 조합 → 참가자 익명(fake_name)으로 사용.
// 사용처: reassignAnonymous(anonActions.ts) — 등록/추첨/해제 시 익명 재배정.
import { shuffle } from './utils';

// 필요 시 이 두 목록만 교체하면 익명 테마를 바꿀 수 있다(각 8개 유지 권장).
export const WEAPON_NAMES = ['프라이팬', '수류탄', '연막탄', '섬광탄', '화염병', '크로우바', '마체테', '낫'];
export const HEAL_NAMES = ['붕대', '구급상자', '응급처치', '진통제', '에너지드링크', '아드레날린', '부스터', '회복제'];

// count개의 서로 다른 익명 이름을 무작위 순서로 생성한다.
// 64개(=8×8)를 초과하면 "이름 2", "이름 3"처럼 접미 번호를 붙여 유일성을 유지한다.
export function generateAnonNames(count: number): string[] {
    const combos: string[] = [];
    for (const w of WEAPON_NAMES) for (const h of HEAL_NAMES) combos.push(`${w} ${h}`);
    shuffle(combos);

    return Array.from({ length: count }, (_, i) =>
        i < combos.length
            ? combos[i]
            : `${combos[i % combos.length]} ${Math.floor(i / combos.length) + 1}`,
    );
}
