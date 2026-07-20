// components/ParticipantsScreen/index.tsx
// ---------------------------------------------------------------------------
// [렌더링] 참가자 페이지. 진행자·참가자 모두 '티어별 실명 명단' 카드로 같은 디자인을 본다.
//
//   · 일반 참가자/관전자 → 이름만 (호버 하이라이트). 클릭 동작 없음.
//     ★ 블라인드 유지: 명단은 roster_names() RPC에서 오는데, 서버가 (티어, 실명)만 내려주고
//       p_token·딜량·소갯말은 주지 않는다. 그래서 명단을 봐도 스네이크 화면의 익명 카드가
//       누구인지 대조할 수 없다.
//   · 진행자 → 같은 명단 + 이름 클릭 시 그 참가자 수정, 티어별 '+등록'으로 신규 추가.
//     이 목록의 실명은 어차피 전원 공개라, 진행자도 (익명 토글과 무관하게) 실명으로 본다.
//     딜량은 목록에 표시하지 않는다(수정 모달에서만 편집).
//
// 렌더 위치: page.tsx의 view==='participants'.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState } from 'react';
import { useRealtime } from '../common/hooks/useRealtime';
import { useAdminNames } from '../common/hooks/useAdminNames';
import { useParticipantCrud } from '../common/hooks/useParticipantCrud';
import { TEAM_COUNT } from '../common/types';
import { fetchRosterNames } from '../common/data';
import ParticipantEditModal from '../common/ui/ParticipantEditModal';
import { clickable } from '../common/a11y';
import styles from './style.module.css';
import type { Participant, ModalForm } from '../common/types';

const EMPTY_FORM: ModalForm = { p_token: '', real_name: '', tier: '1', avg_damage: '', intro: '' };
const TIERS = ['1', '2', '3', '4'];

export default function ParticipantsScreen({ isAdmin, revealNames }: { isAdmin: boolean; revealNames: boolean }) {
    const { participants } = useRealtime();
    const showReal = isAdmin && revealNames; // 수정 모달의 비제이명 마스킹 여부에만 쓰인다
    const [adminNames, refreshAdminNames] = useAdminNames(isAdmin, participants);

    // 진행자 목록 표시 이름: 이 목록의 실명은 전원 공개(roster_names)라, 진행자도 실명으로 본다.
    // secrets가 아직 안 온 순간엔 공개명/익명으로 폴백.
    const adminNameOf = (p: Participant) => adminNames[p.p_token] ?? p.reveal_name ?? p.fake_name;

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
    const [editOpen, setEditOpen] = useState(false);
    const [editForm, setEditForm] = useState<ModalForm>(EMPTY_FORM);

    // 신규 등록: 그 티어를 미리 채운 빈 폼. 저장 시 saveParticipant가 그 티어의 첫 빈 슬롯에 배치한다.
    const openNew = (tier: string) => {
        setEditForm({ ...EMPTY_FORM, tier });
        setEditOpen(true);
    };

    // 기존 참가자 수정: 실명은 secrets(adminNames)에서, 딜량·소갯말은 공개 뷰 값 그대로.
    // (0012 이후 뷰가 팀장 포함 전원의 딜량·소갯말을 실제값으로 주므로 별도 조회가 필요 없다.)
    const openEdit = (p: Participant) => {
        setEditForm({
            p_token: p.p_token,
            real_name: adminNames[p.p_token] ?? '',
            tier: p.tier,
            avg_damage: String(p.avg_damage),
            intro: p.intro,
        });
        setEditOpen(true);
    };

    // 저장/삭제 후 실명 맵·명단을 강제 재조회한다. 비제이명만 바꾼 경우는 토큰·인원이 그대로라
    // useAdminNames 서명이 안 변해 자동 재조회가 안 걸리기 때문.
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

            <div className={styles.roster}>
                {TIERS.map((tier) => {
                    // 진행자: 실시간 참가자(수정 가능). 참가자/관전자: 공개 명단. 둘 다 이름순 정렬.
                    const members = isAdmin
                        ? participants.filter((p) => p.tier === tier)
                            .sort((a, b) => adminNameOf(a).localeCompare(adminNameOf(b), 'ko'))
                        : [];
                    const names = isAdmin ? [] : roster.filter((r) => r.tier === tier);
                    const count = isAdmin ? members.length : names.length;
                    return (
                        <section key={tier} className={`${styles.rosterCol} ${styles[`rosterTier${tier}`]}`}>
                            <h3 className={styles.rosterTitle}>
                                <span className={styles.rosterTierNum}>{tier}</span>
                                <span className={styles.rosterTierLabel}>티어</span>
                                <span className={styles.rosterCount}>{count}명</span>
                            </h3>
                            <ol className={styles.rosterList}>
                                {isAdmin
                                    ? members.map((p) => (
                                        <li
                                            key={p.p_token}
                                            className={`${styles.rosterName} ${styles.rosterNameEdit}`}
                                            {...clickable(() => openEdit(p), `${adminNameOf(p)} 수정`)}
                                        >
                                            {adminNameOf(p)}
                                        </li>
                                    ))
                                    : names.map((r) => (
                                        <li key={r.real_name} className={styles.rosterName}>{r.real_name}</li>
                                    ))}
                                {count === 0 && !isAdmin && <li className={styles.rosterEmpty}>등록된 참가자가 없습니다</li>}
                                {isAdmin && count < TEAM_COUNT && (
                                    <li className={styles.rosterAdd} {...clickable(() => openNew(tier), `${tier}티어에 참가자 등록`)}>
                                        + 등록
                                    </li>
                                )}
                            </ol>
                        </section>
                    );
                })}
            </div>

            {/* 진행자 참가자 등록/편집 모달 */}
            {editOpen && (
                <ParticipantEditModal
                    initialForm={editForm}
                    masked={!showReal}
                    onSave={handleSave}
                    onDelete={handleDelete}
                    onClose={() => setEditOpen(false)}
                />
            )}
        </div>
    );
}
