// components/AuctionScreen/ui/UnassignedGrid.tsx
// [렌더링] 미배정 참가자 목록 (16x4 대기석 그리드)
import styles from '../style.module.css';
import fonts from '../../typography.module.css';
import { getTierBySlot, participantLabel } from '../utils';
import { SLOT_COUNT } from '../types';
import type { Participant } from '../types';

type Props = {
    participants: Participant[];
    isAdmin: boolean;
    showReal: boolean; // true면 실명(비제이명) 표시, false면 익명
    onCellClick: (slotIndex: number) => void;
    onEditParticipant: (participant: Participant, slotIndex: number) => void;
};

export default function UnassignedGrid({ participants, isAdmin, showReal, onCellClick, onEditParticipant }: Props) {
    const nameOf = (p: Participant) => participantLabel(p, showReal);

    return (
        <div className={styles.leftPanel}>
            <div className={styles.gridHeader}>
                <h3 className={`${fonts.sectionTitle} ${styles.gridTitle}`}>미배정 참가자 목록 (16x4 대기석)</h3>
                <div className={styles.gridLegend}>
                    <div className={styles.legendItem}><div className={`${styles.legendBox} ${styles.legendTier1}`}></div>1티어</div>
                    <div className={styles.legendItem}><div className={`${styles.legendBox} ${styles.legendTier2}`}></div>2티어</div>
                    <div className={styles.legendItem}><div className={`${styles.legendBox} ${styles.legendTier3}`}></div>3티어</div>
                    <div className={styles.legendItem}><div className={`${styles.legendBox} ${styles.legendTier4}`}></div>4티어</div>
                </div>
            </div>

            <div className={styles.gridContainer}>
                {Array.from({ length: SLOT_COUNT }).map((_, i) => {
                    const tier = getTierBySlot(i);
                    const p = participants.find((part) => part.slot_index === i);
                    const cellClass = `${styles.gridCell} ${styles[`tier${tier}`]} ${p ? styles.occupied : ''} ${p?.team_name ? styles.assigned : ''}`;

                    return (
                        <div key={i} className={cellClass} onClick={() => onCellClick(i)}>
                            {p && (
                                <>
                                    <span className={styles.nickText}>{nameOf(p)}</span>
                                    <span className={styles.damageText}>{p.avg_damage}</span>
                                    {isAdmin && (
                                        <div
                                            className={styles.editBadge}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onEditParticipant(p, i);
                                            }}
                                        >
                                            수정
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
