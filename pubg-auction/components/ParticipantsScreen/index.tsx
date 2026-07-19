// components/ParticipantsScreen/index.tsx
// ---------------------------------------------------------------------------
// [렌더링] 참가자 페이지. 화면이 보는 사람에 따라 둘로 갈린다.
//
//   · 일반 참가자/관전자 → 티어별 '실명 명단'만. 이름 외에는 아무것도 보여주지 않는다.
//     ★ 블라인드 유지: 명단은 roster_names() RPC에서 오는데, 서버가 (티어, 실명)만 내려주고
//       p_token·딜량·소갯말은 주지 않는다. 그래서 명단을 봐도 스네이크 화면의 익명 카드가
//       누구인지 대조할 수 없다(딜량이 보이면 숫자로 매칭되므로 함께 숨긴다).
//   · 진행자 → 기존 8x8 슬롯 그리드. 빈 칸 클릭으로 등록, '수정' 배지로 편집/삭제.
//     (진행자는 어차피 secrets로 실명을 볼 수 있는 권한자다)
//
// 렌더 위치: page.tsx의 view==='participants'.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { useRealtime } from '../common/hooks/useRealtime';
import { useAdminNames } from '../common/hooks/useAdminNames';
import { useParticipantCrud } from '../common/hooks/useParticipantCrud';
import { SLOT_COUNT } from '../common/types';
import { getTierBySlot, participantLabel } from '../common/utils';
import { fetchRosterNames } from '../common/data';
import ParticipantEditModal from '../common/ui/ParticipantEditModal';
import styles from './style.module.css';
import type { Participant, ModalForm } from '../common/types';

const EMPTY_FORM: ModalForm = { p_token: '', real_name: '', tier: '1', avg_damage: '', intro: '' };
const TIERS = ['1', '2', '3', '4'];

export default function ParticipantsScreen({ isAdmin, revealNames }: { isAdmin: boolean; revealNames: boolean }) {
    const { participants } = useRealtime();
    const showReal = isAdmin && revealNames; // 진행자 실명(비제이명) 표시 여부
    const adminNames = useAdminNames(isAdmin, participants.length);
    const displayNames = showReal ? adminNames : undefined;
    const nameOf = (p: Participant) => participantLabel(p, displayNames?.[p.p_token]);

    // 전원 공개 명단(티어 + 실명). 참가자가 바뀌면(등록/수정/삭제) 다시 불러온다.
    // participants 배열은 실시간 변경이 있을 때만 새 객체가 되므로 이 의존성으로도 요청이 폭주하지 않는다.
    const [roster, setRoster] = useState<{ tier: string; real_name: string }[]>([]);
    useEffect(() => {
        fetchRosterNames().then(setRoster);
    }, [participants]);

    // 등록/편집/삭제(진행자 전용).
    const { saveParticipant, deleteParticipant } = useParticipantCrud(participants);

    // 등록/편집 모달 대상 슬롯 + 폼.
    const [editSlot, setEditSlot] = useState<number | null>(null);
    const [editForm, setEditForm] = useState<ModalForm>(EMPTY_FORM);

    // 진행자 그리드의 빈 칸 클릭 → 신규 등록.
    const handleCellClick = (slotIndex: number) => {
        if (!isAdmin || participants.some((p) => p.slot_index === slotIndex)) return;
        setEditForm({ ...EMPTY_FORM, tier: getTierBySlot(slotIndex) });
        setEditSlot(slotIndex);
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
                    {TIERS.map((t) => (
                        <div key={t} className={styles.legendItem}>
                            <div className={`${styles.legendBox} ${styles[`legendTier${t}`]}`}></div>{t}티어
                        </div>
                    ))}
                </div>
            </div>

            {isAdmin ? (
                // 진행자: 8x8 슬롯 그리드 (등록/수정)
                <div className={styles.board}>
                    <div className={styles.grid}>
                        {Array.from({ length: SLOT_COUNT }).map((_, i) => {
                            const tier = getTierBySlot(i);
                            const p = participants.find((part) => part.slot_index === i);
                            const cellClass = `${styles.cell} ${styles[`tier${tier}`]} ${p ? '' : styles.clickable}`;
                            return (
                                <div key={i} className={cellClass} onClick={() => handleCellClick(i)}>
                                    {p ? (
                                        <>
                                            <span className={styles.name}>{nameOf(p)}</span>
                                            <span className={styles.dmg}>{p.avg_damage}</span>
                                            <div
                                                className={styles.editBadge}
                                                onClick={(e) => { e.stopPropagation(); handleEditParticipant(p, i); }}
                                            >
                                                수정
                                            </div>
                                        </>
                                    ) : (
                                        <span className={styles.addHint}>+ 등록</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                // 참가자/관전자: 티어별 실명 명단 (이름만)
                <div className={styles.roster}>
                    {TIERS.map((tier) => {
                        const names = roster.filter((r) => r.tier === tier);
                        return (
                            <section key={tier} className={`${styles.rosterCol} ${styles[`rosterTier${tier}`]}`}>
                                <h3 className={styles.rosterTitle}>{tier}티어 <span className={styles.rosterCount}>({names.length}명)</span></h3>
                                <ul className={styles.rosterList}>
                                    {names.map((r) => (
                                        <li key={r.real_name} className={styles.rosterName}>{r.real_name}</li>
                                    ))}
                                </ul>
                            </section>
                        );
                    })}
                </div>
            )}

            {/* 진행자 참가자 등록/편집 모달 */}
            {editSlot !== null && (
                <ParticipantEditModal
                    initialForm={editForm}
                    masked={!showReal}
                    onSave={saveParticipant}
                    onDelete={deleteParticipant}
                    onClose={() => setEditSlot(null)}
                />
            )}
        </div>
    );
}
