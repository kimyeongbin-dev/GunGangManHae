// components/AuctionScreen/ui/TeamEntryTable.tsx
// [렌더링] 팀 확정 엔트리 현황 (16팀 x 4티어 표)
import styles from '../style.module.css';
import { TEAM_COUNT, TEAM_BUDGET } from '../types';
import type { Participant } from '../types';

type Props = {
    participants: Participant[];
    teamPoints: Record<string, number>;
    memberPrices: Record<string, number>;
    isAdmin: boolean;
    onResetAuction: () => void;
};

export default function TeamEntryTable({ participants, teamPoints, memberPrices, isAdmin, onResetAuction }: Props) {
    const renderMember = (m?: Participant) => {
        if (!m) return <span className={styles.emptyMember}>공석</span>;
        const name = isAdmin ? `${m.fake_name}(${m.real_name})` : m.fake_name;
        return `${name} (${memberPrices[m.p_token] ?? 0}P)`;
    };

    return (
        <div className={styles.teamListPanel}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: '5px 0', fontSize: '16px' }}>팀 확정 엔트리 현황</h3>
                {isAdmin && (
                    <button
                        onClick={onResetAuction}
                        style={{ background: '#f44336', color: '#fff', border: 'none', borderRadius: '3px', fontSize: '12px', padding: '4px 10px', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                        경매 전체 초기화
                    </button>
                )}
            </div>
            <table className={styles.teamTable}>
                <thead>
                    <tr>
                        <th className={styles.teamTh}>팀명 [포인트]</th>
                        <th className={styles.teamTh}>1티어 팀원</th>
                        <th className={styles.teamTh}>2티어 팀원</th>
                        <th className={styles.teamTh}>3티어 팀원</th>
                        <th className={styles.teamTh}>4티어 팀원</th>
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: TEAM_COUNT }).map((_, i) => {
                        const teamName = `${i + 1}팀`;
                        const members = participants.filter((p) => p.team_name === teamName);

                        return (
                            <tr key={i}>
                                <td className={`${styles.teamTd} ${styles.teamIdentity}`}>[{teamName}] <span className={styles.teamPts}>{teamPoints[teamName]} / {TEAM_BUDGET} pts</span></td>
                                <td className={`${styles.teamTd} ${styles.teamMemberCell}`}>{renderMember(members.find((p) => p.tier === "1"))}</td>
                                <td className={`${styles.teamTd} ${styles.teamMemberCell}`}>{renderMember(members.find((p) => p.tier === "2"))}</td>
                                <td className={`${styles.teamTd} ${styles.teamMemberCell}`}>{renderMember(members.find((p) => p.tier === "3"))}</td>
                                <td className={`${styles.teamTd} ${styles.teamMemberCell}`}>{renderMember(members.find((p) => p.tier === "4"))}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
