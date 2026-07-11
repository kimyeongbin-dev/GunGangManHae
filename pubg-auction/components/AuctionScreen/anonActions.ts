// components/AuctionScreen/anonActions.ts
// 익명(fake_name) 재배정 + 동일 티어 내 그리드 슬롯 셔플 로직.
// 훅이 아닌 독립 함수 → 헤더 버튼(page.tsx)과 추첨/해제(drawActions.ts) 양쪽에서 재사용.
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/lib/toast';
import { generateAnonNames } from './anonNames';
import { shuffle } from './utils';
import type { Participant } from './types';

const TIER_ROW_SIZE = 16; // 그리드 한 티어(행)의 슬롯 수 (16열 × 4행 구조)

// [코어] 주어진 참가자들에게 새 익명을 배정하고, 티어별로 슬롯 순서를 무작위로 섞는다.
//  - 토스트를 띄우지 않으므로 다른 흐름(추첨/해제)에서 조용히 재사용할 수 있다.
//  - 각 티어(1~4) 안에서만 셔플 → 티어 구분은 유지한 채 자리만 무작위화.
//  - 반환: 모든 업데이트가 성공했는지 여부.
// 호출: regenerateAnonymous(아래), drawLeaders/releaseLeaders(drawActions.ts).
export async function reassignAnonymous(participants: Participant[]): Promise<boolean> {
    if (participants.length === 0) return true;

    const names = generateAnonNames(participants.length); // 무작위 익명 풀
    const updates: { p_token: string; fake_name: string; slot_index: number }[] = [];
    let nameIdx = 0;

    for (let tier = 1; tier <= 4; tier++) {
        const tierParts = shuffle(participants.filter((p) => parseInt(p.tier) === tier));
        const start = (tier - 1) * TIER_ROW_SIZE; // 이 티어 행의 시작 슬롯 인덱스
        tierParts.forEach((p, idx) => {
            updates.push({ p_token: p.p_token, fake_name: names[nameIdx++], slot_index: start + idx });
        });
    }

    // 참가자별로 fake_name·slot_index만 갱신 (실명·티어 등은 건드리지 않음)
    const results = await Promise.all(
        updates.map((u) =>
            supabase.from('participants').update({ fake_name: u.fake_name, slot_index: u.slot_index }).eq('p_token', u.p_token),
        ),
    );
    return !results.find((r) => r.error);
}

// [진행자] 헤더 '익명 만들기' 버튼 핸들러: 전 참가자를 조회해 재배정하고 결과를 토스트로 안내.
// 호출: page.tsx 헤더의 onClick.
// ★ 동시 실행 방지(모듈 레벨 잠금): 광클로 이 함수가 겹쳐 돌면 64명 슬롯 재배정이 충돌해
//    slot_index가 중복되고, 그리드가 슬롯 기준으로 그려지므로 일부 참가자가 사라진다.
//    실행 중 재호출은 조용히 무시한다(버튼 비활성화와 이중 안전장치).
let regenerating = false;
export async function regenerateAnonymous() {
    if (regenerating) return;
    regenerating = true;
    try {
        const { data, error } = await supabase.from('participants').select('*');
        if (error) { toast.error('참가자 조회 실패: ' + error.message); return; }
        const participants = (data ?? []) as Participant[];
        if (participants.length === 0) { toast.error('등록된 참가자가 없습니다.'); return; }

        const ok = await reassignAnonymous(participants);
        if (!ok) { toast.error('익명 생성 중 오류가 발생했습니다.'); return; }
        toast.success('익명이 생성되었습니다.');
    } finally {
        regenerating = false;
    }
}
