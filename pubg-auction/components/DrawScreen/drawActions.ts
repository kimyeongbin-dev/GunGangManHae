// components/DrawScreen/drawActions.ts
// 팀장(뽑기권) 추첨: 티어 제약 없이 무작위 16명을 뽑아 각 팀에 배정.
// 재추첨은 기존 팀 구성/입찰/타이머를 초기화한 뒤 새로 뽑는다.
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/lib/toast';
import { TEAM_COUNT } from '../AuctionScreen/types';
import type { Participant } from '../AuctionScreen/types';

export async function drawLeaders() {
    const { data, error } = await supabase.from('participants').select('*');
    if (error) { toast.error('참가자 조회 실패: ' + error.message); return; }
    const participants = (data ?? []) as Participant[];
    if (participants.length < TEAM_COUNT) {
        toast.error(`팀장 추첨에는 최소 ${TEAM_COUNT}명이 필요합니다. (현재 ${participants.length}명)`);
        return;
    }

    // 1) 기존 팀 구성/입찰/타이머 전체 초기화 (재추첨 = 팀 재설정)
    await supabase.from('participants').update({ team_name: null, is_leader: false }).not('p_token', 'is', null);
    await supabase.from('auction_bids').delete().neq('id', 0);
    await supabase.from('auction_meta').update({ timer_end_at: null, status: 'idle', current_p_token: null }).eq('id', 1);

    // 2) 무작위 16명 선정 (Fisher-Yates)
    const shuffled = [...participants];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const leaders = shuffled.slice(0, TEAM_COUNT);

    // 3) 각 팀장에 팀 배정 (뽑힌 순서대로 1~16팀)
    const results = await Promise.all(
        leaders.map((p, i) =>
            supabase.from('participants').update({ is_leader: true, team_name: `${i + 1}팀` }).eq('p_token', p.p_token),
        ),
    );
    if (results.find((r) => r.error)) { toast.error('팀장 추첨 중 오류가 발생했습니다.'); return; }

    // 완료 안내는 로그 기반 announce가 모두에게 표시
    await supabase.from('auction_logs').insert({ message: `팀장 추첨 완료 (${TEAM_COUNT}팀)` });
}

// 팀장 해제: 모든 팀장직을 박탈하고 팀 구성/입찰/타이머를 초기화 → 전원 익명 미배정 상태로 복귀.
export async function releaseLeaders() {
    await supabase.from('participants').update({ team_name: null, is_leader: false }).not('p_token', 'is', null);
    await supabase.from('auction_bids').delete().neq('id', 0);
    await supabase.from('auction_meta').update({ timer_end_at: null, status: 'idle', current_p_token: null }).eq('id', 1);
    // 안내는 로그 기반 announce가 모두에게 표시
    await supabase.from('auction_logs').insert({ message: '팀장 해제 (전원 익명 참가자로 복귀)' });
}
