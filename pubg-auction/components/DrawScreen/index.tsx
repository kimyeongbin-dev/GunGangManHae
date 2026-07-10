// components/DrawScreen/index.tsx
// [렌더링] 1단계 팀장 추첨 화면 (다크 테마)
import { useEffect, useState } from 'react';
import { useRealtimeAuction } from '../AuctionScreen/hooks/useRealtimeAuction';
import { TEAM_COUNT } from '../AuctionScreen/types';
import { supabase } from '@/lib/supabaseClient';
import { confirmDialog } from '@/lib/toast';
import fonts from '../typography.module.css';
import styles from './style.module.css';
import { drawLeaders, releaseLeaders } from './drawActions';

// 팀장 PIN 목록 조회 (진행자만 RLS로 읽힘). team_name → pin
async function fetchLeaderPins(): Promise<Record<string, string>> {
    const { data } = await supabase.from('leader_pins').select('team_name, pin');
    const rows = (data ?? []) as { team_name: string; pin: string }[];
    const map: Record<string, string> = {};
    rows.forEach((r) => { map[r.team_name] = r.pin; });
    return map;
}

export default function DrawScreen({ isAdmin, revealNames }: { isAdmin: boolean; revealNames: boolean }) {
    const { participants } = useRealtimeAuction();
    const leaders = participants.filter((p) => p.is_leader);

    // 진행자 전용: 팀장 PIN 목록 (배포용). leader_pins는 진행자만 읽을 수 있음.
    // 최초/타인 추첨(팀장 수 변동) 시 로드. 재추첨(16→16)은 핸들러에서 직접 다시 로드.
    const [pins, setPins] = useState<Record<string, string>>({});
    useEffect(() => {
        const load = async () => {
            if (!isAdmin) return;
            setPins(await fetchLeaderPins());
        };
        load();
    }, [isAdmin, leaders.length]);

    const handleDraw = async () => {
        if (leaders.length > 0 && !(await confirmDialog('다시 추첨하면 기존 팀 구성과 경매 내역이 모두 초기화됩니다.\n계속하시겠습니까?'))) return;
        await drawLeaders();
        if (isAdmin) setPins(await fetchLeaderPins());
    };

    const handleRelease = async () => {
        if (!(await confirmDialog('모든 팀장을 해제하고 익명 참가자로 되돌립니다.\n팀 구성과 경매 내역도 모두 초기화됩니다. 계속하시겠습니까?'))) return;
        await releaseLeaders();
        setPins({});
    };

    return (
        <div className={styles.wrap}>
            <div className={styles.header}>
                <h2 className={styles.title}>
                    1단계 · 팀장 추첨 <span className={`${fonts.drawCount} ${styles.count}`}>({leaders.length}/{TEAM_COUNT}팀)</span>
                </h2>
                {isAdmin && (
                    <div className={styles.headerActions}>
                        {leaders.length > 0 && (
                            <button onClick={handleRelease} className={`${fonts.drawBtn} ${styles.releaseBtn}`}>
                                팀장 해제
                            </button>
                        )}
                        <button onClick={handleDraw} className={`${fonts.drawBtn} ${styles.drawBtn}`}>
                            {leaders.length > 0 ? '팀장 다시 추첨' : '팀장 추첨'}
                        </button>
                    </div>
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
                                            {leader.reveal_name ?? leader.fake_name} <span className={styles.leaderTag}>(팀장)</span>
                                        </div>
                                        <span className={`${fonts.tierChip} ${styles.chip} ${styles[`chipTier${leader.tier}`]}`}>
                                            {leader.tier}티어
                                        </span>
                                        {/* PIN은 진행자가 '실명 보는 중'일 때만 노출 (익명 모드에선 참가자처럼 숨김) */}
                                        {isAdmin && revealNames && pins[teamName] && (
                                            <div className={styles.pinBox}>PIN <b>{pins[teamName]}</b></div>
                                        )}
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
