// components/AuctionScreen/ui/AuctionPanel.tsx
// [렌더링] 경매 진행 창 (대상자 정보 · 입찰/제어판 · 실시간 로그)
import { useState } from 'react';
import styles from '../style.module.css';
import fonts from '../../typography.module.css';
import { TEAM_COUNT, TEAM_BUDGET } from '../types';
import { formatTime, participantLabel, teamLabel } from '../utils';
import type { Participant, Log } from '../types';

type Props = {
    isAdmin: boolean;
    showReal: boolean;
    participants: Participant[];
    auctionTarget: Participant | null;
    currentHighestBid: number;
    teamPoints: Record<string, number>; // 팀별 소비 포인트 (남은 예산 계산용)
    timeLeft: number;
    logs: Log[];
    onStartAuction: () => void;
    onStopAuction: () => void;
    onBid: (teamName: string, amount: number) => Promise<boolean>;
    onClearLogs: () => void;
    ineligibleTeams: string[]; // 현재 티어를 이미 확정해 참여 불가한 팀
};

export default function AuctionPanel({
    isAdmin,
    showReal,
    participants,
    auctionTarget,
    currentHighestBid,
    teamPoints,
    timeLeft,
    logs,
    onStartAuction,
    onStopAuction,
    onBid,
    onClearLogs,
    ineligibleTeams,
}: Props) {
    // 입찰 폼 상태 (참가자 전용, 이 컴포넌트 로컬)
    const [selectedTeam, setSelectedTeam] = useState('');
    const [bidInput, setBidInput] = useState('');
    const ineligible = new Set(ineligibleTeams);

    const handleBid = async () => {
        const ok = await onBid(selectedTeam, parseInt(bidInput));
        if (ok) setBidInput('');
    };

    return (
        <div className={styles.auctionBoard}>
            {/* [좌측 구역] 참가자 정보 및 입찰 컨트롤 */}
            <div className={styles.auctionLeft}>
                <h3 className={`${fonts.sectionTitle} ${styles.blockTitle}`}>
                    {isAdmin ? "경매 진행 제어판" : "경매 진행 창"}
                </h3>

                {auctionTarget ? (
                    <div className={styles.targetCard}>
                        <h2>{participantLabel(auctionTarget, showReal)}</h2>
                        <p><strong>티어:</strong> {auctionTarget.tier}티어 | <strong>평균 딜량:</strong> {auctionTarget.avg_damage}</p>
                        <p className={styles.targetIntro}>&quot;{auctionTarget.intro}&quot;</p>
                    </div>
                ) : (
                    <div className={styles.targetCard}>
                        <h2 className={styles.waitingText}>대기 중</h2>
                    </div>
                )}

                <div className={`${fonts.bidInfoRow} ${styles.bidInfoWrap}`}>
                    <div className={`${fonts.highestBid} ${styles.highestBidText}`}>
                        현재 최고가: {currentHighestBid}P
                        {selectedTeam && (
                            <span className={styles.remainBudget}>
                                | {selectedTeam} 남은 예산: {TEAM_BUDGET - (teamPoints[selectedTeam] ?? 0)}P
                            </span>
                        )}
                    </div>
                </div>

                {/* 진행자 vs 참가자 UI 분기 처리 */}
                <div className={`${styles.formGroup} ${styles.controlDock}`}>
                    {isAdmin ? (
                        /* [진행자 전용 제어판] */
                        <div className={`${styles.adminControlPanel} ${styles.ctrlBtnRow}`}>
                            <button onClick={onStartAuction} className={`${styles.ctrlBtn} ${timeLeft > 0 ? styles.ctrlBtnRestart : styles.ctrlBtnStart}`}>
                                {timeLeft > 0 ? '재시작' : '경매 시작 (1분)'}
                            </button>
                            <button onClick={onStopAuction} disabled={timeLeft <= 0} className={`${styles.ctrlBtn} ${styles.ctrlBtnStop}`}>
                                경매 중단
                            </button>
                        </div>
                    ) : (
                        /* [일반 참가자 입찰 폼] */
                        <>
                            <select className={styles.formSelect} value={selectedTeam} onChange={(e) => setSelectedTeam(e.target.value)}>
                                <option value="">팀을 선택하세요</option>
                                {Array.from({ length: TEAM_COUNT }).map((_, i) => {
                                    const name = `${i + 1}팀`;
                                    const blocked = ineligible.has(name);
                                    return (
                                        <option key={i} value={name} disabled={blocked}>
                                            {teamLabel(name, participants)}{blocked ? ' (티어 완료)' : ''}
                                        </option>
                                    );
                                })}
                            </select>
                            <input type="number" placeholder="입찰 포인트" className={styles.formInput} value={bidInput} onChange={(e) => setBidInput(e.target.value)} disabled={timeLeft <= 0} />
                            <button onClick={handleBid} className={styles.btnBid} disabled={timeLeft <= 0}>
                                {timeLeft > 0 ? '입찰하기' : '경매 대기 중'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* [우측 구역] 실시간 타이머 + 경매 로그 */}
            <div className={styles.auctionRight}>
                {/* 실시간 공유 타이머 (진행자·참가자 모두에게 표시) */}
                <div className={`${fonts.timer} ${styles.timerBox} ${timeLeft > 0 && timeLeft <= 10 ? styles.timerUrgent : styles.timerNormal}`}>
                    ⏱ {formatTime(timeLeft)}
                </div>

                <div className={styles.logHeaderRow}>
                    <h3 className={`${fonts.sectionTitle} ${styles.logHeaderTitle}`}>실시간 경매 로그</h3>
                    {isAdmin && (
                        <button onClick={onClearLogs} className={`${fonts.miniBtn} ${styles.clearLogsBtn}`}>
                            전체 삭제
                        </button>
                    )}
                </div>

                <div className={styles.auctionLogContainer}>
                    {logs.length === 0 ? (
                        <div className={styles.logEmpty}>시작 대기 중...</div>
                    ) : (
                        logs.map((log) => (
                            <div key={log.id} className={styles.logRow}>
                                <span className={`${fonts.logTime} ${styles.logTimeText}`}>
                                    [{new Date(log.created_at).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]
                                </span>
                                {log.message}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
