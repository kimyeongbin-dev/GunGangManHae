// components/ResultScreen/index.tsx
// [렌더링] 3단계 최종 팀 편성 결과 화면 (팀명 | 1~4티어 표)
import { useEffect, useState } from 'react';
import { useRealtimeAuction } from '../AuctionScreen/hooks/useRealtimeAuction';
import { TEAM_COUNT } from '../AuctionScreen/types';
import { participantLabel, teamLabel } from '../AuctionScreen/utils';
import { supabase } from '@/lib/supabaseClient';
import styles from './style.module.css';
import type { Participant } from '../AuctionScreen/types';

export default function ResultScreen() {
    const { participants } = useRealtimeAuction();

    // 최종 결과 실명: page_state='result'일 때만 서버가 반환 (result_names RPC)
    const [realNames, setRealNames] = useState<Record<string, string>>({});
    useEffect(() => {
        const load = async () => {
            const { data } = await supabase.rpc('result_names');
            const rows = (data ?? []) as { p_token: string; real_name: string }[];
            const map: Record<string, string> = {};
            rows.forEach((r) => { map[r.p_token] = r.real_name; });
            setRealNames(map);
        };
        load();
    }, []);

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
