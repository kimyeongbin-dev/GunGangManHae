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
import { useCallback, useEffect, useState } from 'react';
import { useRealtime } from '../common/hooks/useRealtime';
import { useAdminNames } from '../common/hooks/useAdminNames';
import { useParticipantCrud } from '../common/hooks/useParticipantCrud';
import { SLOT_COUNT } from '../common/types';
import { getTierBySlot, participantLabel } from '../common/utils';
import { fetchRosterNames } from '../common/data';
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/lib/toast';
import ParticipantEditModal from '../common/ui/ParticipantEditModal';
import { clickable } from '../common/a11y';
import styles from './style.module.css';
import type { Participant, ModalForm } from '../common/types';

const EMPTY_FORM: ModalForm = { p_token: '', real_name: '', tier: '1', avg_damage: '', intro: '' };
const TIERS = ['1', '2', '3', '4'];

export default function ParticipantsScreen({ isAdmin, revealNames }: { isAdmin: boolean; revealNames: boolean }) {
    const { participants } = useRealtime();
    const showReal = isAdmin && revealNames; // 진행자 실명(비제이명) 표시 여부
    const [adminNames, refreshAdminNames] = useAdminNames(isAdmin, participants);
    const displayNames = showReal ? adminNames : undefined;
    const nameOf = (p: Participant) => participantLabel(p, displayNames?.[p.p_token]);

    // 전원 공개 명단(티어 + 실명). 이름·티어만 담으므로 '지명(team_name 변경)'으로는 바뀌지 않는다.
    // ★ 의존성을 participants 전체로 두면 지명 1건마다 roster_names RPC 가 불필요하게 호출된다
    //   (statement 트리거로 인해 관전자 전원이 지명마다 refetch). 그래서 명단이 실제로 바뀌는
    //   신호 — 인원수 + 티어 분포 — 로만 재조회한다. 실명만 수정한 경우는 handleSave 가 직접 부른다.
    const rosterSig = participants.length + '|' + participants.map((p) => p.tier).sort().join('');
    const [roster, setRoster] = useState<{ tier: string; real_name: string }[]>([]);
    const reloadRoster = useCallback(() => {
        let alive = true;
        fetchRosterNames().then((r) => { if (alive) setRoster(r); });
        return () => { alive = false; };
    }, []);
    useEffect(reloadRoster, [rosterSig, reloadRoster]);

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

    // '수정' 배지: 기존 참가자 편집.
    // 실명은 진행자 secrets에서, 딜량·소갯말은 기반 테이블에서 직접 읽는다.
    // ★ 화면이 읽는 공개 뷰는 팀장의 딜량·소갯말을 null 로 가리므로(0008), 그대로 폼에 넣으면
    //   팀장을 수정할 때 값이 비어 저장 시 지워진다. 진행자는 기반 테이블 읽기 권한이 있다.
    const handleEditParticipant = async (p: Participant, slotIndex: number) => {
        const { data, error } = await supabase
            .from('participants')
            .select('avg_damage, intro')
            .eq('p_token', p.p_token)
            .maybeSingle();
        // ★ 조회 실패 시 폼을 열지 않는다. 팀장은 공개 뷰에서 딜량·소갯말이 null 이라, 실패한 채
        //   폼을 열면 빈 값으로 저장돼 소갯말이 지워질 수 있다. (세션 만료 등)
        if (error || !data) {
            toast.error('참가자 정보를 불러오지 못했습니다.\n잠시 후 다시 시도해 주세요.');
            return;
        }
        setEditForm({
            p_token: p.p_token,
            real_name: adminNames[p.p_token] ?? '',
            tier: p.tier,
            avg_damage: String(data.avg_damage ?? ''),
            intro: data.intro ?? '',
        });
        setEditSlot(slotIndex);
    };

    // 저장/삭제 후 실명 맵을 강제 재조회한다. 비제이명만 바꾼 경우는 토큰·인원이 그대로라
    // useAdminNames 의 서명이 안 변해 자동 재조회가 안 걸리기 때문(중간-2).
    const handleSave = async (form: ModalForm) => {
        const ok = await saveParticipant(form);
        if (ok) { refreshAdminNames(); reloadRoster(); }
        return ok;
    };
    const handleDelete = async (token: string) => {
        const ok = await deleteParticipant(token);
        if (ok) { refreshAdminNames(); reloadRoster(); }
        return ok;
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
                                <div key={i} className={cellClass} {...clickable(() => handleCellClick(i), p ? `${nameOf(p)}` : `${tier}티어 빈 자리에 등록`)}>
                                    {p ? (
                                        <>
                                            <span className={styles.name}>{nameOf(p)}</span>
                                            <span className={styles.dmg}>{p.avg_damage ?? '—'}</span>
                                            <div
                                                className={styles.editBadge}
                                                {...clickable(() => handleEditParticipant(p, i), `${nameOf(p)} 수정`)}
                                                onClickCapture={(e) => e.stopPropagation()}
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
                                <h3 className={styles.rosterTitle}>
                                    <span className={styles.rosterTierNum}>{tier}</span>
                                    <span className={styles.rosterTierLabel}>티어</span>
                                    <span className={styles.rosterCount}>{names.length}명</span>
                                </h3>
                                <ol className={styles.rosterList}>
                                    {names.map((r) => (
                                        <li key={r.real_name} className={styles.rosterName}>{r.real_name}</li>
                                    ))}
                                    {names.length === 0 && <li className={styles.rosterEmpty}>등록된 참가자가 없습니다</li>}
                                </ol>
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
                    onSave={handleSave}
                    onDelete={handleDelete}
                    onClose={() => setEditSlot(null)}
                />
            )}
        </div>
    );
}
