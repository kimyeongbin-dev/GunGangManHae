// components/AuctionScreen/anonNames.ts
// 익명 생성용 아이템 이름 (무기 × 회복아이템 = 8×8 = 64 조합). 필요 시 목록만 교체하면 됨.
export const WEAPON_NAMES = ['프라이팬', '수류탄', '연막탄', '섬광탄', '화염병', '크로우바', '마체테', '낫'];
export const HEAL_NAMES = ['붕대', '구급상자', '응급처치', '진통제', '에너지드링크', '아드레날린', '부스터', '회복제'];

// count개의 서로 다른 익명 이름 생성 (셔플). 64개 초과 시 접미 번호를 붙임.
export function generateAnonNames(count: number): string[] {
    const combos: string[] = [];
    for (const w of WEAPON_NAMES) for (const h of HEAL_NAMES) combos.push(`${w} ${h}`);

    // Fisher-Yates 셔플
    for (let i = combos.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [combos[i], combos[j]] = [combos[j], combos[i]];
    }

    const result: string[] = [];
    for (let i = 0; i < count; i++) {
        result.push(i < combos.length ? combos[i] : `${combos[i % combos.length]} ${Math.floor(i / combos.length) + 1}`);
    }
    return result;
}
