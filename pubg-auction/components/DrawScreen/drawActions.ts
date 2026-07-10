// components/DrawScreen/drawActions.ts
// 팀장(뽑기권) 추첨: 티어 제약 없이 무작위 16명을 뽑아 각 팀에 배정.
// 재추첨/해제는 팀 구성·입찰·로그·타이머를 초기화하고 익명/슬롯을 다시 섞은 뒤 진행한다.
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/lib/toast';
import { TEAM_COUNT } from '../AuctionScreen/types';
import { reassignAnonymous } from '../AuctionScreen/anonActions';
import type { Participant } from '../AuctionScreen/types';

// 팀장 PIN 생성: 혼동 문자(O,0,I,1,L) 제외한 6자리
const PIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genPin(): string {
    let s = '';
    for (let i = 0; i < 6; i++) s += PIN_ALPHABET[Math.floor(Math.random() * PIN_ALPHABET.length)];
    return s;
}
function genUniquePins(n: number): string[] {
    const set = new Set<string>();
    while (set.size < n) set.add(genPin());
    return [...set];
}

export async function drawLeaders() {
    const { data, error } = await supabase.from('participants').select('*');
    if (error) { toast.error('참가자 조회 실패: ' + error.message); return; }
    const participants = (data ?? []) as Participant[];
    if (participants.length < TEAM_COUNT) {
        toast.error(`팀장 추첨에는 최소 ${TEAM_COUNT}명이 필요합니다. (현재 ${participants.length}명)`);
        return;
    }

    // 1) 기존 팀 구성/공개명/입찰/로그/타이머/팀장PIN 전체 초기화 (재추첨 = 팀 재설정)
    await supabase.from('participants').update({ team_name: null, is_leader: false, reveal_name: null }).not('p_token', 'is', null);
    await supabase.from('auction_bids').delete().neq('id', 0);
    await supabase.from('leader_pins').delete().neq('team_name', '');
    await supabase.from('auction_logs').delete().neq('id', 0);
    await supabase.from('auction_meta').update({ timer_end_at: null, status: 'idle', current_p_token: null }).eq('id', 1);

    // 1b) 익명(fake_name) 재배정 + 동일 티어 내 슬롯 셔플
    await reassignAnonymous(participants);

    // 2) 무작위 16명 선정 (Fisher-Yates)
    const shuffled = [...participants];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const leaders = shuffled.slice(0, TEAM_COUNT);

    // 3) 각 팀장에 팀 배정 + 공개명(reveal_name) 설정 (팀장 실명은 secrets에서 조회)
    const tokens = leaders.map((l) => l.p_token);
    const { data: secretRows } = await supabase.from('participant_secrets').select('p_token, real_name').in('p_token', tokens);
    const realMap = new Map(((secretRows ?? []) as { p_token: string; real_name: string }[]).map((r) => [r.p_token, r.real_name]));
    const results = await Promise.all(
        leaders.map((p, i) =>
            supabase.from('participants')
                .update({ is_leader: true, team_name: `${i + 1}팀`, reveal_name: realMap.get(p.p_token) ?? null })
                .eq('p_token', p.p_token),
        ),
    );
    if (results.find((r) => r.error)) { toast.error('팀장 추첨 중 오류가 발생했습니다.'); return; }

    // 4) 팀장별 PIN 발급 (진행자가 각 팀장에게 배포 → 팀장만 입찰 가능)
    const pins = genUniquePins(TEAM_COUNT);
    const pinRows = leaders.map((p, i) => ({ team_name: `${i + 1}팀`, p_token: p.p_token, pin: pins[i] }));
    const { error: pinErr } = await supabase.from('leader_pins').insert(pinRows);
    if (pinErr) { toast.error('팀장 PIN 생성 실패: ' + pinErr.message); return; }

    // 완료 안내는 로그 기반 announce가 모두에게 표시
    await supabase.from('auction_logs').insert({ message: `팀장 추첨 완료 (${TEAM_COUNT}팀)` });
}

// 팀장 해제: 모든 팀장직을 박탈하고 팀 구성/입찰/로그/타이머를 초기화 + 익명/슬롯 재배정
// → 전원 익명 미배정 상태로 복귀.
export async function releaseLeaders() {
    const { data } = await supabase.from('participants').select('*');
    const participants = (data ?? []) as Participant[];

    await supabase.from('participants').update({ team_name: null, is_leader: false, reveal_name: null }).not('p_token', 'is', null);
    await supabase.from('auction_bids').delete().neq('id', 0);
    await supabase.from('leader_pins').delete().neq('team_name', '');
    await supabase.from('auction_logs').delete().neq('id', 0);
    await supabase.from('auction_meta').update({ timer_end_at: null, status: 'idle', current_p_token: null }).eq('id', 1);

    // 익명(fake_name) 재배정 + 동일 티어 내 슬롯 셔플
    await reassignAnonymous(participants);

    // 안내는 로그 기반 announce가 모두에게 표시
    await supabase.from('auction_logs').insert({ message: '팀장 해제 (전원 익명 참가자로 복귀)' });
}
