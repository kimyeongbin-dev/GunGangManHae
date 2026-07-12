'use client';
// components/AuctionScreen/hooks/RealtimeAuctionProvider.tsx
// ---------------------------------------------------------------------------
// [실시간 데이터 공유] 참가자/입찰/로그를 앱 루트에서 한 번만 구독·보관하고 Context로 내려준다.
//
// ★ 왜 Provider로 올렸나: 화면(참가자/추첨/경매/스네이크/결과)마다 각자 useRealtimeAuction()을
//   호출하면, 페이지를 바꿀 때마다 새 화면이 mount되며 데이터가 빈 배열에서 다시 fetch돼 '깜빡임'이
//   생긴다. 여기서 한 번만 구독하면 페이지 전환 시에도 데이터가 유지돼 깜빡임이 없고, 실시간 구독도
//   1세트라 부하가 준다. (화면들은 useRealtimeAuction()으로 이 Context를 읽기만 한다.)
// ---------------------------------------------------------------------------
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { toast, confirmDialog } from '@/lib/toast';
import type { Participant, AuctionBid, Log } from '../types';

type RealtimeAuctionValue = {
    participants: Participant[];
    auctionBids: AuctionBid[];
    logs: Log[];
    clearLogs: () => Promise<void>;
};

const RealtimeAuctionContext = createContext<RealtimeAuctionValue | null>(null);

export function RealtimeAuctionProvider({ children }: { children: ReactNode }) {
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

    return (
        <RealtimeAuctionContext.Provider value={{ participants, auctionBids, logs, clearLogs }}>
            {children}
        </RealtimeAuctionContext.Provider>
    );
}

// 화면들이 공유 실시간 데이터를 읽는 훅. Provider 밖에서 쓰면 에러.
export function useRealtimeAuction(): RealtimeAuctionValue {
    const ctx = useContext(RealtimeAuctionContext);
    if (!ctx) throw new Error('useRealtimeAuction은 RealtimeAuctionProvider 안에서만 사용할 수 있습니다.');
    return ctx;
}
