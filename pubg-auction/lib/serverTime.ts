// lib/serverTime.ts
// 서버 시계(Postgres now())에 클라이언트를 정렬해 기기 시계 오차(clock skew)를 보정한다.
// serverNow() = Date.now() + offset. 타이머 계산은 항상 이 값을 기준으로 한다.
import { supabase } from './supabaseClient';

let offset = 0; // serverNow - clientNow (ms)

// 서버 기준 현재 시각(epoch ms). 동기화 전에는 offset=0 이라 로컬 시계와 동일.
export function serverNow(): number {
    return Date.now() + offset;
}

// 서버 시간을 1회 받아와 왕복 지연을 보정한 오프셋을 계산한다.
export async function syncServerTime(): Promise<void> {
    try {
        const t0 = Date.now();
        const { data, error } = await supabase.rpc('server_now');
        const t1 = Date.now();
        if (error || !data) return;

        const serverMs = new Date(data as string).getTime();
        if (Number.isNaN(serverMs)) return;

        // 요청 왕복(rtt)의 절반 지점에 서버가 응답했다고 가정하고 보정
        offset = serverMs - (t0 + (t1 - t0) / 2);
    } catch {
        // 실패 시 기존 offset 유지 (최악의 경우 로컬 시계 사용 → 기존 동작과 동일)
    }
}
