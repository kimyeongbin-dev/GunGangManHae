// components/SnakeScreen/index.tsx
// ---------------------------------------------------------------------------
// [렌더링] 스네이크 드래프트 화면. 이 앱의 팀 편성 방식.
//
// 흐름:
//   1) 진행자가 '팀장 추첨' 화면에서 팀장 티어를 골라(또는 랜덤) 추첨하면 그 티어 16명이 팀장이 된다.
//      (팀장은 실명 공개, 나머지 픽 참가자는 결과까지 익명.)
//   2) 남은 3개 티어를 채운다. 진행자가 좌측 티어 탭에서 지금 뽑을 티어를 고르고, 4x4 그리드에서
//      참가자를 클릭 → 상세 팝업의 '지명' 버튼으로 등록한다. 우측 편성표의 × 로 취소.
//   · ★ 진행 티어(active_tier)는 공유된다 — 진행자가 고른 티어가 곧 '지금 뽑는 티어'이고,
//     그래야 편성표의 '지명 대기'가 전원에게 같은 칸으로 보인다.
//     참가자는 그와 별개로 좌측 탭에서 아무 티어나 자유롭게 열람할 수 있다(로컬 보기).
//   · 지그재그 방향은 '이미 다 찬 티어 수'로 계산돼 저장이 필요 없다 — snakeOrder.ts 참고.
//   · 순서를 바꾸고 싶으면 '뽑기 순서 리롤'로 팀 번호를 통째로 재배열한다(뽑힌 팀원도 함께 이동).
//
// ★ 동시성(중복 등록 방지):
//   · lockRef : 등록/취소를 한 번에 하나씩만 처리(연타로 여러 명이 같은 칸에 배정돼 사라지는 문제 차단).
//     React state는 클로저가 옛 값을 보므로 동기 ref로 잠근다.
//   · optimistic : 방금 누른 픽을 실시간 수신 전에 화면에 즉시 반영 → 풀에서 바로 사라지고 차례가 전진.
//     participants(서버 실측)가 따라잡으면 cleanup 훅이 항목을 비운다.
// 렌더 위치: page.tsx의 view==='snake'.
// ---------------------------------------------------------------------------
import { useState, useRef, useEffect } from 'react';
import { useRealtime } from '../common/hooks/useRealtime';
import { useAdminNames } from '../common/hooks/useAdminNames';
import { TEAM_COUNT } from '../common/types';
import { participantLabel } from '../common/utils';
import { supabase } from '@/lib/supabaseClient';
import { confirmDialog } from '@/lib/toast';
import fonts from '../typography.module.css';
import styles from './style.module.css';
import { ALL_TIERS, remainingTiers, memberAt, currentTeamFor, isTierDone } from './snakeOrder';
import {
    assignSnakePick, cancelSnakePick, resetSnakeTier, fillTierRandomly,
    rerollTeamOrder, fetchActiveTier, saveActiveTier,
} from './snakeActions';
import ParticipantDetailModal from '../common/ui/ParticipantDetailModal';
import type { Participant } from '../common/types';

