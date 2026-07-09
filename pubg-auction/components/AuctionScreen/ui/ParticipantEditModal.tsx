// components/AuctionScreen/ui/ParticipantEditModal.tsx
// [렌더링] 진행자 전용 참가자 등록/수정/삭제 모달 (익명은 '익명 만들기'로 자동 생성)
import { useState } from 'react';
import styles from '../style.module.css';
import fonts from '../../typography.module.css';
import type { ModalForm } from '../types';

type Props = {
    initialForm: ModalForm;
    onSave: (form: ModalForm) => Promise<boolean>;
    onDelete: (p_token: string) => Promise<boolean>;
    onClose: () => void;
};

export default function ParticipantEditModal({ initialForm, onSave, onDelete, onClose }: Props) {
    const [form, setForm] = useState<ModalForm>(initialForm);

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
                <div className={styles.formGroup}>
                    <label className={`${fonts.formLabel} ${styles.editLabel}`}>비제이명</label>
                    <input type="text" placeholder="예: 홍길동" className={styles.formInput} value={form.real_name} onChange={(e) => setForm({ ...form, real_name: e.target.value })} />
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
                    <input type="text" placeholder="한 줄 소갯말을 입력하세요" className={styles.formInput} value={form.intro} onChange={(e) => setForm({ ...form, intro: e.target.value })} />
                </div>

                <div className={styles.modalButtons}>
                    <button onClick={handleSave} className={styles.saveBtn}>저장</button>
                    {form.p_token && <button onClick={handleDelete} className={styles.deleteBtn}>삭제</button>}
                    <button onClick={onClose} className={styles.cancelBtn}>취소</button>
                </div>
            </div>
        </div>
    );
}
