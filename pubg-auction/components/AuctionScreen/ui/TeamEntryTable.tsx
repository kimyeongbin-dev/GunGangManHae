// components/AuctionScreen/ui/TeamEntryTable.tsx
// [렌더링] 팀 확정 엔트리 현황 (16팀 × 4티어 표). 렌더: AuctionScreen(index.tsx) 우측 하단.
// 팀원 셀 클릭 → onViewMember(상세 팝업), 진행자는 '경매 전체 초기화'(onResetAuction) 가능.
// 팀 포인트/낙찰가는 teamPoints·memberPrices(useTeamManagement 파생값)에서 온다.
import styles from '../style.module.css';
import fonts from '../../typography.module.css';
import { TEAM_COUNT, TEAM_BUDGET } from '../types';
import { participantLabel, teamLabel } from '../utils';
import type { Participant } from '../types';

type Props = {
    participants: Participant[];
    teamPoints: Record<string, number>;
    memberPrices: Record<string, number>;
    isAdmin: boolean;
    realNames?: Record<string, string>; // 진행자 실명모드에서만 전달
    onResetAuction: () => void;
    onViewMember: (member: Participant) => void;
};

export default function TeamEntryTable({ participants, teamPoints, memberPrices, isAdmin, realNames, onResetAuction, onViewMember }: Props) {
    const renderMember = (m?: Participant) => {
        if (!m) return <span className={styles.emptyMember}>공석</span>;
        // 팀장은 낙찰가 없이 "비제이명(팀장)", 그 외엔 이름과 낙찰가. 클릭 시 상세 정보 팝업.
        const name = participantLabel(m, realNames?.[m.p_token]);
        const label = m.is_leader ? name : `${name} (${memberPrices[m.p_token] ?? 0}P)`;
        return (
            <button type="button" className={styles.memberLink} onClick={() => onViewMember(m)}>
                {label}
            </button>
        );
    };

    return (
        <div className={styles.teamListPanel}>
            <div className={styles.teamHeader}>
                <h3 className={`${fonts.sectionTitle} ${styles.teamTitle}`}>팀 확정 엔트리 현황</h3>
                {isAdmin && (
                    <button onClick={onResetAuction} className={`${fonts.smallBtn} ${styles.resetBtn}`}>
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
                                <td className={`${styles.teamTd} ${styles.teamIdentity}`}>[{teamLabel(teamName, participants, realNames)}] <span className={styles.teamPts}>{teamPoints[teamName]} / {TEAM_BUDGET} pts</span></td>
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
