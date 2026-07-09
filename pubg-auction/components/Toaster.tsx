'use client';
// components/Toaster.tsx
// toast 스토어를 구독해 토스트 알림 + 확인 모달을 렌더한다. 앱 루트에 한 번만 마운트.
import { useSyncExternalStore } from 'react';
import { subscribe, getState, dismissToast, resolveConfirm, type ToastKind } from '@/lib/toast';

const KIND_COLOR: Record<ToastKind, string> = {
    info: '#2196f3',
    success: '#4caf50',
    error: '#f44336',
};

export default function Toaster() {
    const state = useSyncExternalStore(subscribe, getState, getState);
    const confirm = state.confirms[0]; // 한 번에 하나씩 표시

    return (
        <>
            {/* 토스트 스택 (화면 중앙) */}
            <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, zIndex: 10000, maxWidth: 'min(460px, 90vw)', pointerEvents: 'none' }}>
                {state.toasts.map((t) => (
                    <div
                        key={t.id}
                        onClick={() => dismissToast(t.id)}
                        style={{
                            background: '#1e1e1e',
                            color: '#fff',
                            border: `2px solid ${KIND_COLOR[t.kind]}`,
                            borderRadius: 10,
                            padding: '16px 28px',
                            fontSize: 16,
                            fontWeight: 600,
                            lineHeight: 1.5,
                            textAlign: 'center',
                            minWidth: 220,
                            boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
                            cursor: 'pointer',
                            whiteSpace: 'pre-line',
                            pointerEvents: 'auto',
                        }}
                    >
                        {t.message}
                    </div>
                ))}
            </div>

            {/* 확인 모달 */}
            {confirm && (
                <div
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001, padding: 16 }}
                    onClick={() => resolveConfirm(confirm.id, false)}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{ background: '#232323', color: '#eee', border: '1px solid #444', borderRadius: 10, padding: 24, width: 'min(400px, 100%)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                    >
                        <p style={{ margin: '0 0 20px 0', fontSize: 15, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{confirm.message}</p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                            <button
                                onClick={() => resolveConfirm(confirm.id, false)}
                                style={{ background: '#555', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 14, cursor: 'pointer' }}
                            >
                                취소
                            </button>
                            <button
                                onClick={() => resolveConfirm(confirm.id, true)}
                                style={{ background: '#ff9800', color: '#fff', border: 'none', borderRadius: 6, padding: '9px 18px', fontSize: 14, fontWeight: 'bold', cursor: 'pointer' }}
                            >
                                확인
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
