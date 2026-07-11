// components/AuctionScreen/ui/ParticipantEditModal.tsx
// [렌더링] 진행자 전용 참가자 등록/수정/삭제 모달 (익명은 '익명 만들기'로 자동 생성)
import { useState } from 'react';
import styles from '../style.module.css';
import fonts from '../../typography.module.css';
import type { ModalForm } from '../types';

type Props = {
    initialForm: ModalForm;
    masked: boolean; // 진행자가 '익명 보는 중'이면 true → 비제이명(실명)을 가려서 시작
    onSave: (form: ModalForm) => Promise<boolean>;
    onDelete: (p_token: string) => Promise<boolean>;
    onClose: () => void;
};

export default function ParticipantEditModal({ initialForm, masked, onSave, onDelete, onClose }: Props) {
    const [form, setForm] = useState<ModalForm>(initialForm);
    // 실명 표시 여부: 익명 모드(masked)면 기본 가림, 아니면 항상 표시.
    // 값 자체는 그대로 두고 화면 표시만 password로 가리므로 저장 시 이름이 지워지지 않는다.
    const [showName, setShowName] = useState(!masked);

    const handleSave = async () => {
        const ok = await onSave(form);
        if (ok) onClose();
    };

    const handleDelete = async () => {
        const ok = await onDelete(form.p_token);
        if (ok) onClose();
    };

    return (
        <div className={styles.modal} onClick={onClose}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                <h3>{form.p_token ? '참가자 수정' : '참가자 등록'}</h3>
                {/* 비밀번호 타입 입력(비제이명 마스킹)이 form 밖에 있으면 크롬이 경고 → form으로 감싼다. */}
                <form onSubmit={(e) => e.preventDefault()}>
                <div className={styles.formGroup}>
                    <label className={`${fonts.formLabel} ${styles.editLabel}`}>비제이명</label>
                    <div className={styles.nameFieldRow}>
                        <input
                            type={showName ? 'text' : 'password'}
                            autoComplete="off"
                            placeholder="예: 홍길동"
                            className={`${styles.formInput} ${styles.nameInput}`}
                            value={form.real_name}
                            onChange={(e) => setForm({ ...form, real_name: e.target.value })}
                        />
                        {masked && (
                            <button type="button" className={styles.revealBtn} onClick={() => setShowName((v) => !v)}>
                                {showName ? '가리기' : '보기'}
                            </button>
                        )}
                    </div>
                </div>
                <div className={styles.formGroup}>
                    <label className={`${fonts.formLabel} ${styles.editLabel}`}>티어</label>
                    <select className={styles.formSelect} value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}>
                        {Array.from({ length: 4 }).map((_, i) => (
                            <option key={i} value={`${i + 1}`}>{i + 1}티어</option>
                        ))}
                    </select>
                </div>
                <div className={styles.formGroup}>
                    <label className={`${fonts.formLabel} ${styles.editLabel}`}>평균 딜량</label>
                    <input type="number" placeholder="예: 250" className={styles.formInput} value={form.avg_damage} onChange={(e) => setForm({ ...form, avg_damage: e.target.value })} />
                </div>
                <div className={styles.formGroup}>
                    <label className={`${fonts.formLabel} ${styles.editLabel}`}>소갯말</label>
                    <textarea
                        rows={4}
                        placeholder="소갯말을 입력하세요 (여러 줄 가능)"
                        className={styles.formTextarea}
                        value={form.intro}
                        onChange={(e) => setForm({ ...form, intro: e.target.value })}
                    />
                </div>
                </form>

                <div className={styles.modalButtons}>
                    <button onClick={handleSave} className={styles.saveBtn}>저장</button>
                    {form.p_token && <button onClick={handleDelete} className={styles.deleteBtn}>삭제</button>}
                    <button onClick={onClose} className={styles.cancelBtn}>취소</button>
                </div>
            </div>
        </div>
    );
}
