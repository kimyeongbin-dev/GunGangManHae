'use client';
// components/Toaster.tsx
// toast 스토어를 구독해 토스트 알림 + 확인 모달을 렌더한다. 앱 루트에 한 번만 마운트.
import { useSyncExternalStore } from 'react';
import { subscribe, getState, dismissToast, resolveConfirm, type ToastKind } from '@/lib/toast';
import fonts from './typography.module.css';
import styles from './Toaster.module.css';

const KIND_CLASS: Record<ToastKind, string> = {
    info: styles.toastInfo,
    success: styles.toastSuccess,
    error: styles.toastError,
    announce: styles.toastAnnounce,
};

export default function Toaster() {
    const state = useSyncExternalStore(subscribe, getState, getState);
    const confirm = state.confirms[0]; // 한 번에 하나씩 표시

    return (
        <>
            {/* 토스트 스택 (화면 중앙) */}
            <div className={styles.stack}>
                {state.toasts.map((t) => (
                    <div
                        key={t.id}
                        onClick={() => dismissToast(t.id)}
                        className={`${styles.toast} ${KIND_CLASS[t.kind]} ${t.kind === 'announce' ? fonts.toastAnnounce : fonts.toastText}`}
                    >
                        {t.message}
                    </div>
                ))}
            </div>

            {/* 확인 모달 */}
            {confirm && (
                <div className={styles.overlay} onClick={() => resolveConfirm(confirm.id, false)}>
                    <div className={styles.box} onClick={(e) => e.stopPropagation()}>
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
