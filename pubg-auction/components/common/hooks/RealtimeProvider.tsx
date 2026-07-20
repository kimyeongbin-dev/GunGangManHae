'use client';
// components/common/hooks/RealtimeProvider.tsx
// ---------------------------------------------------------------------------
// [실시간 데이터 공유] 참가자 목록을 앱 루트에서 한 번만 구독·보관하고 Context로 내려준다.
//
// ★ 왜 Provider로 올렸나: 화면(참가자/추첨/스네이크/결과)마다 각자 구독하면, 페이지를 바꿀 때마다
//   새 화면이 mount되며 데이터가 빈 배열에서 다시 fetch돼 '깜빡임'이 생긴다. 여기서 한 번만
//   구독하면 페이지 전환 시에도 데이터가 유지돼 깜빡임이 없고, 실시간 구독도 1세트라 부하가 준다.
//
// ★ 참가자 행을 실시간으로 받지 않는다: participants 는 publication 에서 빠졌고(0008),
//   page_state 한 행이 '변경 신호' 역할만 한다(트리거가 updated_at 을 올림).
//   신호를 받으면 공개 뷰에서 REST 로 다시 읽는다.
//   이렇게 하는 이유 — 토큰 회전은 PK 를 바꾸는 UPDATE 라, 행 데이터를 실시간으로 흘리면
//   페이로드의 old 에 구 토큰이 실려 '구→신' 연결이 익명에게 그대로 노출된다(회전이 무의미해짐).
//   REST 응답에는 구/신 쌍이 없다.
//
// ★ 끊김 복구: postgres_changes 는 끊긴 동안의 이벤트를 재전송하지 않는다. 예전에는 최초 1회
//   fetch 후 오직 수신 이벤트로만 갱신해서, 관전자가 잠깐 오프라인이 되면 그 사이의 지명을
//   영구히 놓친 채 멈춰 있었다. 그래서 (a) 채널이 SUBSCRIBED 될 때마다(=재연결 포함),
//   (b) 탭이 다시 보일 때, (c) 네트워크가 돌아올 때 각각 refetch 한다.
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
        let alive = true;

        const fetchParticipants = async () => {
            // 공개 뷰에서 읽는다. 팀장(및 결과공개 중 전원)의 딜량·소갯말은 null 로 내려온다(0008/0010).
            const { data, error } = await supabase
                .from('participants_public')
                .select('*')
                .order('slot_index', { ascending: true });
            // ★ 에러를 삼키지 않는다: 뷰 미생성/권한 문제를 콘솔로 드러내 배포 사고를 빨리 잡는다.
            //   실패 시 기존 데이터를 유지한다(빈 배열로 덮어써 화면을 날리지 않음).
            if (error) { console.error('[참가자 조회] 실패:', error.message); return; }
            if (alive && data) setParticipants(data);
        };

        // 대량 변경(익명 재배정 64건·추첨·티어 랜덤 배치 등)이 실시간 이벤트를 폭발시키면 refetch가
        // 폭주해 net::ERR_INSUFFICIENT_RESOURCES가 난다 → 짧게 디바운스해 변경 버스트를 한 번의 refetch로 합친다.
        let refetchTimer: ReturnType<typeof setTimeout> | null = null;
        const scheduleRefetch = () => {
            if (refetchTimer) clearTimeout(refetchTimer);
            refetchTimer = setTimeout(fetchParticipants, 250);
        };

        // ★ 최초 1회는 소켓 연결과 무관하게 즉시 읽는다. 예전에는 최초 fetch가 SUBSCRIBED 콜백
        //   안에만 있어, WebSocket 이 막힌 망이나 realtime 한도 초과면 참가자 목록이 영구히 비었다.
        fetchParticipants();

        // page_state 는 신호일 뿐 참가자 데이터를 담지 않는다 → 여기로는 아무것도 새지 않는다.
        const pSub = supabase.channel('participants_signal')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'page_state' }, scheduleRefetch)
            // 재연결 후 재구독도 여기로 온다 → 끊긴 구간을 즉시 따라잡는다.
            .subscribe((status) => { if (status === 'SUBSCRIBED') scheduleRefetch(); });

        // 탭 복귀 / 네트워크 복구: 소켓이 살아 있어도 이벤트를 놓쳤을 수 있으므로 한 번 맞춘다.
        const onVisible = () => { if (document.visibilityState === 'visible') scheduleRefetch(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', scheduleRefetch);

        return () => {
            alive = false;
            if (refetchTimer) clearTimeout(refetchTimer);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', scheduleRefetch);
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
