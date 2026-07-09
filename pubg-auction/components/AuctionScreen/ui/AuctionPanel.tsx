// components/AuctionScreen/ui/AuctionPanel.tsx
// [렌더링] 경매 진행 창 (대상자 정보 · 입찰/제어판 · 실시간 로그)
import { useState } from 'react';
import styles from '../style.module.css';
import { TEAM_COUNT, TEAM_BUDGET } from '../types';
import { formatTime } from '../utils';
import type { Participant, Log } from '../types';

type Props = {
    isAdmin: boolean;
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
                <h3 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>
                    {isAdmin ? "경매 진행 제어판" : "경매 진행 창"}
                </h3>

                {auctionTarget ? (
                    <div className={styles.targetCard}>
                        <h2>{isAdmin ? `${auctionTarget.fake_name} (${auctionTarget.real_name})` : auctionTarget.fake_name}</h2>
                        <p><strong>티어:</strong> {auctionTarget.tier}티어 | <strong>평균 딜량:</strong> {auctionTarget.avg_damage}</p>
                        <p className={styles.targetIntro}>&quot;{auctionTarget.intro}&quot;</p>
                    </div>
                ) : (
                    <div className={styles.targetCard}>
                        <h2 style={{ color: '#888' }}>대기 중</h2>
                    </div>
                )}

                <div style={{ margin: '10px 0', fontSize: '14px', textAlign: 'center' }}>
                    <div style={{ fontWeight: 'bold', color: '#ff9800', fontSize: '1.2rem' }}>
                        현재 최고가: {currentHighestBid}P
                        {selectedTeam && (
                            <span style={{ color: '#4caf50', marginLeft: 12 }}>
                                | {selectedTeam} 남은 예산: {TEAM_BUDGET - (teamPoints[selectedTeam] ?? 0)}P
                            </span>
                        )}
                    </div>
                </div>

                {/* 진행자 vs 참가자 UI 분기 처리 */}
                <div className={styles.formGroup} style={{ marginTop: 'auto' }}>
                    {isAdmin ? (
                        /* [진행자 전용 제어판] */
                        <div className={styles.adminControlPanel} style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={onStartAuction} style={{ flex: 1, background: timeLeft > 0 ? '#9c27b0' : '#2196f3', padding: '12px', border: 'none', color: 'white', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>
                                {timeLeft > 0 ? '재시작' : '경매 시작 (1분)'}
                            </button>
                            <button
                                onClick={onStopAuction}
                                disabled={timeLeft <= 0}
                                style={{ flex: 1, background: '#f44336', padding: '12px', border: 'none', color: 'white', fontWeight: 'bold', borderRadius: '4px', cursor: timeLeft <= 0 ? 'not-allowed' : 'pointer', opacity: timeLeft <= 0 ? 0.5 : 1 }}
                            >
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
                                            {name}{blocked ? ' (티어 완료)' : ''}
                                        </option>
                                    );
                                })}
                            </select>
                            <input type="number" placeholder="입찰 포인트" className={styles.formInput} value={bidInput} onChange={(e) => setBidInput(e.target.value)} disabled={timeLeft <= 0} />
                            <button onClick={handleBid} className={styles.btnBid} disabled={timeLeft <= 0} style={{ opacity: timeLeft <= 0 ? 0.5 : 1, cursor: timeLeft <= 0 ? 'not-allowed' : 'pointer' }}>
                                {timeLeft > 0 ? '입찰하기' : '경매 대기 중'}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* [우측 구역] 실시간 타이머 + 경매 로그 */}
            <div className={styles.auctionRight}>
                {/* 실시간 공유 타이머 (진행자·참가자 모두에게 표시) */}
                <div style={{
                    textAlign: 'center',
                    fontFamily: 'monospace',
                    fontSize: '32px',
                    fontWeight: 'bold',
                    letterSpacing: '2px',
                    color: timeLeft > 0 && timeLeft <= 10 ? '#ff4c4c' : '#ff9800',
                    marginBottom: '10px',
                }}>
                    ⏱ {formatTime(timeLeft)}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                    <h3 style={{ margin: 0, fontSize: '16px', color: '#aaa' }}>실시간 경매 로그</h3>
                    {isAdmin && (
                        <button
                            onClick={onClearLogs}
                            style={{ background: '#555', color: '#fff', border: 'none', borderRadius: '3px', fontSize: '11px', padding: '3px 8px', cursor: 'pointer' }}
                        >
                            전체 삭제
                        </button>
                    )}
                </div>

                <div className={styles.auctionLogContainer}>
                    {logs.length === 0 ? (
                        <div style={{ color: '#aaa' }}>시작 대기 중...</div>
                    ) : (
                        logs.map((log) => (
                            <div key={log.id} style={{ color: '#ccc', marginBottom: '5px', lineHeight: '1.4' }}>
                                <span style={{ color: '#777', fontSize: '11px', marginRight: '5px' }}>
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
