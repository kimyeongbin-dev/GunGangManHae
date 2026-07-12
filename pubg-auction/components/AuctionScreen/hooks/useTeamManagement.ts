// components/AuctionScreen/hooks/useTeamManagement.ts
// ---------------------------------------------------------------------------
// [팀 관리 로직 훅] 참가자 등록/삭제 · 입찰 · 낙찰/유찰 · 팀 포인트 집계.
// AuctionScreen(index.tsx)이 조립해 하위 UI에 값/콜백을 내려준다.
//
// 입력(Options): participants·auctionBids(useRealtimeAuction에서), auctionTarget·auctionRunning
//               (useAuctionTimer에서 파생), isAdmin(page.tsx 세션).
// 반환: 파생 상태(currentHighestBid/teamPoints/memberPrices) + 액션 콜백들.
//
// ★ 보안 경계:
//   · placeBid → place_bid RPC(익명 호출 가능, PIN으로 서버 검증). 이 훅에서 유일하게 "팀장"이 쓰는 경로.
//   · 그 외 액션(등록/삭제/낙찰취소/중단/초기화/자동낙찰)은 테이블 직접 쓰기 → 진행자(authenticated) 세션에서만 RLS 통과.
//   · 실명은 participant_secrets(진행자 전용)에만 저장 — participants에는 절대 넣지 않는다.
// ---------------------------------------------------------------------------
import { useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { toast, confirmDialog } from '@/lib/toast';
import { firstFreeSlotInTier } from '../utils';
import { pickUnusedAnonName } from '../anonNames';
import { IDLE_META, resetAuctionData } from '../auctionData';
import { TEAM_COUNT } from '../types';
import type { Participant, AuctionBid, ModalForm } from '../types';

type Options = {
    participants: Participant[];
    auctionBids: AuctionBid[];
    auctionTarget: Participant | null; // 현재 경매 대상 (없으면 null)
    auctionRunning: boolean;           // 타이머 진행 중 여부
    isAdmin: boolean;                  // 진행자 세션 여부
};

export function useTeamManagement({ participants, auctionBids, auctionTarget, auctionRunning, isAdmin }: Options) {
    // 경매 종료 후 공유 상태를 idle로 정리(대상 해제 + status/timer 초기화).
    // 낙찰/유찰 뒤 status가 running으로 남지 않게 한다. autoFinalConfirm이 사용.
    const clearTarget = () => supabase.from('auction_meta').update(IDLE_META).eq('id', 1);

    // ── 파생 상태 (렌더용 계산값) ────────────────────────────────────────────

    // 현재 대상자의 최고 입찰가. AuctionPanel의 "현재 최고가"와 placeBid 사전검증에 사용.
    const currentHighestBid = useMemo(() => {
        if (!auctionTarget) return 0;
        return auctionBids
            .filter((b) => b.p_token === auctionTarget.p_token)
            .reduce((max, b) => Math.max(max, b.bid_amount), 0);
    }, [auctionBids, auctionTarget]);

    // 팀별 소진 포인트 = "확정 팀원(team_name 보유)"들의 최종 낙찰가 합.
    // 입찰만 하고 낙찰 못 한 금액은 소비되지 않으므로 제외한다. 예산 표시/사전검증에 사용.
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

    // 참가자별 최종 낙찰가 { p_token: 최고 입찰가 }. TeamEntryTable의 "이름(낙찰가)" 표시용.
    const memberPrices = useMemo(() => {
        const prices: Record<string, number> = {};
        auctionBids.forEach((b) => {
            if (b.p_token) prices[b.p_token] = Math.max(prices[b.p_token] ?? 0, b.bid_amount);
        });
        return prices;
    }, [auctionBids]);

    // ── 진행자: 참가자 등록/수정/삭제 ────────────────────────────────────────

    // 참가자 등록(신규) 또는 수정. 호출: ParticipantEditModal의 저장 버튼.
    // 실명(real_name)은 participant_secrets(진행자 전용)에, 나머지는 participants에 나눠 저장한다.
    const saveParticipant = async (form: ModalForm): Promise<boolean> => {
        const { p_token, real_name, tier, avg_damage, intro } = form;
        if (!real_name || !tier || !avg_damage) {
            toast.error('비제이명, 티어, 딜량을 입력하세요.');
            return false;
        }

        // [수정] 티어 변경 시에만 슬롯을 재배치, 실명은 secrets에 upsert.
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
            const patch: Record<string, unknown> = { tier, avg_damage: parseInt(avg_damage), intro, slot_index };
            if (existing?.is_leader) patch.reveal_name = real_name; // 팀장이면 공개명도 실명으로 동기화
            const { error } = await supabase.from('participants').update(patch).eq('p_token', p_token);
            if (error) { toast.error('저장 에러: ' + error.message); return false; }
            const { error: sErr } = await supabase.from('participant_secrets').upsert({ p_token, real_name });
            if (sErr) { toast.error('실명 저장 에러: ' + sErr.message); return false; }
            return true;
        }

        // [신규] 선택 티어의 첫 빈 슬롯에 배치. reveal_name=null(블라인드).
        //        익명(fake_name)은 기존에 쓰인 이름과 겹치지 않게 자동 생성(이후 '익명 만들기'로 일괄 재배정 가능).
        const occupied = new Set(participants.filter((p) => p.slot_index != null).map((p) => p.slot_index as number));
        const free = firstFreeSlotInTier(tier, occupied);
        if (free === -1) { toast.error(`${tier}티어 자리가 가득 찼습니다.`); return false; }

        const usedNames = participants.map((p) => p.fake_name).filter((n): n is string => !!n);
        const fakeName = pickUnusedAnonName(usedNames); // 현재 사용 중인 익명과 중복되지 않는 이름
        const newToken = `p_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const { error } = await supabase.from('participants').insert({
            p_token: newToken, slot_index: free, tier, fake_name: fakeName,
            avg_damage: parseInt(avg_damage), intro, reveal_name: null,
        });
        if (error) { toast.error('저장 에러: ' + error.message); return false; }
        const { error: sErr } = await supabase.from('participant_secrets').insert({ p_token: newToken, real_name });
        if (sErr) { toast.error('실명 저장 에러: ' + sErr.message); return false; }
        return true;
    };

    // 참가자 영구 삭제. 실명(secrets)은 FK on-delete-cascade로 함께 지워진다.
    // 호출: ParticipantEditModal의 삭제 버튼.
    const deleteParticipant = async (p_token: string): Promise<boolean> => {
        if (!p_token) return false;
        if (!(await confirmDialog('해당 참가자 데이터를 영구 삭제하시겠습니까?'))) return false;

        const { error } = await supabase.from('participants').delete().eq('p_token', p_token);
        if (error) { toast.error('삭제 실패: ' + error.message); return false; }
        return true;
    };

    // ── 팀장: 입찰 ───────────────────────────────────────────────────────────

    // 입찰. 서버 place_bid RPC가 PIN·경매상태·티어중복·최고가·예산·10초룰을 최종 검증한다.
    // 여기 클라이언트 검증은 "즉각 피드백"용일 뿐 보안 경계가 아니다(진짜 방어는 서버).
    // 호출: AuctionPanel(팀장 입찰 버튼) → index.tsx가 leaderPin을 주입.
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

    // ── 진행자: 회차/전체 제어 ───────────────────────────────────────────────

    // 현재 대상의 입찰만 삭제(경매 재시작 시 최고가 리셋). 호출: index.handleStartAuction(재시작).
    const clearBidsForTarget = async () => {
        if (!auctionTarget) return;
        await supabase.from('auction_bids').delete().eq('p_token', auctionTarget.p_token);
    };

    // 낙찰/지명 취소: 팀 배정 해제 + 해당 참가자 입찰 삭제 → 소모 포인트/최고가 복구.
    // 호출: ParticipantDetailModal(배정된 참가자의 '낙찰 취소'/'지명 취소' 버튼).
    // 입찰이 없으면 스네이크 지명 → '지명', 있으면 경매 낙찰 → '낙찰'로 문구를 맞춘다.
    const revertWin = async (participant: Participant): Promise<boolean> => {
        if (!participant.team_name) return false;
        const isSnake = !auctionBids.some((b) => b.p_token === participant.p_token);
        const word = isSnake ? '지명' : '낙찰';
        const detail = isSnake ? '배정이 해제됩니다.' : '배정과 소모 포인트가 되돌아갑니다.';
        if (!(await confirmDialog(
            `${participant.fake_name}의 ${word}을 취소하시겠습니까?\n${participant.team_name} ${detail}`
        ))) return false;

        const prevTeam = participant.team_name;
        const { error } = await supabase.from('participants')
            .update({ team_name: null }).eq('p_token', participant.p_token);
        if (error) { toast.error(`${word} 취소 실패: ` + error.message); return false; }

        await supabase.from('auction_bids').delete().eq('p_token', participant.p_token);
        await supabase.from('auction_logs').insert({
            message: `${word} 취소: ${participant.fake_name} (${prevTeam} 배정 해제)`,
        });
        return true; // 안내는 로그 기반 방송 토스트가 모두에게 표시
    };

    // 경매 중단(이번 회차 롤백): 낙찰 없이 현재 대상의 입찰 삭제 + 타이머/대상 초기화.
    // 호출: AuctionPanel(진행 중일 때의 '경매 중단' 버튼).
    const stopAuction = async (): Promise<boolean> => {
        if (!auctionTarget) return false;
        if (!(await confirmDialog(`${auctionTarget.fake_name} 경매를 중단하시겠습니까?`))) return false;

        // 순서 주의: 먼저 idle로 만들어 만료 자동낙찰과의 경합을 막고, 그 뒤 입찰을 지운다.
        await supabase.from('auction_meta').update(IDLE_META).eq('id', 1);
        await supabase.from('auction_bids').delete().eq('p_token', auctionTarget.p_token);
        await supabase.from('auction_logs').insert({ message: `${auctionTarget.fake_name} 경매가 중단되었습니다.` });
        return true;
    };

    // 경매 전체 초기화(팀장은 유지, 경매로 채운 팀원만 해제). 호출: TeamEntryTable('경매 전체 초기화' 버튼).
    const resetAuction = async (): Promise<boolean> => {
        if (!(await confirmDialog(
            '경매를 처음부터 초기화합니다.\n'
            + '- 모든 입찰 내역 삭제\n'
            + '- 팀 배정 전체 해제\n'
            + '- 타이머 초기화\n'
            + '- 경매 로그 삭제\n\n'
            + '계속하시겠습니까?'
        ))) return false;

        const err = await resetAuctionData({ keepLeaders: true }); // 팀장/PIN은 유지
        if (err) { toast.error('경매 초기화 실패: ' + err.message); return false; }
        await supabase.from('auction_logs').insert({ message: '경매가 초기화되었습니다.' });
        return true;
    };

    // 타이머 종료 시 자동 낙찰/유찰. 진행자 브라우저에서만 실행된다(승자 판정 주체).
    // 호출: useAuctionTimer의 만료 콜백 → index.tsx의 onExpireRef → 이 함수.
    const autoFinalConfirm = async () => {
        if (!isAdmin || !auctionTarget) return;

        // 현재 대상의 입찰을 높은 순으로 조회 → 최고가 팀이 낙찰.
        const { data: bids, error } = await supabase
            .from('auction_bids').select('*')
            .eq('p_token', auctionTarget.p_token)
            .order('bid_amount', { ascending: false });

        // 입찰이 없으면 유찰 처리 후 대상 해제.
        if (error || !bids || bids.length === 0) {
            await supabase.from('auction_logs').insert({ message: '유찰: 입찰자가 없습니다.' });
            await clearTarget();
            return;
        }

        const winner = bids[0]; // 최고 입찰
        await supabase.from('participants')
            .update({ team_name: winner.team_name }).eq('p_token', auctionTarget.p_token);
        await supabase.from('auction_logs').insert({
            message: `경매 종료! 최종 낙찰: ${auctionTarget.fake_name} → ${winner.team_name} (${winner.bid_amount}P)`,
        });
        await clearTarget(); // 낙찰 안내는 로그 기반 방송 토스트가 표시(중복 방지 위해 별도 토스트 생략)
    };

    return {
        currentHighestBid, teamPoints, memberPrices,
        saveParticipant, deleteParticipant, placeBid,
        clearBidsForTarget, revertWin, stopAuction, resetAuction, autoFinalConfirm,
    };
}
