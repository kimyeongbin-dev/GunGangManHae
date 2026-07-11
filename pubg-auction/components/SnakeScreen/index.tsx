// components/SnakeScreen/index.tsx
// ---------------------------------------------------------------------------
// [렌더링] 스네이크 드래프트 화면. 경매와 병행하는 대안 팀 편성 방식.
//
// 흐름:
//   1) 진행자가 가운데 '팀장 추첨' → 1~4티어 중 한 티어가 무작위로 걸리고, 그 티어 16명이 팀장이 된다.
//      (팀장은 경매와 동일하게 실명 공개, 나머지 픽 참가자는 결과까지 익명.)
//   2) 남은 3개 티어를 스네이크(지그재그) 순서로 채운다. 진행자가 방송 채팅으로 지명을 받아
//      좌측 4x4 그리드(= 현재 차례 티어 16명)에서 참가자를 클릭해 등록한다.
//      우측 편성표의 각 칸 × 로 취소(차례 되돌리기).
//   · 팀장 추첨 전에도 스켈레톤(? 그리드 · 공석 표)을 보여줘 레이아웃을 미리 보인다.
//   · 참가자/관전자는 표가 실시간으로 채워지는 것만 본다(조작 불가).
//
// ★ 동시성(중복 등록 방지):
//   · lockRef : 등록/취소를 한 번에 하나씩만 처리(연타로 여러 명이 같은 칸에 배정돼 사라지는 문제 차단).
//     React state는 클로저가 옛 값을 보므로 동기 ref로 잠근다.
//   · optimistic : 방금 누른 픽을 실시간 수신 전에 화면에 즉시 반영 → 풀에서 바로 사라지고 차례가 전진.
//     participants(서버 실측)가 따라잡으면 cleanup 훅이 항목을 비운다.
// 렌더 위치: page.tsx의 currentView==='snake'.
// ---------------------------------------------------------------------------
import { useState, useRef, useEffect } from 'react';
import { useRealtimeAuction } from '../AuctionScreen/hooks/useRealtimeAuction';
import { useAdminNames } from '../AuctionScreen/hooks/useAdminNames';
import { TEAM_COUNT } from '../AuctionScreen/types';
import { participantLabel, teamLabel } from '../AuctionScreen/utils';
import { confirmDialog } from '@/lib/toast';
import fonts from '../typography.module.css';
import styles from './style.module.css';
import { ALL_TIERS, leaderTierOf, remainingTiers, buildSnakeSequence, currentPick, memberAt } from './snakeOrder';
import { assignSnakePick, cancelSnakePick, resetSnakeTier } from './snakeActions';
import type { Participant } from '../AuctionScreen/types';

