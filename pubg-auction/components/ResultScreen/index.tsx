// components/ResultScreen/index.tsx
// [렌더링] 3단계 · 최종 팀 편성 결과 (팀명 | 1~4티어 표).
// 이 화면에서만 전원 실명을 공개한다 — 단, 공개 여부는 서버가 강제한다:
//   result_names() RPC가 page_state='result'일 때만 실명을 반환(경매 중엔 빈 배열).
// 렌더 위치: page.tsx의 currentView==='result'.
import { useEffect, useState } from 'react';
import { useRealtimeAuction } from '../AuctionScreen/hooks/useRealtimeAuction';
import { TEAM_COUNT } from '../AuctionScreen/types';
import { participantLabel, teamLabel } from '../AuctionScreen/utils';
import { fetchResultNames } from '../AuctionScreen/auctionData';
import styles from './style.module.css';
import type { Participant } from '../AuctionScreen/types';

export default function ResultScreen() {
    const { participants } = useRealtimeAuction();

    // { p_token: "실명" } — 결과 페이지에서만 서버가 채워준다. participantLabel에 넘겨 실명 표시.
    const [realNames, setRealNames] = useState<Record<string, string>>({});
    useEffect(() => {
        const load = async () => setRealNames(await fetchResultNames());
        load();
    }, []);

    // 한 팀의 특정 티어 셀 내용(이름 또는 '공석').
    const memberOf = (members: Participant[], tier: string) => {
        const m = members.find((p) => p.tier === tier);
        return m ? participantLabel(m, realNames[m.p_token]) : <span className={styles.empty}>공석</span>;
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
                                <td className={`${styles.td} ${styles.teamName}`}>{teamLabel(teamName, participants, realNames)}</td>
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
