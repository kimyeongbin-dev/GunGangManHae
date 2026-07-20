'use client';
// components/Toaster.tsx
// toast 스토어를 구독해 토스트 알림 + 확인 모달을 렌더한다. 앱 루트에 한 번만 마운트.
import { useEffect, useSyncExternalStore } from 'react';
import { subscribe, getState, dismissToast, resolveConfirm, type ToastKind } from '@/lib/toast';
import fonts from './typography.module.css';
import styles from './Toaster.module.css';

const KIND_CLASS: Record<ToastKind, string> = {
    info: styles.toastInfo,
    success: styles.toastSuccess,
    error: styles.toastError,
};

export default function Toaster() {
    const state = useSyncExternalStore(subscribe, getState, getState);
    const confirm = state.confirms[0]; // 한 번에 하나씩 표시

    // 확인 모달이 떠 있는 동안 Enter=확인 / Esc=취소.
    // 캡처 단계에서 먼저 처리하고 전파를 막아, 뒤에 있는 화면의 키 핸들러(상세/편집 모달)가
    // 같은 키를 함께 처리하지 않도록 한다.
    useEffect(() => {
        if (!confirm) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                resolveConfirm(confirm.id, true);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                resolveConfirm(confirm.id, false);
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [confirm]);

    return (
        <>
            {/* 토스트 스택 (화면 중앙).
                이 앱의 실패 안내는 전부 토스트라, 스크린리더에도 전달되도록 live region 으로 둔다. */}
            <div className={styles.stack} role="status" aria-live="polite" aria-atomic="true">
                {state.toasts.map((t) => (
                    <div
                        key={t.id}
                        onClick={() => dismissToast(t.id)}
                        className={`${styles.toast} ${KIND_CLASS[t.kind]} ${fonts.toastText}`}
                    >
                        {t.message}
                    </div>
                ))}
            </div>

            {/* 확인 모달 */}
            {confirm && (
                <div className={styles.overlay} onClick={() => resolveConfirm(confirm.id, false)}>
                    <div
                        className={styles.box}
                        onClick={(e) => e.stopPropagation()}
                        role="alertdialog"
                        aria-modal="true"
                        aria-label="확인"
                    >
                        <p className={`${fonts.confirmText} ${styles.msg}`}>{confirm.message}</p>
                        <div className={styles.btnRow}>
                            <button onClick={() => resolveConfirm(confirm.id, false)} className={`${fonts.confirmBtn} ${styles.cancelBtn}`}>
                                취소
                            </button>
                            <button onClick={() => resolveConfirm(confirm.id, true)} className={`${fonts.confirmBtn} ${styles.okBtn}`}>
                                확인
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
