// components/AuctionScreen/hooks/useRealtimeAuction.ts
// [실시간 경매 로직] 참가자 / 입찰 / 로그 데이터의 초기 로드 및 Realtime 구독
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { toast, confirmDialog } from '@/lib/toast';
import type { Participant, AuctionBid, Log } from '../types';

export function useRealtimeAuction() {
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [auctionBids, setAuctionBids] = useState<AuctionBid[]>([]);
    const [logs, setLogs] = useState<Log[]>([]);

    useEffect(() => {
        const fetchInitialData = async () => {
            const [pRes, bRes, lRes] = await Promise.all([
                supabase.from('participants').select('*').order('slot_index', { ascending: true }),
                supabase.from('auction_bids').select('*'),
                supabase.from('auction_logs').select('*').order('id', { ascending: false }).limit(30),
            ]);
            if (pRes.data) setParticipants(pRes.data);
            if (bRes.data) setAuctionBids(bRes.data);
            if (lRes.data) setLogs(lRes.data);
        };

        fetchInitialData();

        // 대량 변경(익명 재배정 64건·추첨 등)이 실시간 이벤트를 폭발시키면 refetch가 폭주해
        // net::ERR_INSUFFICIENT_RESOURCES가 난다 → 짧게 디바운스해 변경 버스트를 한 번의 refetch로 합친다.
        let refetchTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleRefetch = () => {
            if (refetchTimer) clearTimeout(refetchTimer);
            refetchTimer = setTimeout(fetchInitialData, 250);
        };

        // 1. 참가자 데이터 구독
        const pSub = supabase.channel('participants_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, scheduleRefetch)
            .subscribe();

        // 2. 입찰 데이터 구독 (입찰 추가 + 전체 초기화 삭제 모두 반영)
        const bSub = supabase.channel('bids_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_bids' }, scheduleRefetch)
            .subscribe();

        // 3. 로그 데이터 구독 (신규 로그는 상단 추가, 전체 삭제는 비움)
        const lSub = supabase.channel('logs_changes')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'auction_logs' }, (payload) => {
                const newLog = payload.new as Log;
                // 경합/지연 도착에도 항상 중복 제거 + 최신(id 큰 순) 정렬 유지
                setLogs((prev) => {
                    if (prev.some((l) => l.id === newLog.id)) return prev;
                    return [newLog, ...prev].sort((a, b) => b.id - a.id).slice(0, 30);
                });
                // 모든 경매 로그는 진행자·참가자 모두에게 같은 큰 알림으로 표시(+방송 화면). toast 자체 중복제거로 재도착 안전.
                toast.announce(newLog.message);
            })
            .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'auction_logs' }, () => {
                setLogs([]);
            })
            .subscribe();

        return () => {
            if (refetchTimer) clearTimeout(refetchTimer);
            supabase.removeChannel(pSub);
            supabase.removeChannel(bSub);
            supabase.removeChannel(lSub);
        };
    }, []);

    // [기능] 로그 전체 삭제 (DB에서 실제 삭제 → 새로고침해도 유지, 실시간 반영)
    const clearLogs = async () => {
        if (!(await confirmDialog('정말로 모든 로그를 삭제하시겠습니까?'))) return;
        const { error } = await supabase.from('auction_logs').delete().neq('id', 0);
        if (error) {
            toast.error('로그 삭제 실패: ' + error.message);
            return;
        }
        setLogs([]);
    };

    return { participants, auctionBids, logs, clearLogs };
}
