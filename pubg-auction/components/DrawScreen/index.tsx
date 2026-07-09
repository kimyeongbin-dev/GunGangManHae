// components/DrawScreen/index.tsx
// [렌더링] 1단계 팀장 추첨 화면 (다크 테마)
import { useRealtimeAuction } from '../AuctionScreen/hooks/useRealtimeAuction';
import { TEAM_COUNT } from '../AuctionScreen/types';
import { confirmDialog } from '@/lib/toast';
import fonts from '../typography.module.css';
import styles from './style.module.css';
import { drawLeaders } from './drawActions';

export default function DrawScreen({ isAdmin }: { isAdmin: boolean }) {
    const { participants } = useRealtimeAuction();
    const leaders = participants.filter((p) => p.is_leader);

    const handleDraw = async () => {
        if (leaders.length > 0 && !(await confirmDialog('다시 추첨하면 기존 팀 구성과 경매 내역이 모두 초기화됩니다.\n계속하시겠습니까?'))) return;
        await drawLeaders();
    };

    return (
        <div className={styles.wrap}>
            <div className={styles.header}>
                <h2 className={styles.title}>
                    1단계 · 팀장 추첨 <span className={`${fonts.drawCount} ${styles.count}`}>({leaders.length}/{TEAM_COUNT}팀)</span>
                </h2>
                {isAdmin && (
                    <button onClick={handleDraw} className={`${fonts.drawBtn} ${styles.drawBtn}`}>
                        {leaders.length > 0 ? '팀장 다시 추첨' : '팀장 추첨'}
                    </button>
                )}
            </div>

            {leaders.length === 0 ? (
                <div className={styles.empty}>
                    아직 팀장을 추첨하지 않았습니다.{isAdmin ? ' 우측 상단 “팀장 추첨”을 눌러 시작하세요.' : ''}
                </div>
            ) : (
                <div className={styles.grid}>
                    {Array.from({ length: TEAM_COUNT }).map((_, i) => {
                        const teamName = `${i + 1}팀`;
                        const leader = leaders.find((p) => p.team_name === teamName);
                        return (
                            <div key={i} className={styles.card}>
                                <div className={`${fonts.teamCardLabel} ${styles.cardLabel}`}>{teamName}</div>
                                {leader ? (
                                    <>
                                        <div className={`${fonts.teamCardName} ${styles.cardName}`}>
                                            {leader.real_name} <span className={styles.leaderTag}>(팀장)</span>
                                        </div>
                                        <span className={`${fonts.tierChip} ${styles.chip} ${styles[`chipTier${leader.tier}`]}`}>
                                            {leader.tier}티어
                                        </span>
                                    </>
                                ) : (
                                    <div className={styles.unassigned}>미배정</div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
