// components/common/actionLock.ts
// ---------------------------------------------------------------------------
// 판을 바꾸는 모든 조작이 공유하는 단일 잠금.
//
// ★ 왜 전역 하나인가: 예전에는 '익명 만들기'만 자기 모듈 안에서 잠갔고 추첨·랜덤배치·리롤·지명은
//   서로의 진행 여부를 몰랐다. 헤더의 600ms 쓰로틀도 '같은 버튼'만 막는다. 그래서
//   "1티어 추첨"이 도는 중에 "2티어 추첨"을 누르면 두 시퀀스가 겹쳐 토큰이 두 번 회전하고,
//   먼저 시작한 쪽이 들고 있던 p_token 이 전부 무효가 되어 팀장이 일부만 배정된 채
//   '성공'으로 끝났다. 판 전체를 건드리는 작업은 한 번에 하나만 돌아야 한다.
//
// UI 는 useActionBusy() 로 진행 상태를 구독해 버튼을 비활성화/표시할 수 있다.
// ---------------------------------------------------------------------------
import { useSyncExternalStore } from 'react';
import { toast } from '@/lib/toast';

let busy = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function setBusy(v: boolean) {
    busy = v;
    notify();
}

// 지금 판을 바꾸는 작업이 돌고 있는가(비-React 코드용 동기 조회).
export function isActionBusy(): boolean {
    return busy;
}

// React 컴포넌트용: 진행 상태를 구독한다(버튼 비활성화·스피너에 사용).
export function useActionBusy(): boolean {
    return useSyncExternalStore(
        (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
        () => busy,
        () => false,
    );
}

// fn 을 배타적으로 실행한다. 이미 다른 작업이 돌고 있으면 실행하지 않고 null 을 돌려준다.
// 알림은 기본으로 띄운다(진행자가 왜 안 눌리는지 알 수 있게). silent=true 면 조용히 건너뛴다.
export async function runExclusive<T>(fn: () => Promise<T>, silent = false): Promise<T | null> {
    if (busy) {
        if (!silent) toast.info('이전 작업이 아직 진행 중입니다. 잠시만 기다려 주세요.');
        return null;
    }
    setBusy(true);
    try {
        return await fn();
    } finally {
        setBusy(false);
    }
}
