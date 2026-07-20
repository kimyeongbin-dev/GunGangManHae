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
//   · 지그재그 방향은 page_state.tier_direction(티어별 방향 저장)으로 정해진다 — snakeOrder.ts 참고.
//   · 순서를 바꾸고 싶으면 '뽑기 순서 리롤'로 팀 번호를 통째로 재배열한다(뽑힌 팀원도 함께 이동).
//
// ★ 동시성(중복 등록 방지):
//   · 판을 바꾸는 모든 조작은 actionLock 의 전역 잠금을 공유한다(snakeActions.ts).
//   · optimistic : 방금 누른 픽을 실시간 수신 전에 화면에 즉시 반영 → 풀에서 바로 사라지고 차례가 전진.
//     서버 실측이 따라잡거나 유효기간이 지나면 비운다. ★ '값이 일치할 때만' 지우면, 다른 진행자가
//     그 사이 초기화했을 때 내 화면에만 유령 배정이 영구히 남는다 → 유효기간을 함께 둔다.
// 렌더 위치: page.tsx의 view==='snake'.
// ---------------------------------------------------------------------------
import { useState, useEffect } from 'react';
import { useRealtime } from '../common/hooks/useRealtime';
import { useAdminNames } from '../common/hooks/useAdminNames';
import { TEAM_COUNT } from '../common/types';
import { participantLabel } from '../common/utils';
import { supabase } from '@/lib/supabaseClient';
import { confirmDialog } from '@/lib/toast';
import fonts from '../typography.module.css';
import styles from './style.module.css';
import { ALL_TIERS, remainingTiers, memberAt, currentTeamFor, isTierDone } from './snakeOrder';
import type { TierDirection } from './snakeOrder';
import {
    assignSnakePick, cancelSnakePick, resetSnakeTier, fillTierRandomly,
    rerollTeamOrder, fetchDraftState, saveActiveTier,
} from './snakeActions';
import ParticipantDetailModal from '../common/ui/ParticipantDetailModal';
import { clickable } from '../common/a11y';
import { useActionBusy } from '../common/actionLock';
import type { Participant } from '../common/types';

// 낙관적 반영을 유지하는 최대 시간. 서버 왕복이 이보다 오래 걸리면 잠깐 되돌아 보이지만,
// 영구히 어긋난 채 남는 것보다 낫다(서버 실측이 항상 최종 진실).
const OPTIMISTIC_TTL_MS = 5000;

