'use client';
// components/common/hooks/RealtimeProvider.tsx
// ---------------------------------------------------------------------------
// [실시간 데이터 공유] 참가자 목록을 앱 루트에서 한 번만 구독·보관하고 Context로 내려준다.
//
// ★ 왜 Provider로 올렸나: 화면(참가자/추첨/스네이크/결과)마다 각자 구독하면, 페이지를 바꿀 때마다
//   새 화면이 mount되며 데이터가 빈 배열에서 다시 fetch돼 '깜빡임'이 생긴다. 여기서 한 번만
//   구독하면 페이지 전환 시에도 데이터가 유지돼 깜빡임이 없고, 실시간 구독도 1세트라 부하가 준다.
//   (화면들은 useRealtime()으로 이 Context를 읽기만 한다.)
// ---------------------------------------------------------------------------
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { Participant } from '../types';

type RealtimeValue = {
    participants: Participant[];
};

const RealtimeContext = createContext<RealtimeValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
    const [participants, setParticipants] = useState<Participant[]>([]);

    useEffect(() => {
        const fetchParticipants = async () => {
            const { data } = await supabase.from('participants').select('*').order('slot_index', { ascending: true });
            if (data) setParticipants(data);
        };

        fetchParticipants();

        // 대량 변경(익명 재배정 64건·추첨·티어 랜덤 배치 등)이 실시간 이벤트를 폭발시키면 refetch가
        // 폭주해 net::ERR_INSUFFICIENT_RESOURCES가 난다 → 짧게 디바운스해 변경 버스트를 한 번의 refetch로 합친다.
        let refetchTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleRefetch = () => {
            if (refetchTimer) clearTimeout(refetchTimer);
            refetchTimer = setTimeout(fetchParticipants, 250);
        };

        const pSub = supabase.channel('participants_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, scheduleRefetch)
            .subscribe();

        return () => {
            if (refetchTimer) clearTimeout(refetchTimer);
            supabase.removeChannel(pSub);
        };
    }, []);

    return <RealtimeContext.Provider value={{ participants }}>{children}</RealtimeContext.Provider>;
}

// 화면들이 공유 실시간 데이터를 읽는 훅. Provider 밖에서 쓰면 에러.
export function useRealtime(): RealtimeValue {
    const ctx = useContext(RealtimeContext);
    if (!ctx) throw new Error('useRealtime은 RealtimeProvider 안에서만 사용할 수 있습니다.');
    return ctx;
}
