// lib/toast.ts
// 어디서든(훅/유틸 포함) 호출 가능한 토스트 + 확인창 싱글턴 스토어.
// <Toaster/>가 이 스토어를 구독해 실제 UI를 렌더한다.

export type ToastKind = 'info' | 'success' | 'error' | 'announce';
export type ToastItem = { id: number; kind: ToastKind; message: string };
export type ConfirmItem = { id: number; message: string; resolve: (ok: boolean) => void };

type State = { toasts: ToastItem[]; confirms: ConfirmItem[] };

let state: State = { toasts: [], confirms: [] };
const listeners = new Set<() => void>();
let nextId = 1;

const emit = () => { listeners.forEach((l) => l()); };

export function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function getState(): State {
    return state;
}

export const DEFAULT_TOAST_DURATION = 1500; // ms (기본 표시 시간)

const timers = new Map<number, ReturnType<typeof setTimeout>>();

function armTimer(id: number, duration: number) {
    const prev = timers.get(id);
    if (prev) clearTimeout(prev);
    timers.set(id, setTimeout(() => dismissToast(id), duration));
}

// duration: ms. 0 이하이면 자동으로 사라지지 않고 클릭해야 닫힘.
// 정책: 토스트는 "최신 하나만" 표시한다(나열하지 않고 교체). 새 토스트가 오면 기존 것을 대체.
function pushToast(kind: ToastKind, message: string, duration = DEFAULT_TOAST_DURATION) {
    // 지금 떠 있는 것과 완전히 같은 토스트면(종류+메시지) 다시 만들지 않고 표시 시간만 연장
    const current = state.toasts[0];
    if (current && current.kind === kind && current.message === message) {
        if (duration > 0) armTimer(current.id, duration);
        return;
    }

    // 그 외에는 기존 토스트(들)를 치우고 새 것으로 교체 → 화면엔 항상 하나만
    state.toasts.forEach((t) => {
        const tm = timers.get(t.id);
        if (tm) { clearTimeout(tm); timers.delete(t.id); }
    });

    const id = nextId++;
    state = { ...state, toasts: [{ id, kind, message }] };
    emit();
    if (duration > 0) armTimer(id, duration);
}

export function dismissToast(id: number) {
    const t = timers.get(id);
    if (t) { clearTimeout(t); timers.delete(id); }
    state = { ...state, toasts: state.toasts.filter((t) => t.id !== id) };
    emit();
}

export const toast = {
    info: (message: string, duration?: number) => pushToast('info', message, duration),
    success: (message: string, duration?: number) => pushToast('success', message, duration),
    error: (message: string, duration?: number) => pushToast('error', message, duration),
    // 방송 연출용 큰 알림 (경매 시작/입찰/낙찰 등) — 조금 더 오래 표시
    announce: (message: string, duration?: number) => pushToast('announce', message, duration ?? 2500),
};

// confirm() 대체: 확인/취소 결과를 Promise<boolean>로 반환
export function confirmDialog(message: string): Promise<boolean> {
    return new Promise((resolve) => {
        const id = nextId++;
        state = { ...state, confirms: [...state.confirms, { id, message, resolve }] };
        emit();
    });
}

export function resolveConfirm(id: number, ok: boolean) {
    const item = state.confirms.find((c) => c.id === id);
    state = { ...state, confirms: state.confirms.filter((c) => c.id !== id) };
    emit();
    item?.resolve(ok);
}
