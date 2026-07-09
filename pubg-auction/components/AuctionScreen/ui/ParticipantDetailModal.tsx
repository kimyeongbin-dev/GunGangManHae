// components/AuctionScreen/ui/ParticipantDetailModal.tsx
// [렌더링] 참가자 상세 정보 팝업 (블라인드: 익명명/티어/딜량/소개글)
import styles from '../style.module.css';
import type { Participant } from '../types';

type Props = {
    target: Participant;
    isAdmin: boolean;
    auctionRunning: boolean;
    finalPrice: number; // 낙찰가 (team_name 있을 때 의미)
    onClose: () => void;
    onAssignTarget: (target: Participant) => void;
    onRevertWin: (target: Participant) => void;
};

export default function ParticipantDetailModal({ target, isAdmin, auctionRunning, finalPrice, onClose, onAssignTarget, onRevertWin }: Props) {
    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.detailModalContent} onClick={(e) => e.stopPropagation()}>
                <button className={styles.closeButton} onClick={onClose}>×</button>

                {/* 핵심 정보 상단 배치 */}
                <h2 style={{ margin: '0 0 10px 0', color: '#ff9800' }}>{target.fake_name}</h2>
                <div className={styles.infoGrid}>
                    {/* 티어 배지: tier 값에 따라 클래스 동적 할당 */}
                    <span className={`${styles.statBadge} ${styles[`tier${target.tier}Badge`]}`}>
                        {target.tier} 티어
                    </span>

                    {/* 딜량 배지 */}
                    <span className={styles.statBadge}>
                        평균 딜량: {target.avg_damage}
                    </span>

                    {/* 낙찰된 참가자: 팀 + 낙찰가 배지 */}
                    {target.team_name && (
                        <>
                            <span className={styles.statBadge} style={{ background: '#2e5d34', border: '1px solid #4caf50' }}>
                                {target.team_name}
                            </span>
                            <span className={styles.statBadge} style={{ background: '#5d4b1f', border: '1px solid #ff9800' }}>
                                낙찰가: {finalPrice}P
                            </span>
                        </>
                    )}

                    {/* 진행자 전용 실명 표시 */}
                    {isAdmin && (
                        <span className={styles.statBadge} style={{ background: '#333', border: '1px solid #555' }}>
                            실명: {target.real_name}
                        </span>
                    )}
                </div>

                {/* 소개글 강조 구역 */}
                <div className={styles.introDisplay}>
                    &quot;{target.intro || '등록된 소개글이 없습니다.'}&quot;
                </div>

                {/* 진행자 전용 액션: 낙찰됨 → 낙찰 취소 / 진행 중 → 불가 안내 / 그 외 → 대상 지정 */}
                {isAdmin && (
                    target.team_name ? (
                        <>
                            <div style={{ marginTop: '10px', textAlign: 'center', color: '#4caf50', fontSize: '0.95rem', fontWeight: 'bold' }}>
                                이미 {target.team_name}에 낙찰됨
                            </div>
                            <button
                                onClick={() => onRevertWin(target)}
                                style={{ width: '100%', padding: '12px', background: '#f44336', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem', marginTop: '10px' }}
                            >
                                낙찰 취소
                            </button>
                        </>
                    ) : auctionRunning ? (
                        <div style={{ marginTop: '10px', textAlign: 'center', color: '#ff4c4c', fontSize: '0.9rem', fontWeight: 'bold' }}>
                            경매 진행 중에는 대상을 변경할 수 없습니다.
                        </div>
                    ) : (
                        <button
                            onClick={() => onAssignTarget(target)}
                            style={{ width: '100%', padding: '12px', background: '#ff9800', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem', marginTop: '10px' }}
                        >
                            경매 대상 지정
                        </button>
                    )
                )}
            </div>
        </div>
    );
}