export default function SnakeScreen({ isAdmin, revealNames }: { isAdmin: boolean; revealNames: boolean }) {
    const { participants } = useRealtime();
    const busy = useActionBusy(); // 판을 바꾸는 긴 작업(추첨·초기화·랜덤배치·리롤)이 도는 중인가
    const showReal = isAdmin && revealNames; // 실명(비제이명) 표시 여부
    const [adminNames] = useAdminNames(isAdmin, participants);
    const displayNames = showReal ? adminNames : undefined;
    const nameOf = (p: Participant) => participantLabel(p, displayNames?.[p.p_token]);

    // 낙관값: { p_token: { team, at } }. team=null 은 방금 취소(미배정 강제). at=설정 시각.
    // 실시간 수신 전 화면에 먼저 반영하고, 서버가 따라잡거나 유효기간이 지나면 아래 effect가 비운다.
    const [optimistic, setOptimistic] = useState<Record<string, { team: string | null; at: number }>>({});
    const [viewingToken, setViewingToken] = useState<string | null>(null); // 상세 팝업 대상(그리드 셀 클릭)
    const [viewTier, setViewTier] = useState<string | null>(null);         // 내가 보고 있는 티어(로컬 열람)
    const [activeTier, setActiveTier] = useState<string | null>(null);     // 지금 뽑는 티어(진행자가 정해 공유)
    const [tierDirection, setTierDirection] = useState<TierDirection>({});  // 티어별 뽑기 방향(지그재그 근거)

    // 진행 상태 구독: 진행 티어와 티어별 방향을 전원이 같이 본다.
    // ★ 구독 콜백은 공유 상태만 갱신하고 viewTier(=내가 보는 화면)는 건드리지 않는다.
    //   진행자가 티어를 옮겼다고 남의 그리드까지 갈아치우면, 보고 있던 참가자 화면이 갑자기 바뀐다.
    //   최초 진입 때만 내 그리드를 그때의 진행 티어에 맞춰 두고, 이후로는 각자 탭으로 정한다.
    useEffect(() => {
        let alive = true;
        const apply = (s: { activeTier: string | null; tierDirection: TierDirection }) => {
            if (!alive) return;
            setActiveTier(s.activeTier);
            setTierDirection(s.tierDirection);
        };
        fetchDraftState().then((s) => {
            if (!alive) return;
            apply(s);
            if (s.activeTier) setViewTier((v) => v ?? s.activeTier); // 첫 로드 1회에 한해 맞춤
        });
        const channel = supabase
            .channel('draft_state_changes')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'page_state' }, (payload) => {
                const row = payload.new as { active_tier: string | null; tier_direction: TierDirection | null };
                apply({ activeTier: row.active_tier ?? null, tierDirection: row.tier_direction ?? {} });
            })
            .subscribe((status) => { if (status === 'SUBSCRIBED') fetchDraftState().then(apply); });
        return () => { alive = false; supabase.removeChannel(channel); };
    }, []);

    // 낙관값 정리. 서버가 같은 값으로 따라잡았거나, 유효기간(5초)이 지났으면 버린다.
    // ★ '값이 일치할 때만' 지우면 다른 진행자가 그 사이 초기화했을 때(서버가 제3의 값이 됨)
    //   항목이 영구히 남아 내 화면에만 유령 배정이 생긴다. 그래서 시간 만료를 함께 둔다.
    // ★ 이 정리는 participants 변경뿐 아니라 '시간 경과'로도 일어나야 한다 — 마지막 변경 이후
    //   아무 이벤트가 없으면 만료 항목이 안 지워지므로, 낙관값이 남아 있는 동안 짧은 타이머를 돌린다.
    const purgeOptimistic = () => {
        setOptimistic((prev) => {
            const now = Date.now();
            const next: typeof prev = {};
            let changed = false;
            for (const [token, v] of Object.entries(prev)) {
                const real = participants.find((p) => p.p_token === token);
                const settled = real && (real.team_name ?? null) === v.team;
                const expired = now - v.at > OPTIMISTIC_TTL_MS;
                if (settled || expired || !real) { changed = true; continue; }
                next[token] = v;
            }
            return changed ? next : prev;
        });
    };
    useEffect(purgeOptimistic, [participants]);
    useEffect(() => {
        if (Object.keys(optimistic).length === 0) return;
        const id = setInterval(purgeOptimistic, 1000);
        return () => clearInterval(id);
    }, [optimistic]); // eslint-disable-line react-hooks/exhaustive-deps

    // 낙관값을 얹은 실효 참가자 목록. 모든 파생 계산은 이걸 기준으로 한다.
    const merged = participants.map((p) =>
        p.p_token in optimistic ? { ...p, team_name: optimistic[p.p_token].team } : p,
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
    const currentTeam = leaderTier && turnTier ? currentTeamFor(merged, tierDirection, turnTier) : null;

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

    // [진행자] 지명: 현재 차례 팀에 배정. 서버 RPC 가 배정과 '뽑은 순번' 기록을 한 트랜잭션으로 처리한다.
    const handlePick = async (p: Participant) => {
        if (!isAdmin || !currentTeam || p.tier !== turnTier || p.team_name || p.is_leader) return;
        setOptimistic((o) => ({ ...o, [p.p_token]: { team: currentTeam, at: Date.now() } })); // 즉시 반영
        const ok = await assignSnakePick(p.p_token, currentTeam);
        if (!ok) setOptimistic((o) => { const n = { ...o }; delete n[p.p_token]; return n; }); // 실패 시 롤백
    };

    // [진행자] 지명 취소(편성표 × · 상세 팝업 버튼 공용).
    // ★ 취소해도 '뽑은 순번'은 그대로 둔다 → 진행 중 티어의 지그재그 방향이 소급해 뒤집히지 않는다.
    const handleCancel = async (p: Participant) => {
        if (!isAdmin) return;
        const team = p.team_name;
        if (!(await confirmDialog(`${nameOf(p)}의 지명을 취소할까요?\n${team} 배정이 해제됩니다.`))) return;
        setOptimistic((o) => ({ ...o, [p.p_token]: { team: null, at: Date.now() } }));
        const ok = await cancelSnakePick(p.p_token);
        if (!ok) setOptimistic((o) => { const n = { ...o }; delete n[p.p_token]; return n; });
    };

    // [진행자] 티어별 초기화: 그 티어에서 뽑은 픽을 모두 되돌리고 뽑은 순번에서도 제거한다.
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
        await fillTierRandomly(tier);
    };

    // [진행자] 뽑기 순서 리롤: 팀 번호를 통째로 재배열한다.
    // 팀장과 이미 뽑힌 팀원이 한 팀으로 묶인 채 옮겨가므로 기존 구성은 그대로 유지된다.
    const handleRerollOrder = async () => {
        const msg = pickedCount > 0
            ? `뽑기 순서를 다시 섞을까요?\n이미 뽑은 팀원 ${pickedCount}명은 팀장과 함께 그대로 따라갑니다(구성 유지).`
            : '뽑기 순서를 다시 섞을까요?\n누가 먼저 뽑는지가 바뀝니다.';
        if (!(await confirmDialog(msg))) return;
        setOptimistic({});
        await rerollTeamOrder();
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
                                // 긴 작업(busy) 중에는 지명을 막는다 — 조용히 씹히지 않도록 클릭 시 상세만 열린다.
                                const pickable = isAdmin && available && !!currentTeam && viewingTurnTier && !busy;
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
                                        title={available ? '' : `${nameOf(p)} → ${p.team_name}`}
                                        {...clickable(() => setViewingToken(p.p_token),
                                            `${nameOf(p)} 상세 보기${available ? '' : ` (${p.team_name} 배정됨)`}`)}
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

                {/* 가운데: 진행자 도구 (티어 랜덤 배치 · 티어별 초기화 / 팀장 티어 자리는 순서 리롤).
                    긴 작업이 도는 동안(busy) 버튼을 잠가 이중 실행과 '씹힘'을 막는다. */}
                <div className={styles.midPanel}>
                    {isAdmin && leaderTier && (
                        <>
                            {busy && <div className={styles.busyHint}>처리 중…</div>}
                            {gridTier && gridTier !== leaderTier && (
                                <button onClick={() => handleFillRandomly(gridTier)} disabled={busy} className={styles.fillBtn}>
                                    {gridTier}티어 랜덤 배치
                                </button>
                            )}

                            <div className={styles.midBtnGroup}>
                                {ALL_TIERS.map((t) => (
                                    // 팀장 티어는 초기화 대상이 아니므로, 그 자리를 '뽑기 순서 리롤'로 쓴다.
                                    t === leaderTier ? (
                                        <button key={t} onClick={handleRerollOrder} disabled={busy} className={styles.rerollBtn}>
                                            뽑기 순서 리롤
                                        </button>
                                    ) : (
                                        <button key={t} onClick={() => handleResetTier(t)} disabled={busy} className={styles.tierResetBtn}>
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
                                                            <span className={styles.nameLink} {...clickable(() => setViewingToken(leader.p_token), `${nameOf(leader)} 상세 보기`)}>{nameOf(leader)}</span>
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
                                                            <span className={`${styles.pickName} ${styles.nameLink}`} {...clickable(() => setViewingToken(member.p_token), `${nameOf(member)} 상세 보기`)}>{nameOf(member)}</span>
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
