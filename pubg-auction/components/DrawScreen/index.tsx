// components/DrawScreen/index.tsx
// [렌더링] 1단계 · 팀장 추첨 화면 (다크 테마).
// 진행자는 '팀장 추첨'/'팀장 해제'로 팀장을 뽑거나 되돌리고, 각 팀의 PIN을 확인해 배포한다.
// 참가자/관전자는 추첨 결과(팀장 명단)만 실시간으로 본다.
// 렌더 위치: page.tsx의 currentView==='draw'.
import { useEffect, useState } from 'react';
import { useRealtimeAuction } from '../AuctionScreen/hooks/useRealtimeAuction';
import { TEAM_COUNT } from '../AuctionScreen/types';
import { fetchLeaderPins } from '../AuctionScreen/auctionData';
import { confirmDialog } from '@/lib/toast';
import fonts from '../typography.module.css';
import styles from './style.module.css';
import { drawLeaders, releaseLeaders } from './drawActions';
import { drawSnakeLeaders } from '../SnakeScreen/snakeActions';
import { useAdminNames } from '../AuctionScreen/hooks/useAdminNames';
import ParticipantDetailModal from '../AuctionScreen/ui/ParticipantDetailModal';

export default function DrawScreen({ isAdmin, revealNames }: { isAdmin: boolean; revealNames: boolean }) {
    // 실시간 참가자 목록에서 팀장(is_leader)만 추린다.
    const { participants } = useRealtimeAuction();
    const leaders = participants.filter((p) => p.is_leader);

    // 진행자 전용: 팀장 PIN 목록 { "N팀": "PIN" } (leader_pins는 RLS로 진행자만 읽힘).
    // 팀장 수가 바뀔 때(최초/타인 추첨) 자동 로드하고, 본인이 추첨/해제할 땐 핸들러에서 직접 갱신한다.
    const [pins, setPins] = useState<Record<string, string>>({});
    useEffect(() => {
        const load = async () => {
            if (!isAdmin) return; // 비진행자는 조회 자체를 하지 않음
            setPins(await fetchLeaderPins());
        };
        load();
    }, [isAdmin, leaders.length]);

    // 진행자 실명모드에서만 실명 표시. 카드 클릭 시 상세(소개글 등) 팝업을 띄운다(읽기 전용).
    const adminNames = useAdminNames(isAdmin, participants.length);
    const displayNames = isAdmin && revealNames ? adminNames : undefined;
    const [viewingToken, setViewingToken] = useState<string | null>(null);
    const viewingTarget = participants.find((p) => p.p_token === viewingToken) ?? null;

    // 재추첨: 기존 구성이 있으면 초기화 경고 → drawLeaders → PIN 다시 로드.
    const handleDraw = async () => {
        if (leaders.length > 0 && !(await confirmDialog('다시 추첨하면 기존 팀 구성과 경매 내역이 모두 초기화됩니다.\n계속하시겠습니까?'))) return;
        await drawLeaders();
        if (isAdmin) setPins(await fetchLeaderPins());
    };

    // 스네이크 팀장 추첨: 한 티어를 무작위로 뽑아 그 티어 16명을 팀장으로. (경매와 달리 PIN 없음)
    const handleSnakeDraw = async () => {
        if (leaders.length > 0 && !(await confirmDialog('다시 추첨하면 기존 팀 구성과 경매/스네이크 내역이 모두 초기화됩니다.\n계속하시겠습니까?'))) return;
        const ok = await drawSnakeLeaders();
        if (ok) setPins({}); // 스네이크는 PIN을 만들지 않으므로 목록 비움
    };

    // 해제: 전원 익명 미배정 복귀 → PIN도 폐기되므로 목록 비움.
    const handleRelease = async () => {
        if (!(await confirmDialog('모든 팀장을 해제하고 익명 참가자로 되돌립니다.\n팀 구성과 경매 내역도 모두 초기화됩니다. 계속하시겠습니까?'))) return;
        await releaseLeaders();
        setPins({});
    };

    return (
        <div className={styles.wrap}>
            <div className={styles.header}>
                <h2 className={styles.title}>
                    팀장 추첨 <span className={`${fonts.drawCount} ${styles.count}`}>({leaders.length}/{TEAM_COUNT}팀)</span>
                </h2>
                {isAdmin && (
                    <div className={styles.headerActions}>
                        {leaders.length > 0 && (
                            <button onClick={handleRelease} className={`${fonts.drawBtn} ${styles.releaseBtn}`}>
                                팀장 해제
                            </button>
                        )}
                        <button onClick={handleDraw} className={`${fonts.drawBtn} ${styles.drawBtn}`}>
                            경매 팀장 추첨
                        </button>
                        <button onClick={handleSnakeDraw} className={`${fonts.drawBtn} ${styles.snakeBtn}`}>
                            스네이크 팀장 추첨
                        </button>
                    </div>
                )}
            </div>

            {leaders.length === 0 ? (
                <div className={styles.empty}>
                    아직 팀장을 추첨하지 않았습니다.{isAdmin ? ' 우측 상단 “팀장 추첨”을 눌러 시작하세요.' : ''}
                </div>
            ) : (
                // 16팀 카드 그리드: 각 팀의 팀장(공개명) + 티어 + (진행자 실명모드) PIN.
                <div className={styles.grid}>
                    {Array.from({ length: TEAM_COUNT }).map((_, i) => {
                        const teamName = `${i + 1}팀`;
                        const leader = leaders.find((p) => p.team_name === teamName);
                        return (
                            <div
                                key={i}
                                className={`${styles.card} ${leader ? styles.clickable : ''}`}
                                onClick={leader ? () => setViewingToken(leader.p_token) : undefined}
                            >
                                <div className={`${fonts.teamCardLabel} ${styles.cardLabel}`}>{teamName}</div>
                                {leader ? (
                                    <>
                                        {/* 팀장은 공개명(reveal_name=실명)으로 노출. 값이 없으면 익명 폴백. */}
                                        <div className={`${fonts.teamCardName} ${styles.cardName}`}>
                                            {leader.reveal_name ?? leader.fake_name} <span className={styles.leaderTag}>(팀장)</span>
                                        </div>
                                        <span className={`${fonts.tierChip} ${styles.chip} ${styles[`chipTier${leader.tier}`]}`}>
                                            {leader.tier}티어
                                        </span>
                                        {/* PIN: 진행자에게만 표시. '실명 보는 중'이면 실제 PIN, '익명 보는 중'이면 마스킹(••••).
                                            참가자/관전자는 pins 자체가 비어 있어 아무것도 보이지 않는다. */}
                                        {isAdmin && pins[teamName] && (
                                            <div className={styles.pinBox}>PIN <b>{revealNames ? pins[teamName] : '••••'}</b></div>
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

            {/* 팀장 상세 정보 팝업 (읽기 전용: 소개글 등) */}
            {viewingTarget && (
                <ParticipantDetailModal
                    target={viewingTarget}
                    isAdmin={false}
                    realName={displayNames?.[viewingTarget.p_token]}
                    auctionRunning={false}
                    finalPrice={0}
                    onClose={() => setViewingToken(null)}
                    onAssignTarget={() => {}}
                    onRevertWin={() => {}}
                />
            )}
        </div>
    );
}
