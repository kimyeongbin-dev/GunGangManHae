// components/ParticipantsScreen/index.tsx
// ---------------------------------------------------------------------------
// [렌더링] 참가자 페이지. 전체 참가자(최대 64명)를 8x8 티어색 그리드로 보여주고,
// 셀을 누르면 익명 상세정보(티어·딜량·소개글)를 팝업으로 본다.
//   · 상세 팝업은 경매 화면의 ParticipantDetailModal을 읽기 전용(isAdmin=false)으로 재사용.
//   · 실명은 진행자 실명모드(displayNames)일 때만 노출.
// 렌더 위치: page.tsx의 currentView==='participants'.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { useRealtimeAuction } from '../AuctionScreen/hooks/useRealtimeAuction';
import { useAdminNames } from '../AuctionScreen/hooks/useAdminNames';
import { SLOT_COUNT } from '../AuctionScreen/types';
import { getTierBySlot, participantLabel } from '../AuctionScreen/utils';
import ParticipantDetailModal from '../AuctionScreen/ui/ParticipantDetailModal';
import styles from './style.module.css';
import type { Participant } from '../AuctionScreen/types';

export default function ParticipantsScreen({ isAdmin, revealNames }: { isAdmin: boolean; revealNames: boolean }) {
    const { participants } = useRealtimeAuction();
    const adminNames = useAdminNames(isAdmin, participants.length);
    const displayNames = isAdmin && revealNames ? adminNames : undefined; // 실명모드에서만 실명 표시
    const nameOf = (p: Participant) => participantLabel(p, displayNames?.[p.p_token]);

    // 상세 팝업 대상은 토큰만 저장하고 실시간 목록에서 파생 → 등록/변경이 즉시 반영.
    const [viewingToken, setViewingToken] = useState<string | null>(null);
    const target = participants.find((p) => p.p_token === viewingToken) ?? null;

    return (
        <div className={styles.wrap}>
            <div className={styles.header}>
                <h2 className={styles.title}>참가자 목록 ({participants.length}명)</h2>
                <div className={styles.legend}>
                    <div className={styles.legendItem}><div className={`${styles.legendBox} ${styles.legendTier1}`}></div>1티어</div>
                    <div className={styles.legendItem}><div className={`${styles.legendBox} ${styles.legendTier2}`}></div>2티어</div>
                    <div className={styles.legendItem}><div className={`${styles.legendBox} ${styles.legendTier3}`}></div>3티어</div>
                    <div className={styles.legendItem}><div className={`${styles.legendBox} ${styles.legendTier4}`}></div>4티어</div>
                </div>
            </div>

            <div className={styles.board}>
                <div className={styles.grid}>
                    {Array.from({ length: SLOT_COUNT }).map((_, i) => {
                        const tier = getTierBySlot(i);
                        const p = participants.find((part) => part.slot_index === i);
                        const cellClass = `${styles.cell} ${styles[`tier${tier}`]} ${p ? styles.filled : ''}`;
                        return (
                            <div key={i} className={cellClass} onClick={p ? () => setViewingToken(p.p_token) : undefined}>
                                {p && (
                                    <>
                                        <span className={styles.name}>{nameOf(p)}</span>
                                        <span className={styles.dmg}>{p.avg_damage}</span>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 상세 정보 팝업 (읽기 전용: 경매 액션 숨김) */}
            {target && (
                <ParticipantDetailModal
                    target={target}
                    isAdmin={false}
                    realName={displayNames?.[target.p_token]}
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
