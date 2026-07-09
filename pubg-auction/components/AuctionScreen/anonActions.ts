// components/AuctionScreen/anonActions.ts
// 익명 자동 생성: 전 참가자에 익명 재배정 + 동일 티어 내 슬롯 위치를 무작위로 셔플.
// page.tsx 헤더 버튼에서 호출하므로 훅과 분리된 독립 함수로 둔다.
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/lib/toast';
import { generateAnonNames } from './anonNames';
import type { Participant } from './types';

export async function regenerateAnonymous() {
    const { data, error } = await supabase.from('participants').select('*');
    if (error) { toast.error('참가자 조회 실패: ' + error.message); return; }
    const participants = (data ?? []) as Participant[];
    if (participants.length === 0) { toast.error('등록된 참가자가 없습니다.'); return; }

    const names = generateAnonNames(participants.length);
    const updates: { p_token: string; fake_name: string; slot_index: number }[] = [];
    let nameIdx = 0;

    for (let tier = 1; tier <= 4; tier++) {
        const tierParts = participants.filter((p) => parseInt(p.tier) === tier);
        // Fisher-Yates: 동일 티어 내 배치 순서를 무작위로 섞음
        for (let i = tierParts.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tierParts[i], tierParts[j]] = [tierParts[j], tierParts[i]];
        }
        const start = (tier - 1) * 16;
        tierParts.forEach((p, idx) => {
            updates.push({ p_token: p.p_token, fake_name: names[nameIdx++], slot_index: start + idx });
        });
    }

    const results = await Promise.all(
        updates.map((u) =>
            supabase.from('participants').update({ fake_name: u.fake_name, slot_index: u.slot_index }).eq('p_token', u.p_token),
        ),
    );
    if (results.find((r) => r.error)) { toast.error('익명 생성 중 오류가 발생했습니다.'); return; }
    toast.success('익명이 생성되었습니다.');
}
