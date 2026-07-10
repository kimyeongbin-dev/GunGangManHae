// components/AuctionScreen/ui/AuctionPanel.tsx
// [렌더링] 경매 진행 창 (대상자 정보 · 입찰/제어판 · 실시간 로그)
//  - 진행자: 시작/중단 제어판
//  - 팀장: PIN 입장 후 자기 팀으로만 입찰
//  - 참가자: 관전 전용 (입찰 UI 없음)
import { useState } from 'react';
import styles from '../style.module.css';
import fonts from '../../typography.module.css';
import { TEAM_BUDGET, AUCTION_DURATION_SEC } from '../types';
import { formatTime, participantLabel, teamLabel } from '../utils';
import { toast } from '@/lib/toast';
import type { Participant, Log } from '../types';

type Props = {
    isAdmin: boolean;
    realNames?: Record<string, string>; // 진행자 실명모드에서만 전달
    participants: Participant[];
    auctionTarget: Participant | null;
    currentHighestBid: number;
    teamPoints: Record<string, number>; // 팀별 소비 포인트 (남은 예산 계산용)
    timeLeft: number;
    logs: Log[];
    onStartAuction: () => void;
    onStopAuction: () => void;
    onBid: (amount: number) => Promise<boolean>;
    onClearLogs: () => void;
    ineligibleTeams: string[]; // 현재 티어를 이미 확정해 참여 불가한 팀
    leaderTeam: string | null; // 팀장으로 입장한 팀 (없으면 참가자/관전)
    onLeaderLogin: (pin: string) => Promise<string | null>;
    onLeaderLogout: () => void;
};

export default function AuctionPanel({
    isAdmin,
    realNames,
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
    leaderTeam,
    onLeaderLogin,
    onLeaderLogout,
}: Props) {
    const [bidInput, setBidInput] = useState('');
    const [pinInput, setPinInput] = useState('');

    // 팀장이 입장했고, 그 팀이 현재 대상 티어를 이미 확정했으면 입찰 불가
    const tierBlocked = leaderTeam ? new Set(ineligibleTeams).has(leaderTeam) : false;
    const canBid = timeLeft > 0 && !tierBlocked;

    const handleBid = async () => {
        const ok = await onBid(parseInt(bidInput));
        if (ok) setBidInput('');
    };

    const handleLeaderLogin = async () => {
        const team = await onLeaderLogin(pinInput);
        if (team) {
            toast.success(`${teamLabel(team, participants)} 팀장으로 입장했습니다.`);
            setPinInput('');
        } else {
            toast.error('PIN이 올바르지 않습니다.');
        }
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
                        <h2>{participantLabel(auctionTarget, realNames?.[auctionTarget.p_token])}</h2>
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
                        {leaderTeam && (
                            <span className={styles.remainBudget}>
                                | {leaderTeam} 남은 예산: {TEAM_BUDGET - (teamPoints[leaderTeam] ?? 0)}P
                            </span>
                        )}
                    </div>
                </div>

                {/* 역할별 컨트롤: 진행자 / 팀장 / 참가자 */}
                <div className={`${styles.formGroup} ${styles.controlDock}`}>
                    {isAdmin ? (
                        /* [진행자 전용 제어판] */
                        <div className={`${styles.adminControlPanel} ${styles.ctrlBtnRow}`}>
                            <button onClick={onStartAuction} className={`${styles.ctrlBtn} ${timeLeft > 0 ? styles.ctrlBtnRestart : styles.ctrlBtnStart}`}>
                                {timeLeft > 0 ? '재시작' : `경매 시작 (${AUCTION_DURATION_SEC}초)`}
                            </button>
                            <button onClick={onStopAuction} disabled={timeLeft <= 0} className={`${styles.ctrlBtn} ${styles.ctrlBtnStop}`}>
                                경매 중단
                            </button>
                        </div>
                    ) : leaderTeam ? (
                        /* [팀장 입찰 폼] 자기 팀 고정 */
                        <>
                            <div className={styles.leaderBar}>
                                <span className={styles.leaderBadge}>{teamLabel(leaderTeam, participants)} 팀장</span>
                                <button onClick={onLeaderLogout} className={styles.leaderLogoutBtn}>팀장 해제</button>
                            </div>
                            {tierBlocked && (
                                <div className={styles.leaderBlocked}>이미 이 티어 팀원이 있어 입찰할 수 없습니다.</div>
                            )}
                            <input
                                type="number"
                                placeholder="입찰 포인트"
                                className={styles.formInput}
                                value={bidInput}
                                onChange={(e) => setBidInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && canBid) handleBid(); }}
                                disabled={!canBid}
                            />
                            <button onClick={handleBid} className={styles.btnBid} disabled={!canBid}>
                                {timeLeft > 0 ? '입찰하기' : '경매 대기 중'}
                            </button>
                        </>
                    ) : (
                        /* [참가자/관전] 팀장 PIN 입장 */
                        <div className={styles.leaderLoginBox}>
                            <div className={styles.leaderHint}>참가자는 관전만 가능합니다. 팀장은 PIN으로 입장하세요.</div>
                            <input
                                type="text"
                                placeholder="팀장 PIN"
                                className={styles.formInput}
                                value={pinInput}
                                onChange={(e) => setPinInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleLeaderLogin(); }}
                            />
                            <button onClick={handleLeaderLogin} className={styles.btnBid}>팀장 입장</button>
                        </div>
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