export default function SnakeScreen({ isAdmin, revealNames }: { isAdmin: boolean; revealNames: boolean }) {
    const { participants } = useRealtime();
    const showReal = isAdmin && revealNames; // 실명(비제이명) 표시 여부
    const adminNames = useAdminNames(isAdmin, participants.length);
    const displayNames = showReal ? adminNames : undefined;
    const nameOf = (p: Participant) => participantLabel(p, displayNames?.[p.p_token]);

    // 낙관적 배정 오버레이 { p_token: team_name | null }. null = 방금 취소(미배정 강제).
    // 실시간 수신 전 화면에 먼저 반영하고, 서버가 따라잡으면 아래 effect가 비운다.
    const [optimistic, setOptimistic] = useState<Record<string, string | null>>({});
    const [viewingToken, setViewingToken] = useState<string | null>(null); // 상세 팝업 대상(그리드 셀 클릭)
    const [viewTier, setViewTier] = useState<string | null>(null);         // 내가 보고 있는 티어(로컬 열람)
    const [activeTier, setActiveTier] = useState<string | null>(null);     // 지금 뽑는 티어(진행자가 정해 공유)
    const lockRef = useRef(false); // 등록/취소 직렬화(동기 잠금)

    // 진행 티어 구독: 진행자가 티어 탭을 바꾸면 전원의 '지명 대기' 표시가 함께 움직인다.
    // ★ 구독 콜백은 activeTier(=차례)만 갱신하고 viewTier(=내가 보는 화면)는 건드리지 않는다.
    //   진행자가 티어를 옮겼다고 남의 그리드까지 갈아치우면, 보고 있던 참가자 화면이 갑자기 바뀐다.
    //   최초 진입 때만 내 그리드를 그때의 진행 티어에 맞춰 두고, 이후로는 각자 탭으로 정한다.
    useEffect(() => {
        fetchActiveTier().then((t) => {
            setActiveTier(t);
            if (t) setViewTier((v) => v ?? t); // 첫 로드 1회에 한해 맞춤(이미 고른 게 있으면 존중)
        });
        const channel = supabase
            .channel('active_tier_changes')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'page_state' },
                (payload) => setActiveTier((payload.new as { active_tier: string | null }).active_tier ?? null),
            )
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, []);

    // 서버 실측이 낙관값을 반영하면 해당 항목 제거(안 그러면 취소가 안 먹는 등 stale 발생).
    useEffect(() => {
        setOptimistic((prev) => {
            const next = { ...prev };
            let changed = false;
            for (const token of Object.keys(prev)) {
                const real = participants.find((p) => p.p_token === token);
                if (real && (real.team_name ?? null) === prev[token]) {
                    delete next[token];
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [participants]);

    // 낙관값을 얹은 실효 참가자 목록. 모든 파생 계산은 이걸 기준으로 한다.
    const merged = participants.map((p) =>
        p.p_token in optimistic ? { ...p, team_name: optimistic[p.p_token] } : p,
    );
    const viewingTarget = merged.find((p) => p.p_token === viewingToken) ?? null;

    // 팀장 티어 판별. 스네이크는 '한 티어 전체가 팀장'인 구성만 유효하다.
    //  · 팀장 0명 → 아직 추첨 전(스켈레톤) / 1개 티어 → 정상 / 2개 이상 티어 → 안내만.
    const leaderTierSet = new Set(merged.filter((p) => p.is_leader).map((p) => p.tier));
    const leaderTier = leaderTierSet.size === 1 ? [...leaderTierSet][0] : null;
    const mixedLeaders = leaderTierSet.size > 1;

    const rest = leaderTier ? remainingTiers(leaderTier) : [];
    const firstUnfinished = rest.find((t) => !isTierDone(merged, t));

    // 지금 뽑는 티어(전원 공유). 진행자가 아직 안 골랐거나 고른 티어가 다 찼으면 안 끝난 첫 티어로 넘어간다
    // (마지막 한 명을 뽑는 순간 차례가 자동으로 다음 티어로 이동).
    const activeUsable = activeTier && rest.includes(activeTier) && !isTierDone(merged, activeTier);
    const turnTier = (activeUsable ? activeTier : null) ?? firstUnfinished ?? null;
    // 그 티어의 현재 차례 팀 = 순서상 아직 비어 있는 첫 칸. 전원에게 같은 값이다.
    const currentTeam = leaderTier && turnTier ? currentTeamFor(merged, leaderTier, turnTier) : null;

    // 좌측 그리드에 표시할 티어. 내가 탭으로 고른 티어가 최우선.
    // ★ 아직 안 골랐을 때의 기본값이 turnTier면 안 된다 — 진행자가 티어를 옮길 때마다 남의 그리드가
    //   따라 점프하기 때문. 진행자 본인은 '보는 화면 = 뽑는 티어'라 turnTier를 따르고,
    //   참가자는 움직이지 않는 값(첫 티어)을 기본으로 둔다. 공유되는 건 '지금 차례'뿐이다.
    const gridTier = viewTier ?? (isAdmin ? turnTier : rest[0]) ?? null;
    const viewingTurnTier = gridTier === turnTier; // 지금 보는 티어가 진행 중인 티어인가

    const tierPool = gridTier
        ? merged.filter((p) => p.tier === gridTier).sort((a, b) => a.slot_index - b.slot_index)
        : [];
    const remaining = tierPool.filter((p) => !p.team_name).length;

    // 진행 현황(팀장 제외 픽 수 / 남은 티어 × 팀 수).
    const pickedCount = merged.filter((p) => p.team_name && !p.is_leader).length;
    const totalPicks = rest.length * TEAM_COUNT;
    const allDone = !!leaderTier && pickedCount === totalPicks;

    // 상세 팝업의 '지명' 가능 여부(진행자 · 지금 뽑는 티어 · 미배정 · 팀장 아님).
    const canPickViewing =
        isAdmin && !!currentTeam && !!viewingTarget && !viewingTarget.team_name
        && !viewingTarget.is_leader && viewingTarget.tier === turnTier;

    // 티어 탭 클릭. 진행자가 누르면 '지금 뽑는 티어'가 되어 전원에게 공유되고,
    // 참가자가 누르면 자기 화면의 열람 티어만 바뀐다.
    const handleSelectTier = async (tier: string) => {
        setViewTier(tier);
        if (isAdmin && tier !== leaderTier && tier !== activeTier) await saveActiveTier(tier);
    };

    // [진행자] 지명: 현재 차례 팀에 배정. lockRef로 한 번에 하나만 처리(연타 방지).
    const handlePick = async (p: Participant) => {
        if (!isAdmin || lockRef.current || !currentTeam || p.tier !== turnTier || p.team_name || p.is_leader) return;
        lockRef.current = true;
        setOptimistic((o) => ({ ...o, [p.p_token]: currentTeam })); // 즉시 반영
        const ok = await assignSnakePick(p.p_token, currentTeam);
        if (!ok) setOptimistic((o) => { const n = { ...o }; delete n[p.p_token]; return n; }); // 실패 시 롤백
        lockRef.current = false;
    };

    // [진행자] 지명 취소(편성표 × · 상세 팝업 버튼 공용). 확인 후 직렬화 + 즉시 반영.
    // 확인창은 잠금을 잡기 전에 띄운다 — 응답을 기다리는 동안 다른 조작까지 묶이면 안 되기 때문.
    const handleCancel = async (p: Participant) => {
        if (!isAdmin || lockRef.current) return;
        const team = p.team_name;
        if (!(await confirmDialog(`${nameOf(p)}의 지명을 취소할까요?\n${team} 배정이 해제됩니다.`))) return;
        if (lockRef.current) return; // 확인을 기다리는 사이 다른 작업이 잠금을 잡았을 수 있다
        lockRef.current = true;
        setOptimistic((o) => ({ ...o, [p.p_token]: null }));
        const ok = await cancelSnakePick(p.p_token);
        if (!ok) setOptimistic((o) => { const n = { ...o }; delete n[p.p_token]; return n; });
        lockRef.current = false;
    };

    // [진행자] 티어별 초기화: 그 티어에서 뽑은 픽을 모두 되돌린다.
    const handleResetTier = async (tier: string) => {
        if (!(await confirmDialog(`${tier}티어에 배정된 팀원을 모두 초기화할까요?`))) return;
        setOptimistic({});
        await resetSnakeTier(tier);
    };

    // [진행자] 티어 랜덤 배치: 그 티어 16명을 통째로 다시 섞어 1~16팀에 배치.
    // 이미 지명된 칸도 함께 다시 돌아가므로, 마음에 안 들면 다시 눌러 재추첨할 수 있다.
    const handleFillRandomly = async (tier: string) => {
        if (!(await confirmDialog(`${tier}티어 16명을 무작위로 배치할까요?\n이미 지명된 팀원도 모두 다시 섞입니다(다시 누르면 또 섞임).`))) return;
        setOptimistic({});
        await fillTierRandomly(tier, merged);
    };

    // [진행자] 뽑기 순서 리롤: 팀 번호를 통째로 재배열한다.
    // 팀장과 이미 뽑힌 팀원이 한 팀으로 묶인 채 옮겨가므로 기존 구성은 그대로 유지된다.
    const handleRerollOrder = async () => {
        const msg = pickedCount > 0
            ? `뽑기 순서를 다시 섞을까요?\n이미 뽑은 팀원 ${pickedCount}명은 팀장과 함께 그대로 따라갑니다(구성 유지).`
            : '뽑기 순서를 다시 섞을까요?\n누가 먼저 뽑는지가 바뀝니다.';
        if (!(await confirmDialog(msg))) return;
        setOptimistic({});
        await rerollTeamOrder(merged);
    };

    // [진행자] 상세 팝업의 '지명' → 현재 차례 팀에 배정하고 팝업 닫기(그리드 직접 클릭 대신 2단계로 실수 방지).
    const handlePickFromModal = async () => {
        if (!viewingTarget) return;
        const p = viewingTarget;
        setViewingToken(null);
        await handlePick(p);
    };

    // [진행자] 상세 팝업의 '지명 취소' → 편성표 × 와 같은 동작. 그리드에서 바로 누른 경우를 위해 여기에도 둔다.
    const handleCancelFromModal = async () => {
        if (!viewingTarget) return;
        const p = viewingTarget;
        setViewingToken(null);
        await handleCancel(p);
    };

    return (
        <div className={styles.wrap}>
            <div className={styles.header}>
                <h2 className={styles.title}>
                    스네이크 팀 뽑기
                    {leaderTier && <span className={`${fonts.drawCount} ${styles.count}`}> · 팀장 {leaderTier}티어 · {pickedCount}/{totalPicks} 픽</span>}
                </h2>
            </div>

            {mixedLeaders ? (
                <div className={styles.notice}>
                    현재 팀장이 여러 티어에 걸쳐 있어 스네이크 편성을 표시할 수 없습니다.
                    {isAdmin ? ' “팀장 추첨”에서 팀장 티어를 골라 다시 추첨해 주세요.' : ''}
                </div>
            ) : (
            <div className={styles.body}>
                {/* 좌측: 선택한 티어 16명(4x4). 팀장 추첨 전엔 ? 스켈레톤. */}
                <div className={styles.leftPanel}>
                    {/* 티어 탭. 진행자에게는 이게 곧 '지금 뽑을 티어' 선택(공유)이고, 참가자에게는 열람 전환이다.
                        ● = 지금 진행 중인 티어(전원 동일), ✓ = 다 채운 티어. */}
                    <div className={styles.tierTabs}>
                        {ALL_TIERS.map((t) => (
                            <button
                                key={t}
                                onClick={() => handleSelectTier(t)}
                                className={`${styles.tierTab} ${gridTier === t ? styles.tierTabActive : ''}`}
                            >
                                {t}티어
                                {t === leaderTier ? ' (팀장)' : t === turnTier ? ' ●' : isTierDone(merged, t) ? ' ✓' : ''}
                            </button>
                        ))}
                    </div>

                    <div className={`${fonts.sectionTitle} ${styles.panelTitle}`}>
                        {!leaderTier ? (
                            <span className={styles.turnHint}>팀장 추첨 전{isAdmin ? ' — “팀장 추첨”에서 팀장 티어를 골라 주세요' : ''}</span>
                        ) : allDone ? (
                            <span className={styles.done}>스네이크 드래프트 완료! 🎉</span>
                        ) : gridTier === leaderTier ? (
                            <span className={styles.turnHint}>{gridTier}티어 — 팀장 명단</span>
                        ) : viewingTurnTier && currentTeam ? (
                            <>현재 차례 <b className={styles.turnTeam}>{currentTeam}</b> · <b>{gridTier}티어</b> <span className={styles.turnHint}>(남은 {remaining}명{isAdmin ? ' · 클릭해 지명' : ''})</span></>
                        ) : gridTier && isTierDone(merged, gridTier) ? (
                            <span className={styles.done}>{gridTier}티어 완료 ✓</span>
                        ) : (
                            <span className={styles.turnHint}>
                                {gridTier}티어 열람 중 — 지금 차례는 <b className={styles.turnTeam}>{currentTeam}</b> · {turnTier}티어
                            </span>
                        )}
                    </div>

                    {gridTier ? (
                        <div className={styles.tierGrid}>
                            {tierPool.map((p) => {
                                const available = !p.team_name;
                                const pickable = isAdmin && available && !!currentTeam && viewingTurnTier; // 지금 뽑는 티어에서만 지명
                                const cellClass = [
                                    styles.cell,
                                    styles[`cellTier${gridTier}`],
                                    available ? '' : styles.taken,
                                    pickable ? styles.pickable : styles.viewable, // 지명 불가 셀은 클릭 시 상세 보기
                                ].filter(Boolean).join(' ');
                                return (
                                    <div
                                        key={p.p_token}
                                        className={cellClass}
                                        onClick={() => setViewingToken(p.p_token)}
                                        title={available ? '' : `${nameOf(p)} → ${p.team_name}`}
                                    >
                                        <span className={styles.cellName}>{nameOf(p)}</span>
                                        <span className={styles.cellDmg}>{p.avg_damage}</span>
                                        {!available && <span className={styles.cellTeam}>{p.team_name}</span>}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className={styles.tierGrid}>
                            {Array.from({ length: TEAM_COUNT }).map((_, i) => (
                                <div key={i} className={`${styles.cell} ${styles.cellSkel}`}>?</div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 가운데: 진행자 도구 (티어 랜덤 배치 · 티어별 초기화 / 팀장 티어 자리는 순서 리롤) */}
                <div className={styles.midPanel}>
                    {isAdmin && leaderTier && (
                        <>
                            {gridTier && gridTier !== leaderTier && (
                                <button onClick={() => handleFillRandomly(gridTier)} className={styles.fillBtn}>
                                    {gridTier}티어 랜덤 배치
                                </button>
                            )}

                            <div className={styles.rerollGroup}>
                                {ALL_TIERS.map((t) => (
                                    // 팀장 티어는 초기화 대상이 아니므로, 그 자리를 '뽑기 순서 리롤'로 쓴다.
                                    t === leaderTier ? (
                                        <button key={t} onClick={handleRerollOrder} className={styles.toolBtn}>
                                            뽑기 순서 리롤
                                        </button>
                                    ) : (
                                        <button key={t} onClick={() => handleResetTier(t)} className={styles.rerollBtn}>
                                            {t}티어 초기화
                                        </button>
                                    )
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* 우측: 팀 편성 표 (팀명 | 1~4티어). 팀장 추첨 전엔 공석 스켈레톤. */}
                <div className={styles.rightPanel}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th className={`${styles.th} ${styles.thTeam}`}>팀명</th>
                                {ALL_TIERS.map((t) => (
                                    <th key={t} className={styles.th}>
                                        {t}티어{t === leaderTier ? ' (팀장)' : ''}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from({ length: TEAM_COUNT }).map((_, i) => {
                                const teamName = `${i + 1}팀`;
                                return (
                                    <tr key={i}>
                                        <td className={`${styles.td} ${styles.teamName}`}>{teamName}</td>
                                        {ALL_TIERS.map((tier) => {
                                            // 팀장 추첨 전: 스켈레톤(공석).
                                            if (!leaderTier) {
                                                return (
                                                    <td key={tier} className={styles.td}>
                                                        <span className={styles.vacant}>공석</span>
                                                    </td>
                                                );
                                            }
                                            // 팀장 티어 칸: 그 팀의 팀장 표시(고정).
                                            if (tier === leaderTier) {
                                                const leader = merged.find((p) => p.is_leader && p.team_name === teamName);
                                                return (
                                                    <td key={tier} className={`${styles.td} ${styles.leaderCell}`}>
                                                        {leader ? (
                                                            <span className={styles.nameLink} onClick={() => setViewingToken(leader.p_token)}>{nameOf(leader)}</span>
                                                        ) : ''}
                                                    </td>
                                                );
                                            }
                                            // 스네이크 픽 칸.
                                            const member = memberAt(merged, teamName, tier);
                                            // '지명 대기'는 공유된 진행 티어 기준 — 참가자가 다른 티어를 보고 있어도 같은 칸이 켜진다.
                                            const isTurn = currentTeam === teamName && turnTier === tier;
                                            return (
                                                <td key={tier} className={`${styles.td} ${isTurn ? styles.turnCell : ''}`}>
                                                    {member ? (
                                                        <>
                                                            <span className={`${styles.pickName} ${styles.nameLink}`} onClick={() => setViewingToken(member.p_token)}>{nameOf(member)}</span>
                                                            {isAdmin && (
                                                                <button
                                                                    onClick={() => handleCancel(member)}
                                                                    className={styles.cancelBtn}
                                                                    title="지명 취소"
                                                                    aria-label="지명 취소"
                                                                >
                                                                    ×
                                                                </button>
                                                            )}
                                                        </>
                                                    ) : isTurn ? (
                                                        <span className={styles.turnMark}>지명 대기</span>
                                                    ) : (
                                                        <span className={styles.wait}>대기</span>
                                                    )}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
            )}

            {/* 참가자 상세 팝업 (읽기 전용). 그리드 셀 클릭으로 진행자·비진행자 모두 열람. */}
            {viewingTarget && (
                <ParticipantDetailModal
                    target={viewingTarget}
                    realName={displayNames?.[viewingTarget.p_token]}
                    onClose={() => setViewingToken(null)}
                    snakePick={canPickViewing && currentTeam ? { label: `${currentTeam}에 지명`, onPick: handlePickFromModal } : undefined}
                    onCancelPick={isAdmin && !!viewingTarget.team_name && !viewingTarget.is_leader ? handleCancelFromModal : undefined}
                />
            )}
        </div>
    );
}
