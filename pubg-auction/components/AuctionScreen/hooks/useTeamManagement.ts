// components/AuctionScreen/hooks/useTeamManagement.ts
// [팀 관리 로직] 참가자 등록/삭제, 입찰, 자동 낙찰, 팀 포인트 집계
import { useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { toast, confirmDialog } from '@/lib/toast';
import { firstFreeSlotInTier } from '../utils';
import { TEAM_COUNT } from '../types';
import type { Participant, AuctionBid, ModalForm } from '../types';

type Options = {
    participants: Participant[];
    auctionBids: AuctionBid[];
    auctionTarget: Participant | null;
    auctionRunning: boolean;
    isAdmin: boolean;
};

export function useTeamManagement({ participants, auctionBids, auctionTarget, auctionRunning, isAdmin }: Options) {
    // 공유 경매 대상 해제 (auction_meta.current_p_token = null → 모든 클라이언트 반영)
    const clearTarget = () =>
        supabase.from('auction_meta').update({ current_p_token: null }).eq('id', 1);

    // 현재 대상자의 최고 입찰가 (입찰 목록에서 파생)
    const currentHighestBid = useMemo(() => {
        if (!auctionTarget) return 0;
        return auctionBids
            .filter((b) => b.p_token === auctionTarget.p_token)
            .reduce((max, b) => Math.max(max, b.bid_amount), 0);
    }, [auctionBids, auctionTarget]);

    // 팀별 소진 포인트 = 확정 팀원(team_name 보유)들의 최종 낙찰가 합산.
    // (입찰만 하고 낙찰 못 한 포인트는 소비되지 않으므로 제외)
    const teamPoints = useMemo(() => {
        const points: Record<string, number> = {};
        for (let t = 1; t <= TEAM_COUNT; t++) points[`${t}팀`] = 0;
        participants.forEach((p) => {
            if (!p.team_name || !(p.team_name in points)) return;
            const finalPrice = auctionBids
                .filter((b) => b.p_token === p.p_token)
                .reduce((max, b) => Math.max(max, b.bid_amount), 0);
            points[p.team_name] += finalPrice;
        });
        return points;
    }, [participants, auctionBids]);

    // 참가자별 최종 낙찰가 (p_token → 최고 입찰가). 팀 표에 "이름(낙찰가)" 표시용
    const memberPrices = useMemo(() => {
        const prices: Record<string, number> = {};
        auctionBids.forEach((b) => {
            if (b.p_token) prices[b.p_token] = Math.max(prices[b.p_token] ?? 0, b.bid_amount);
        });
        return prices;
    }, [auctionBids]);

    // [진행자] 참가자 등록/수정 (익명 fake_name은 '익명 만들기'로 별도 생성)
    const saveParticipant = async (form: ModalForm): Promise<boolean> => {
        const { p_token, real_name, tier, avg_damage, intro } = form;
        if (!real_name || !tier || !avg_damage) {
            toast.error('비제이명, 티어, 딜량을 입력하세요.');
            return false;
        }

        // 편집: 이름/티어/딜량/소갯말만 갱신 (익명 유지, 티어 변경 시에만 슬롯 이동)
        if (p_token) {
            const existing = participants.find((p) => p.p_token === p_token);
            let slot_index = existing?.slot_index ?? null;
            if (existing && existing.tier !== tier) {
                const occupied = new Set(
                    participants.filter((p) => p.p_token !== p_token && p.slot_index != null).map((p) => p.slot_index as number),
                );
                const free = firstFreeSlotInTier(tier, occupied);
                if (free === -1) { toast.error(`${tier}티어 자리가 가득 찼습니다.`); return false; }
                slot_index = free;
            }
            const { error } = await supabase.from('participants')
                .update({ real_name, tier, avg_damage: parseInt(avg_damage), intro, slot_index })
                .eq('p_token', p_token);
            if (error) { toast.error('저장 에러: ' + error.message); return false; }
            return true;
        }

        // 신규: 선택 티어의 첫 빈 슬롯에 배치, 익명은 빈 값으로 시작
        const occupied = new Set(participants.filter((p) => p.slot_index != null).map((p) => p.slot_index as number));
        const free = firstFreeSlotInTier(tier, occupied);
        if (free === -1) { toast.error(`${tier}티어 자리가 가득 찼습니다.`); return false; }

        const { error } = await supabase.from('participants').insert({
            p_token: `p_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            slot_index: free,
            tier,
            real_name,
            fake_name: '',
            avg_damage: parseInt(avg_damage),
            intro,
        });
        if (error) { toast.error('저장 에러: ' + error.message); return false; }
        return true;
    };

    // [진행자] 참가자 삭제
    const deleteParticipant = async (p_token: string): Promise<boolean> => {
        if (!p_token) return false;
        if (!(await confirmDialog('해당 참가자 데이터를 영구 삭제하시겠습니까?'))) return false;

        const { error } = await supabase.from('participants').delete().eq('p_token', p_token);
        if (error) {
            toast.error('삭제 실패: ' + error.message);
            return false;
        }
        return true;
    };

    // [팀장] 입찰하기 — 서버 place_bid RPC가 PIN·티어·최고가·예산·10초룰을 최종 검증한다.
    // (클라이언트 검증은 즉각 피드백용일 뿐, 보안 경계는 서버.)
    const placeBid = async (amount: number, pin: string | null): Promise<boolean> => {
        if (!auctionTarget) return false;
        if (!pin) { toast.error('팀장 PIN으로 입장한 뒤 입찰할 수 있습니다.'); return false; }
        if (!auctionRunning) { toast.error('경매가 진행 중일 때만 입찰할 수 있습니다.'); return false; }
        if (isNaN(amount) || amount <= 0) { toast.error('입찰 포인트를 숫자로 입력하세요.'); return false; }
        if (amount <= currentHighestBid) {
            toast.error(`현재 최고가(${currentHighestBid}P)보다 높은 금액을 입력해야 합니다.`);
            return false;
        }

        const { error } = await supabase.rpc('place_bid', {
            p_target_token: auctionTarget.p_token,
            p_amount: amount,
            p_pin: pin,
        });
        if (error) { toast.error(error.message || '입찰에 실패했습니다.'); return false; }
        return true;
    };

    // [진행자] 현재 대상의 입찰 삭제 (재시작 시 최고가 초기화용)
    const clearBidsForTarget = async () => {
        if (!auctionTarget) return;
        await supabase.from('auction_bids').delete().eq('p_token', auctionTarget.p_token);
    };

    // [진행자] 낙찰 취소 (팀 배정 해제 + 해당 참가자 입찰 삭제 → 소모 포인트/최고가 복구)
    const revertWin = async (participant: Participant): Promise<boolean> => {
        if (!participant.team_name) return false;
        if (!(await confirmDialog(
            `${participant.fake_name}의 낙찰을 취소하시겠습니까?\n${participant.team_name} 배정과 소모 포인트가 되돌아갑니다.`
        ))) return false;

        const prevTeam = participant.team_name;
        const { error } = await supabase.from('participants')
            .update({ team_name: null })
            .eq('p_token', participant.p_token);
        if (error) { toast.error('낙찰 취소 실패: ' + error.message); return false; }

        // 해당 참가자 입찰 삭제 → 팀 소모 포인트/최고가 복구
        await supabase.from('auction_bids').delete().eq('p_token', participant.p_token);
        await supabase.from('auction_logs').insert({
            message: `낙찰 취소: ${participant.fake_name} (${prevTeam} 배정 해제)`,
        });
        // 안내는 로그 기반 announce가 모두에게 표시
        return true;
    };

    // [진행자] 경매 중단 (이번 회차 롤백: 낙찰 없이 현재 대상의 입찰 삭제 + 타이머/대상 초기화)
    const stopAuction = async (): Promise<boolean> => {
        if (!auctionTarget) return false;
        if (!(await confirmDialog(`${auctionTarget.fake_name} 경매를 중단하시겠습니까?`))) return false;

        // 1) 먼저 타이머/상태/대상 초기화 (만료 자동낙찰 경합 방지)
        await supabase.from('auction_meta')
            .update({ timer_end_at: null, status: 'idle', current_p_token: null })
            .eq('id', 1);

        // 2) 이번 회차 입찰 되돌리기 (현재 대상의 입찰 삭제)
        await supabase.from('auction_bids').delete().eq('p_token', auctionTarget.p_token);

        await supabase.from('auction_logs').insert({
            message: `${auctionTarget.fake_name} 경매가 중단되었습니다.`,
        });
        return true;
    };

    // [진행자] 경매 전체 초기화 (처음 상태로 되돌림)
    const resetAuction = async (): Promise<boolean> => {
        if (!(await confirmDialog(
            '경매를 처음부터 초기화합니다.\n'
            + '- 모든 입찰 내역 삭제\n'
            + '- 팀 배정 전체 해제\n'
            + '- 타이머 초기화\n'
            + '- 경매 로그 삭제\n\n'
            + '계속하시겠습니까?'
        ))) return false;

        // 1) 입찰 내역 전체 삭제
        const { error: bidErr } = await supabase.from('auction_bids').delete().neq('id', 0);
        if (bidErr) { toast.error('입찰 내역 삭제 실패: ' + bidErr.message); return false; }

        // 2) 팀 배정 해제 — 단, 팀장(is_leader)은 팀을 유지하고 경매로 채운 팀원만 초기화
        const { error: teamErr } = await supabase
            .from('participants')
            .update({ team_name: null })
            .eq('is_leader', false);
        if (teamErr) { toast.error('팀 배정 해제 실패: ' + teamErr.message); return false; }

        // 3) 타이머/상태/경매 대상 초기화
        await supabase.from('auction_meta')
            .update({ timer_end_at: null, status: 'idle', current_p_token: null })
            .eq('id', 1);

        // 4) 로그 전체 삭제 후 초기화 기록
        await supabase.from('auction_logs').delete().neq('id', 0);
        await supabase.from('auction_logs').insert({ message: '경매가 초기화되었습니다.' });

        return true;
    };

    // [진행자] 타이머 종료 시 자동 낙찰
    const autoFinalConfirm = async () => {
        if (!isAdmin || !auctionTarget) return;

        // 해당 참가자의 입찰 내역 중 최고가 팀 찾기
        const { data: bids, error } = await supabase
            .from('auction_bids')
            .select('*')
            .eq('p_token', auctionTarget.p_token)
            .order('bid_amount', { ascending: false });

        if (error || !bids || bids.length === 0) {
            await supabase.from('auction_logs').insert({ message: `유찰: 입찰자가 없습니다.` });
            await clearTarget();
            return;
        }

        const winner = bids[0]; // 가장 높은 입찰

        await supabase.from('participants')
            .update({ team_name: winner.team_name })
            .eq('p_token', auctionTarget.p_token);

        await supabase.from('auction_logs').insert({
            message: `경매 종료! 최종 낙찰: ${auctionTarget.fake_name} → ${winner.team_name} (${winner.bid_amount}P)`,
        });

        // 낙찰 안내는 로그 기반 announce 토스트가 모든 접속자에게 표시함 (중복 방지 위해 여기선 생략)
        await clearTarget();
    };

    return { currentHighestBid, teamPoints, memberPrices, saveParticipant, deleteParticipant, placeBid, clearBidsForTarget, revertWin, stopAuction, resetAuction, autoFinalConfirm };
}
