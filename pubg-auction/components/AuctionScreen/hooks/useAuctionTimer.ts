// components/AuctionScreen/hooks/useAuctionTimer.ts
// [타이머 로직] auction_meta(단일 행)을 구독해 경매 세션을 모든 클라이언트에 공유한다.
//  - timer_end_at: 절대 종료 시각 → 남은 시간을 매 tick 재계산 (탭이 멈춰도 실제 시각과 일치)
//  - current_p_token: 현재 경매 대상 → 진행자·참가자 화면이 같은 대상을 보게 함
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { serverNow, syncServerTime } from '@/lib/serverTime';
import { AUCTION_DURATION_SEC } from '../types';
import type { Participant } from '../types';

type Options = {
    isAdmin: boolean;
    onExpire: () => void; // 시간 종료 시 실행 (진행자 자동 낙찰 등)
};

// auction_meta 테이블 행 (경매 세션 공유용)
type AuctionMeta = {
    id: number;
    timer_end_at: string | null;
    status: string;
    current_p_token: string | null;
};

export function useAuctionTimer({ isAdmin, onExpire }: Options) {
    // 서버가 보유한 절대 종료 시각(epoch ms). 남은 시간은 항상 이 값에서 파생한다.
    const [endAt, setEndAt] = useState<number | null>(null);
    const [timeLeft, setTimeLeft] = useState(0);
    // 현재 경매 대상 p_token (모든 클라이언트 공유)
    const [currentPToken, setCurrentPToken] = useState<string | null>(null);
    const expiredRef = useRef(false);

    // 서버 시계와 오프셋 동기화 (마운트 시 + 탭이 다시 활성화될 때 재동기화)
    useEffect(() => {
        syncServerTime();
        const onVisible = () => {
            if (document.visibilityState === 'visible') syncServerTime();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, []);

    // auction_meta(종료 시각 + 현재 대상)를 초기 로드 + 실시간 구독으로 반영
    useEffect(() => {
        const applyMeta = (meta: Partial<AuctionMeta>) => {
            setEndAt(meta.timer_end_at ? new Date(meta.timer_end_at).getTime() : null);
            setCurrentPToken(meta.current_p_token ?? null);
        };

        // 초기 1회 fetch: 경매 진행 중 뒤늦게 접속한 클라이언트도 동기화
        (async () => {
            const { data } = await supabase
                .from('auction_meta')
                .select('timer_end_at, current_p_token')
                .eq('id', 1)
                .maybeSingle();
            if (data) applyMeta(data);
        })();

        const channel = supabase.channel('auction_meta')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'auction_meta' }, (payload) => {
                applyMeta(payload.new as Partial<AuctionMeta>);
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, []);

    // 남은 시간을 절대 종료 시각 기준으로 매 tick 재계산.
    // (계산은 tick 함수 안에서만 — 렌더 중 시계 호출/직접 setState를 피한다)
    useEffect(() => {
        expiredRef.current = false;
        let id: ReturnType<typeof setInterval> | undefined;

        const tick = () => {
            if (endAt === null) { setTimeLeft(0); return; }
            const msLeft = endAt - serverNow();
            setTimeLeft(Math.max(0, Math.ceil(msLeft / 1000)));
            if (msLeft <= 0) {
                if (!expiredRef.current) {
                    expiredRef.current = true;
                    // 시간이 다 되었을 때, 진행자인 경우에만 종료 콜백 실행
                    if (isAdmin) onExpire();
                }
                if (id) clearInterval(id); // 만료 후 정지
            }
        };

        tick(); // 즉시 1회 반영
        if (endAt !== null) id = setInterval(tick, 500);
        return () => { if (id) clearInterval(id); };
    }, [endAt, isAdmin, onExpire]);

    // [진행자] 경매 대상 지정 (모든 클라이언트에 공유). 지정 시 타이머는 아직 시작 안 함.
    const setTargetToken = async (pToken: string | null) => {
        await supabase.from('auction_meta').upsert({
            id: 1,
            current_p_token: pToken,
        });
    };

    // [진행자] 경매 시작 (60초). 이 업데이트가 모든 참가자의 타이머를 시작시킴
    // 종료 시각도 서버 정렬 시각(serverNow) 기준으로 만들어 진행자 시계 오차가 새지 않게 한다.
    const startAuction = async (target: Participant, restart = false) => {
        const duration = AUCTION_DURATION_SEC; // 초 단위 (types.ts에서 조정)
        const endTime = new Date(serverNow() + duration * 1000);

        await supabase.from('auction_meta').upsert({
            id: 1,
            timer_end_at: endTime.toISOString(),
            status: 'running',
            current_p_token: target.p_token,
        });

        await supabase.from('auction_logs').insert({
            message: `${target.fake_name} 경매 ${restart ? '재시작' : '시작'}! (${duration}초)`,
        });
    };

    // (10초 룰 연장은 서버 place_bid RPC가 처리 → 클라이언트에서 auction_meta를 직접 쓰지 않음)

    return { timeLeft, currentPToken, setTargetToken, startAuction };
}
