// components/AuctionScreen/ui/ParticipantEditModal.tsx
// [렌더링] 진행자 전용 참가자 등록/수정/삭제 모달
import { useState } from 'react';
import styles from '../style.module.css';
import type { ModalForm } from '../types';

type Props = {
    slotIndex: number;
    initialForm: ModalForm;
    onSave: (form: ModalForm, slotIndex: number) => Promise<boolean>;
    onDelete: (p_token: string) => Promise<boolean>;
    onClose: () => void;
};

export default function ParticipantEditModal({ slotIndex, initialForm, onSave, onDelete, onClose }: Props) {
    const [form, setForm] = useState<ModalForm>(initialForm);

    const handleSave = async () => {
        const ok = await onSave(form, slotIndex);
        if (ok) onClose();
    };

    const handleDelete = async () => {
        const ok = await onDelete(form.p_token);
        if (ok) onClose();
    };

    return (
        <div className={styles.modal}>
            <div className={styles.modalContent}>
                <h3>참가자 관리 (슬롯: {slotIndex})</h3>
                <div className={styles.formGroup}>
                    <label style={{ fontSize: '14px', marginBottom: '2px' }}>실명</label>
                    <input type="text" placeholder="예: 홍길동" className={styles.formInput} value={form.real_name} onChange={(e) => setForm({ ...form, real_name: e.target.value })} />
                </div>
                <div className={styles.formGroup}>
                    <label style={{ fontSize: '14px', marginBottom: '2px' }}>익명 (식별 닉네임)</label>
                    <input type="text" placeholder="예: 참가자A" className={styles.formInput} value={form.fake_name} onChange={(e) => setForm({ ...form, fake_name: e.target.value })} />
                </div>
                <div className={styles.formGroup}>
                    <label style={{ fontSize: '14px', marginBottom: '2px' }}>평균 딜량</label>
                    <input type="number" placeholder="예: 250" className={styles.formInput} value={form.avg_damage} onChange={(e) => setForm({ ...form, avg_damage: e.target.value })} />
                </div>
                <div className={styles.formGroup}>
                    <label style={{ fontSize: '14px', marginBottom: '2px' }}>소갯말</label>
                    <input type="text" placeholder="한 줄 소갯말을 입력하세요" className={styles.formInput} value={form.intro} onChange={(e) => setForm({ ...form, intro: e.target.value })} />
                </div>

                <div className={styles.modalButtons}>
                    <button onClick={handleSave} style={{ background: '#4caf50' }}>저장</button>
                    {form.p_token && <button onClick={handleDelete} style={{ background: '#f44336' }}>삭제</button>}
                    <button onClick={onClose} style={{ background: '#555' }}>취소</button>
                </div>
            </div>
        </div>
    );
}
