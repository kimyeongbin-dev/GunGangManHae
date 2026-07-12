// components/ParticipantsScreen/index.tsx
// ---------------------------------------------------------------------------
// [렌더링] 참가자 페이지. 전체 참가자(최대 64명)를 8x8 티어색 그리드로 보여준다.
//   · 셀 클릭 → 익명 상세정보(티어·딜량·소개글) 팝업(읽기 전용, 모두).
//   · 진행자: 빈 칸 클릭 → 참가자 등록, 채워진 칸 '수정' 배지 → 편집 (경매 '참가자 대기석'과 동일 UX).
//   · 등록/편집/삭제는 경매의 useTeamManagement.saveParticipant/deleteParticipant 재사용.
//   · 실명은 진행자 실명모드(displayNames)일 때만 노출.
// 렌더 위치: page.tsx의 currentView==='participants'.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { useRealtimeAuction } from '../AuctionScreen/hooks/useRealtimeAuction';
import { useAdminNames } from '../AuctionScreen/hooks/useAdminNames';
import { useTeamManagement } from '../AuctionScreen/hooks/useTeamManagement';
import { SLOT_COUNT } from '../AuctionScreen/types';
import { getTierBySlot, participantLabel } from '../AuctionScreen/utils';
import ParticipantDetailModal from '../AuctionScreen/ui/ParticipantDetailModal';
import ParticipantEditModal from '../AuctionScreen/ui/ParticipantEditModal';
import styles from './style.module.css';
import type { Participant, ModalForm } from '../AuctionScreen/types';

const EMPTY_FORM: ModalForm = { p_token: '', real_name: '', tier: '1', avg_damage: '', intro: '' };

export default function ParticipantsScreen({ isAdmin, revealNames }: { isAdmin: boolean; revealNames: boolean }) {
    const { participants, auctionBids } = useRealtimeAuction();
    const showReal = isAdmin && revealNames; // 실명(비제이명) 표시 여부
    const adminNames = useAdminNames(isAdmin, participants.length);
    const displayNames = showReal ? adminNames : undefined;
    const nameOf = (p: Participant) => participantLabel(p, displayNames?.[p.p_token]);

    // 등록/편집/삭제는 경매의 팀관리 훅을 재사용(여기선 참가자 CRUD만 쓴다).
    const team = useTeamManagement({ participants, auctionBids, auctionTarget: null, auctionRunning: false, isAdmin });

    // 상세 팝업 대상은 토큰만 저장하고 실시간 목록에서 파생.
    const [viewingToken, setViewingToken] = useState<string | null>(null);
    const target = participants.find((p) => p.p_token === viewingToken) ?? null;

    // 등록/편집 모달 대상 슬롯 + 폼.
    const [editSlot, setEditSlot] = useState<number | null>(null);
    const [editForm, setEditForm] = useState<ModalForm>(EMPTY_FORM);

    // 셀 클릭: 채워진 칸은 상세 보기, 빈 칸은 진행자만 신규 등록.
    const handleCellClick = (slotIndex: number) => {
        const p = participants.find((part) => part.slot_index === slotIndex);
        if (p) {
            setViewingToken(p.p_token);
        } else if (isAdmin) {
            setEditForm({ ...EMPTY_FORM, tier: getTierBySlot(slotIndex) });
            setEditSlot(slotIndex);
        }
    };

    // '수정' 배지: 기존 참가자 편집(실명은 진행자 secrets에서 채운다).
    const handleEditParticipant = (p: Participant, slotIndex: number) => {
        setEditForm({
            p_token: p.p_token,
            real_name: adminNames[p.p_token] ?? '',
            tier: p.tier,
            avg_damage: p.avg_damage.toString(),
            intro: p.intro || '',
        });
        setEditSlot(slotIndex);
    };

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
                        const clickable = !!p || isAdmin; // 채워진 칸(상세) 또는 진행자 빈 칸(등록)
                        const cellClass = `${styles.cell} ${styles[`tier${tier}`]} ${clickable ? styles.filled : ''}`;
                        return (
                            <div key={i} className={cellClass} onClick={() => handleCellClick(i)}>
                                {p ? (
                                    <>
                                        <span className={styles.name}>{nameOf(p)}</span>
                                        <span className={styles.dmg}>{p.avg_damage}</span>
                                        {isAdmin && (
                                            <div
                                                className={styles.editBadge}
                                                onClick={(e) => { e.stopPropagation(); handleEditParticipant(p, i); }}
                                            >
                                                수정
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    isAdmin && <span className={styles.addHint}>+ 등록</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 상세 정보 팝업 (읽기 전용) */}
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

            {/* 진행자 참가자 등록/편집 모달 */}
            {editSlot !== null && (
                <ParticipantEditModal
                    initialForm={editForm}
                    masked={!showReal}
                    onSave={team.saveParticipant}
                    onDelete={team.deleteParticipant}
                    onClose={() => setEditSlot(null)}
                />
            )}
        </div>
    );
}
