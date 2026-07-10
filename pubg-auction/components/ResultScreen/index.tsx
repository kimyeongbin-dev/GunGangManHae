// components/ResultScreen/index.tsx
// [렌더링] 3단계 최종 팀 편성 결과 화면 (팀명 | 1~4티어 표)
import { useRealtimeAuction } from '../AuctionScreen/hooks/useRealtimeAuction';
import { TEAM_COUNT } from '../AuctionScreen/types';
import { participantLabel, teamLabel } from '../AuctionScreen/utils';
import styles from './style.module.css';
import type { Participant } from '../AuctionScreen/types';

export default function ResultScreen() {
    const { participants } = useRealtimeAuction();

    // 최종 결과이므로 실명(비제이명)을 공개
    const memberOf = (members: Participant[], tier: string) => {
        const m = members.find((p) => p.tier === tier);
        return m ? participantLabel(m, true) : <span className={styles.empty}>공석</span>;
    };

    return (
        <div className={styles.wrap}>
            <h2 className={styles.title}>최종 팀 편성 결과</h2>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th className={styles.th}>팀명</th>
                        <th className={styles.th}>1티어</th>
                        <th className={styles.th}>2티어</th>
                        <th className={styles.th}>3티어</th>
                        <th className={styles.th}>4티어</th>
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: TEAM_COUNT }).map((_, i) => {
                        const teamName = `${i + 1}팀`;
                        const members = participants.filter((p) => p.team_name === teamName);
                        return (
                            <tr key={i}>
                                <td className={`${styles.td} ${styles.teamName}`}>{teamLabel(teamName, participants)}</td>
                                <td className={styles.td}>{memberOf(members, '1')}</td>
                                <td className={styles.td}>{memberOf(members, '2')}</td>
                                <td className={styles.td}>{memberOf(members, '3')}</td>
                                <td className={styles.td}>{memberOf(members, '4')}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