export default function SnakeScreen({ isAdmin, revealNames }: { isAdmin: boolean; revealNames: boolean }) {
    const { participants } = useRealtimeAuction();
    const showReal = isAdmin && revealNames; // 실명(비제이명) 표시 여부
    const adminNames = useAdminNames(isAdmin, participants.length);
    const displayNames = showReal ? adminNames : undefined;
    const nameOf = (p: Participant) => participantLabel(p, displayNames?.[p.p_token]);

    // 낙관적 배정 오버레이 { p_token: team_name | null }. null = 방금 취소(미배정 강제).
    // 실시간 수신 전 화면에 먼저 반영하고, 서버가 따라잡으면 아래 effect가 비운다.
    const [optimistic, setOptimistic] = useState<Record<string, string | null>>({});
    const lockRef = useRef(false); // 등록/취소 직렬화(동기 잠금)

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

    // 팀장 티어(is_leader 참가자의 티어). null이면 아직 팀장 추첨 전.
    const leaderTier = leaderTierOf(merged);
    const sequence = leaderTier ? buildSnakeSequence(leaderTier) : [];
    const current = leaderTier ? currentPick(sequence, merged) : null;

    // 진행 현황(팀장 제외 픽 수 / 남은 티어 × 팀 수).
    const pickedCount = merged.filter((p) => p.team_name && !p.is_leader).length;
    const totalPicks = leaderTier ? remainingTiers(leaderTier).length * TEAM_COUNT : 0;

    // 좌측 4x4 그리드에 표시할 티어. 진행 중엔 현재 차례 티어, 완료 후에도 마지막 티어를 계속 보여준다
    // (그리드가 사라지면 좌측 패널이 짧아져 stretch로 표 높이까지 줄어드는 문제 방지 → 레이아웃 고정).
    const rem = leaderTier ? remainingTiers(leaderTier) : [];
    const gridTier = current ? current.tier : rem[rem.length - 1];
    const tierPool = gridTier
        ? merged.filter((p) => p.tier === gridTier && !p.is_leader).sort((a, b) => a.slot_index - b.slot_index)
        : [];
    const remaining = tierPool.filter((p) => !p.team_name).length;

    // [진행자] 참가자 클릭 → 현재 차례 팀에 배정. lockRef로 한 번에 하나만 처리(연타 방지).
    const handlePick = async (p: Participant) => {
        if (!isAdmin || lockRef.current || !current || p.tier !== current.tier || p.team_name || p.is_leader) return;
        lockRef.current = true;
        setOptimistic((o) => ({ ...o, [p.p_token]: current.team })); // 즉시 반영
        const ok = await assignSnakePick(p.p_token, current.team);
        if (!ok) setOptimistic((o) => { const n = { ...o }; delete n[p.p_token]; return n; }); // 실패 시 롤백
        lockRef.current = false;
    };

    // [진행자] 픽 취소(× 버튼). 마찬가지로 직렬화 + 즉시 반영.
    const handleCancel = async (p: Participant) => {
        if (!isAdmin || lockRef.current) return;
        lockRef.current = true;
        setOptimistic((o) => ({ ...o, [p.p_token]: null }));
        const ok = await cancelSnakePick(p.p_token);
        if (!ok) setOptimistic((o) => { const n = { ...o }; delete n[p.p_token]; return n; });
        lockRef.current = false;
    };

    // [진행자] 티어별 리롤: 그 티어에서 뽑은 픽을 모두 초기화(그 티어가 다시 현재 차례가 됨).
    // 팀장 티어는 초기화 대상이 아니므로 클릭 무시.
    const handleResetTier = async (tier: string) => {
        if (tier === leaderTier) return;
        if (!(await confirmDialog(`${tier}티어에서 뽑은 픽을 모두 초기화할까요?`))) return;
        setOptimistic({});
        await resetSnakeTier(tier);
    };

    return (
        <div className={styles.wrap}>
            <div className={styles.header}>
                <h2 className={styles.title}>
                    스네이크 팀 뽑기
                    {leaderTier && <span className={`${fonts.drawCount} ${styles.count}`}> · 팀장 {leaderTier}티어 · {pickedCount}/{totalPicks} 픽</span>}
                </h2>
            </div>

            <div className={styles.body}>
                {/* 좌측: 현재 차례 티어 16명(4x4). 팀장 추첨 전엔 ? 스켈레톤. */}
                <div className={styles.leftPanel}>
                    <div className={`${fonts.sectionTitle} ${styles.panelTitle}`}>
                        {!leaderTier ? (
                            <span className={styles.turnHint}>팀장 추첨 전{isAdmin ? ' — “1. 추첨”에서 “스네이크 팀장 추첨”을 누르세요' : ''}</span>
                        ) : current ? (
                            <>현재 차례 <b className={styles.turnTeam}>{current.team}</b> · <b>{current.tier}티어</b> <span className={styles.turnHint}>(남은 {remaining}명{isAdmin ? ' · 클릭해 등록' : ''})</span></>
                        ) : (
                            <span className={styles.done}>스네이크 드래프트 완료! 🎉</span>
                        )}
                    </div>
                    {gridTier ? (
                        <div className={styles.tierGrid}>
                            {tierPool.map((p) => {
                                const available = !p.team_name;
                                const pickable = isAdmin && available && !!current; // 완료 후엔 클릭 비활성
                                const cellClass = [
                                    styles.cell,
                                    styles[`cellTier${gridTier}`],
                                    available ? '' : styles.taken,
                                    pickable ? styles.pickable : '',
                                ].filter(Boolean).join(' ');
                                return (
                                    <div
                                        key={p.p_token}
                                        className={cellClass}
                                        onClick={pickable ? () => handlePick(p) : undefined}
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

                {/* 가운데: 티어별 초기화 버튼 (팀장 추첨은 “1. 추첨” 화면에서) */}
                <div className={styles.midPanel}>
                    {isAdmin && leaderTier && (
                        <div className={styles.rerollGroup}>
                            {ALL_TIERS.map((t) => (
                                <button
                                    key={t}
                                    onClick={() => handleResetTier(t)}
                                    disabled={t === leaderTier}
                                    className={styles.rerollBtn}
                                >
                                    {t}티어 초기화{t === leaderTier ? ' (팀장)' : ''}
                                </button>
                            ))}
                        </div>
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
                                        <td className={`${styles.td} ${styles.teamName}`}>{teamLabel(teamName, merged, displayNames)}</td>
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
                                                        {leader ? nameOf(leader) : ''}
                                                    </td>
                                                );
                                            }
                                            // 스네이크 픽 칸.
                                            const member = memberAt(merged, teamName, tier);
                                            const isTurn = !!current && current.team === teamName && current.tier === tier;
                                            return (
                                                <td key={tier} className={`${styles.td} ${isTurn ? styles.turnCell : ''}`}>
                                                    {member ? (
                                                        <>
                                                            <span className={styles.pickName}>{nameOf(member)}</span>
                                                            {isAdmin && (
                                                                <button
                                                                    onClick={() => handleCancel(member)}
                                                                    className={styles.cancelBtn}
                                                                    title="픽 취소"
                                                                    aria-label="픽 취소"
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
        </div>
    );
}
