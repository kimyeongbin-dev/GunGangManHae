// components/SnakeScreen/snakeActions.ts
// ---------------------------------------------------------------------------
// 스네이크 드래프트 관련 DB 액션 (진행자 전용 쓰기).
//   · drawSnakeLeaders : 티어 1개를 무작위로 뽑아 그 티어 16명을 팀장으로 배정.
//   · assignSnakePick  : 참가자를 현재 차례 팀에 배정(픽 등록).
//   · cancelSnakePick  : 팀 배정 해제(픽 취소, × 버튼).
// 모두 진행자(authenticated + is_admin) 세션에서만 RLS를 통과한다. 팀장 PIN은 쓰지 않는다
// (스네이크는 진행자가 방송 채팅으로 지명을 받아 대신 등록하는 방식이라 팀장 로그인 불필요).
// ---------------------------------------------------------------------------
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/lib/toast';
import { TEAM_COUNT } from '../AuctionScreen/types';
import { shuffle } from '../AuctionScreen/utils';
import { resetAuctionData, fetchSecretNames } from '../AuctionScreen/auctionData';
import { reassignAnonymous } from '../AuctionScreen/anonActions';
import { ALL_TIERS } from './snakeOrder';
import type { Participant } from '../AuctionScreen/types';

// [진행자] 스네이크 팀장 추첨: 초기화 → 익명 재배정 → 티어 1개 무작위 선정 → 그 티어 16명을 팀장으로.
// 팀장은 경매와 동일하게 공개명(reveal_name=실명)으로 노출. 나머지 픽 참가자는 결과까지 익명.
export async function drawSnakeLeaders(): Promise<boolean> {
    const { data, error } = await supabase.from('participants').select('*');
    if (error) { toast.error('참가자 조회 실패: ' + error.message); return false; }
    const participants = (data ?? []) as Participant[];

    // 티어별 인원 확인: 각 티어가 정확히 16명이어야 한다
    // (뽑힌 티어=팀장 16명, 나머지 각 티어=스네이크로 채울 16명).
    for (const t of ALL_TIERS) {
        const n = participants.filter((p) => p.tier === t).length;
        if (n !== TEAM_COUNT) {
            toast.error(`${t}티어가 ${n}명입니다. 스네이크 추첨에는 티어별 정확히 ${TEAM_COUNT}명이 필요합니다.`);
            return false;
        }
    }

    // 1) 이전 구성/경매/PIN/로그 전부 초기화 (재추첨 = 완전 재설정)
    const resetErr = await resetAuctionData({ keepLeaders: false });
    if (resetErr) { toast.error('초기화 실패: ' + resetErr.message); return false; }

    // 2) 익명(fake_name) + 티어 내 슬롯 셔플
    await reassignAnonymous(participants);

    // 3) 무작위 티어 1개 → 그 티어 16명을 팀장으로. 팀(1~16)은 셔플해 배정, 공개명은 실명(진행자 전용 secrets).
    const tier = ALL_TIERS[Math.floor(Math.random() * ALL_TIERS.length)];
    const chosen = shuffle(participants.filter((p) => p.tier === tier));
    const realNames = await fetchSecretNames();
    const results = await Promise.all(
        chosen.map((p, i) =>
            supabase.from('participants')
                .update({ is_leader: true, team_name: `${i + 1}팀`, reveal_name: realNames[p.p_token] ?? null })
                .eq('p_token', p.p_token),
        ),
    );
    if (results.find((r) => r.error)) { toast.error('팀장 배정 중 오류가 발생했습니다.'); return false; }

    return true;
}

// [진행자] 픽 등록: 참가자를 팀에 배정한다(스네이크 현재 차례 팀).
export async function assignSnakePick(pToken: string, team: string): Promise<boolean> {
    const { error } = await supabase.from('participants').update({ team_name: team }).eq('p_token', pToken);
    if (error) { toast.error('픽 등록 실패: ' + error.message); return false; }
    return true;
}

// [진행자] 픽 취소: 팀 배정을 해제한다(× 버튼). 취소하면 그 칸이 현재 차례로 되돌아간다.
export async function cancelSnakePick(pToken: string): Promise<boolean> {
    const { error } = await supabase.from('participants').update({ team_name: null }).eq('p_token', pToken);
    if (error) { toast.error('픽 취소 실패: ' + error.message); return false; }
    return true;
}

// [진행자] 특정 티어 리롤: 그 티어의 스네이크 픽(팀장 제외)을 전부 미배정으로 되돌린다.
// 팀장 티어는 대상이 아니다(is_leader=true는 건드리지 않음). 이후 그 티어가 다시 현재 차례가 된다.
export async function resetSnakeTier(tier: string): Promise<boolean> {
    const { error } = await supabase.from('participants')
        .update({ team_name: null })
        .eq('tier', tier)
        .eq('is_leader', false);
    if (error) { toast.error('티어 초기화 실패: ' + error.message); return false; }
    return true;
}
