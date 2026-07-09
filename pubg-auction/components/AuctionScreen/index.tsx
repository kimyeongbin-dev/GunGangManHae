// components/AuctionScreen/index.tsx
import { useState } from 'react';
import styles from './style.module.css';

type Participant = {
    slot_index: number;
    p_token: string;
    real_name: string;
    fake_name: string;
    tier: string;
    avg_damage: number;
    intro: string;
    team_name: string | null;
};

const mockParticipants: Participant[] = Array.from({ length: 64 }, (_, i) => {
    const row = Math.floor(i / 16);
    let tier = "1";
    if (row === 1) tier = "2";
    if (row === 2) tier = "3";
    if (row === 3) tier = "4";

    return {
        slot_index: i,
        p_token: `p_${i}`,
        real_name: `실명${i}`,
        fake_name: `익명${i}`,
        tier: tier,
        avg_damage: (i * 10) % 300 + 50,
        intro: "잘 부탁드립니다.",
        team_name: null,
    };
});

export default function AuctionScreen({ isAdmin }: { isAdmin: boolean }) {
    const [participants, setParticipants] = useState<Participant[]>(mockParticipants);
    const [auctionTarget, setAuctionTarget] = useState<Participant | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedSlot, setSelectedSlot] = useState<number | null>(null);

    const getTierBySlot = (slotIndex: number) => {
        const row = Math.floor(slotIndex / 16);
        if (row === 0) return "1";
        if (row === 1) return "2";
        if (row === 2) return "3";
        if (row === 3) return "4";
        return "1";
    };

    const handleCellClick = (slotIndex: number) => {
        const p = participants.find(part => part.slot_index === slotIndex);
        if (p) {
            if (!p.team_name) {
                setAuctionTarget(p);
            } else {
                alert('이미 팀 배정이 완료된 참가자입니다.');
            }
        } else {
            if (isAdmin) {
                setSelectedSlot(slotIndex);
                setIsModalOpen(true);
            }
        }
    };

    return (
        <div className={styles.container}>
            {/* 좌측 패널 */}
            <div className={styles.leftPanel}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignitm: 'center', marginBottom: '10px' }}>
                    <h3 style={{ margin: 0, fontSize: '16px' }}>미배정 참가자 목록 (16x4 대기석)</h3>
                    <div className={styles.gridLegend}>
                        <div className={styles.legendItem}><div className={styles.legendBox} style={{ background: '#ff9800' }}></div>1티어</div>
                        <div className={styles.legendItem}><div className={styles.legendBox} style={{ background: '#2196f3' }}></div>2티어</div>
                        <div className={styles.legendItem}><div className={styles.legendBox} style={{ background: '#4caf50' }}></div>3티어</div>
                        <div className={styles.legendItem}><div className={styles.legendBox} style={{ background: '#9e9e9e' }}></div>4티어</div>
                    </div>
                </div>
                
                <div className={styles.gridContainer}>
                    {Array.from({ length: 64 }).map((_, i) => {
                        const tier = getTierBySlot(i);
                        const p = participants.find(part => part.slot_index === i);
                        const cellClass = `${styles.gridCell} ${styles[`tier${tier}`]} ${p ? styles.occupied : ''} ${p?.team_name ? styles.assigned : ''}`;
                        
                        return (
                            <div key={i} className={cellClass} onClick={() => handleCellClick(i)}>
                                {p && (
                                    <>
                                        <span className={styles.nickText}>{p.fake_name}</span>
                                        <span className={styles.damageText}>{p.avg_damage}</span>
                                        {isAdmin && (
                                            <div 
                                                className={styles.editBadge}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedSlot(i);
                                                    setIsModalOpen(true);
                                                }}
                                            >
                                                수정
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 우측 패널 */}
            <div className={styles.rightPanel}>
                <div className={styles.auctionBoard}>
                    <h3 style={{ margin: '5px 0', fontSize: '16px' }}>경매 진행 창</h3>
                    
                    {auctionTarget ? (
                        <div className={styles.targetCard}>
                            <h2>{isAdmin ? `${auctionTarget.fake_name} (${auctionTarget.real_name})` : auctionTarget.fake_name}</h2>
                            <p><strong>티어:</strong> {auctionTarget.tier}티어 | <strong>평균 딜량:</strong> {auctionTarget.avg_damage}</p>
                            <p style={{ background: '#333', padding: '10px', borderRadius: '4px', fontStyle: 'italic', fontSize: '13px', textAlign: 'left', margin: '10px 0 0 0' }}>
                                {auctionTarget.intro}
                            </p>
                        </div>
                    ) : (
                        <div className={styles.targetCard}>
                            <h2 style={{ color: '#888' }}>대기 중</h2>
                            <p style={{ margin: 0 }}>참가자를 선택하세요.</p>
                        </div>
                    )}
                    
                    <div style={{ margin: '10px 0', fontSize: '14px' }}>
                        경매 경과 시간: <span style={{ color: '#ff9800', fontWeight: 'bold' }}>00:00</span>
                        <div style={{ fontWeight: 'bold', color: '#ff9800', marginTop: '5px' }}>현재 최고가: 0P</div>
                    </div>

                    <div className={styles.formGroup} style={{ marginTop: '15px' }}>
                        {isAdmin && (
                            <button style={{ background: '#2196f3', marginBottom: '10px', padding: '10px', border: 'none', color: 'white', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>
                                경매 시작 (진행자 전용)
                            </button>
                        )}
                        
                        <select className={styles.formSelect}>
                            <option value="">팀을 선택하세요</option>
                            {Array.from({ length: 16 }).map((_, i) => (
                                <option key={i} value={`${i + 1}팀`}>{i + 1}팀</option>
                            ))}
                        </select>
                        
                        <input type="number" placeholder="입찰 포인트" className={styles.formInput} />
                        
                        <div style={{ display: 'flex', gap: '5px', marginTop: '5px' }}>
                            <button style={{ flex: 1, padding: '10px', background: '#e0e0e0', border: 'none', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer', color: '#333' }}>입찰하기</button>
                            <button style={{ flex: 1, background: '#4caf50', padding: '10px', border: 'none', color: 'white', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>최종 낙찰</button>
                        </div>
                    </div>
                    
                    <div style={{ height: '80px', overflowY: 'auto', background: '#111', fontSize: '11px', marginTop: '10px', border: '1px solid #444', padding: '5px' }}>
                        <div style={{ color: '#aaa' }}>[경매 로그] 시작 대기 중...</div>
                    </div>
                </div>

                <div className={styles.teamListPanel}>
                    <h3 style={{ margin: '5px 0', fontSize: '16px' }}>팀 확정 엔트리 현황</h3>
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
                            {Array.from({ length: 16 }).map((_, i) => {
                                const teamName = `${i + 1}팀`;
                                const members = participants.filter(p => p.team_name === teamName);
                                
                                const renderMember = (m?: Participant) => {
                                    if (!m) return <span className={styles.emptyMember}>공석</span>;
                                    return isAdmin ? `${m.fake_name}(${m.real_name})` : m.fake_name;
                                };

                                return (
                                    <tr key={i}>
                                        <td className={`${styles.teamTd} ${styles.teamIdentity}`}>[{teamName}] <span className={styles.teamPts}>0 pts</span></td>
                                        <td className={`${styles.teamTd} ${styles.teamMemberCell}`}>{renderMember(members.find(p => p.tier === "1"))}</td>
                                        <td className={`${styles.teamTd} ${styles.teamMemberCell}`}>{renderMember(members.find(p => p.tier === "2"))}</td>
                                        <td className={`${styles.teamTd} ${styles.teamMemberCell}`}>{renderMember(members.find(p => p.tier === "3"))}</td>
                                        <td className={`${styles.teamTd} ${styles.teamMemberCell}`}>{renderMember(members.find(p => p.tier === "4"))}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* 모달 */}
            {isModalOpen && (
                <div className={styles.modal}>
                    <div className={styles.modalContent}>
                        <h3>참가자 관리 (슬롯: {selectedSlot})</h3>
                        <div className={styles.formGroup}>
                            <label style={{ fontSize: '14px', marginBottom: '2px' }}>실명</label>
                            <input type="text" placeholder="예: 홍길동" className={styles.formInput} />
                        </div>
                        <div className={styles.formGroup}>
                            <label style={{ fontSize: '14px', marginBottom: '2px' }}>익명 (식별 닉네임)</label>
                            <input type="text" placeholder="예: 참가자A" className={styles.formInput} />
                        </div>
                        <div className={styles.formGroup}>
                            <label style={{ fontSize: '14px', marginBottom: '2px' }}>평균 딜량</label>
                            <input type="number" placeholder="예: 250" className={styles.formInput} />
                        </div>
                        <div className={styles.formGroup}>
                            <label style={{ fontSize: '14px', marginBottom: '2px' }}>소갯말</label>
                            <input type="text" placeholder="한 줄 소갯말을 입력하세요" className={styles.formInput} />
                        </div>
                        
                        <div className={styles.modalButtons}>
                            <button style={{ background: '#4caf50' }}>저장</button>
                            <button style={{ background: '#555' }} onClick={() => setIsModalOpen(false)}>취소</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}