// components/ResultScreen/index.tsx
// [렌더링] 최종 팀 편성 결과 (팀명 | 1~4티어 표). 모두가 자유 이동하는 일반 페이지.
// 이름 표시:
//   · 기본 = 익명(fake_name). 전원 동일.
//   · 진행자 개인 토글('실명 보는 중') = 진행자 화면에서만 실명(participant_secrets, 진행자 RLS).
//   · '전체 실명 공개' 버튼 = page_state.reveal_until을 now+60초로 → result_names() RPC가 그동안 전원에게 실명 반환.
//     60초 만료 또는 진행자 모드 해제 시 자동 비공개(블라인드 복귀).
import { useEffect, useState } from 'react';
import { useRealtimeAuction } from '../AuctionScreen/hooks/useRealtimeAuction';
import { useAdminNames } from '../AuctionScreen/hooks/useAdminNames';
import { TEAM_COUNT } from '../AuctionScreen/types';
import { participantLabel, teamLabel } from '../AuctionScreen/utils';
import { fetchResultNames } from '../AuctionScreen/auctionData';
import styles from './style.module.css';
import type { Participant } from '../AuctionScreen/types';

// 전체 실명 공개 스위치(버튼)는 상단 헤더 우측(진행자 도구 라인)에 있다 → page.tsx.
// 여기선 publicReveal(공유 공개 여부)만 받아 이름 표시를 결정한다.
type Props = {
    isAdmin: boolean;
    revealNames: boolean; // 진행자 개인 실명 토글(자기 화면만)
    publicReveal: boolean; // 전체 실명 공개 중(공유)
};

export default function ResultScreen({ isAdmin, revealNames, publicReveal }: Props) {
    const { participants } = useRealtimeAuction();

    // 진행자 개인 실명(secrets, 진행자만 RLS). 전체 공개 여부와 무관하게 토글로 확인 가능.
    const adminNames = useAdminNames(isAdmin, participants.length);
    // 전체 공개 실명(result_names RPC, 서버가 reveal_until로 게이팅). 공개 중일 때만 로드, 만료 시 비운다.
    const [resultNames, setResultNames] = useState<Record<string, string>>({});
    useEffect(() => {
        if (!publicReveal) {
            setResultNames({});
            return;
        }
        let alive = true;
        fetchResultNames().then((n) => {
            if (alive) setResultNames(n);
        });
        return () => {
            alive = false;
        };
    }, [publicReveal]);

    // 실명 표시 조건: 전체 공개 중이거나, 진행자가 개인 토글을 켰을 때.
    // 이름 출처: 진행자는 자기 secrets(adminNames), 비진행자는 공개 RPC 결과(resultNames)만 접근 가능.
    const showReal = publicReveal || (isAdmin && revealNames);
    const names = isAdmin ? adminNames : resultNames;
    const displayNames = showReal ? names : undefined;

    // 한 팀의 특정 티어 셀 내용(이름 또는 '공석').
    const memberOf = (members: Participant[], tier: string) => {
        const m = members.find((p) => p.tier === tier);
        return m ? participantLabel(m, displayNames?.[m.p_token]) : <span className={styles.empty}>공석</span>;
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
                                <td className={`${styles.td} ${styles.teamName}`}>{teamLabel(teamName, participants, displayNames)}</td>
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
