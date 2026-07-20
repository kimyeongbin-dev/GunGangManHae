// components/DrawScreen/index.tsx
// [렌더링] 1단계 · 팀장 추첨 화면 (다크 테마).
// 진행자가 팀장으로 쓸 티어를 직접 고르거나(1~4) 무작위로 맡겨 추첨하면, 그 티어 16명이 팀장이 된다.
// 남은 3개 티어는 '스네이크' 화면에서 지그재그로 채운다.
// 참가자/관전자는 추첨 결과(팀장 명단)만 실시간으로 본다.
// 렌더 위치: page.tsx의 view==='draw'.
import { useState } from 'react';
import { useRealtime } from '../common/hooks/useRealtime';
import { TEAM_COUNT } from '../common/types';
import { confirmDialog } from '@/lib/toast';
import fonts from '../typography.module.css';
import { clickable } from '../common/a11y';
import styles from './style.module.css';
import { drawSnakeLeaders, releaseLeaders } from '../SnakeScreen/snakeActions';
import { ALL_TIERS } from '../SnakeScreen/snakeOrder';
import { useAdminNames } from '../common/hooks/useAdminNames';
import { useActionBusy } from '../common/actionLock';
import ParticipantDetailModal from '../common/ui/ParticipantDetailModal';

export default function DrawScreen({ isAdmin, revealNames }: { isAdmin: boolean; revealNames: boolean }) {
    // 실시간 참가자 목록에서 팀장(is_leader)만 추린다.
    const { participants } = useRealtime();
    const busy = useActionBusy(); // 추첨/해제 등 긴 작업이 도는 중인가
    const leaders = participants.filter((p) => p.is_leader);

    // 진행자 실명모드에서만 실명 표시. 카드 클릭 시 상세(소개글 등) 팝업을 띄운다(읽기 전용).
    const [adminNames] = useAdminNames(isAdmin, participants);
    const displayNames = isAdmin && revealNames ? adminNames : undefined;
    const [viewingToken, setViewingToken] = useState<string | null>(null);
    const viewingTarget = participants.find((p) => p.p_token === viewingToken) ?? null;

    // 팀장 추첨: tier가 null이면 1~4 중 무작위. 기존 구성이 있으면 초기화 경고를 먼저 띄운다.
    const handleDraw = async (tier: string | null) => {
        const what = tier ? `${tier}티어를 팀장으로` : '무작위 티어를 팀장으로';
        const warn = leaders.length > 0 ? '기존 팀 구성과 뽑기 순서가 모두 초기화됩니다.\n' : '';
        if (!(await confirmDialog(`${what} 추첨합니다.\n${warn}계속하시겠습니까?`))) return;
        await drawSnakeLeaders(tier);
    };

    // 해제: 전원 익명 미배정 복귀.
    const handleRelease = async () => {
        if (!(await confirmDialog('모든 팀장을 해제하고 익명 참가자로 되돌립니다.\n팀 구성도 모두 초기화됩니다. 계속하시겠습니까?'))) return;
        await releaseLeaders();
    };

    return (
        <div className={styles.wrap}>
            <div className={styles.header}>
                <h2 className={styles.title}>
                    팀장 추첨 <span className={`${fonts.drawCount} ${styles.count}`}>({leaders.length}/{TEAM_COUNT}팀)</span>
                </h2>
                {isAdmin && (
                    <div className={styles.headerActions}>
                        {leaders.length > 0 && (
                            <button onClick={handleRelease} disabled={busy} className={`${fonts.drawBtn} ${styles.releaseBtn}`}>
                                팀장 해제
                            </button>
                        )}
                        {/* 어느 티어를 팀장으로 쓸지 진행자가 고른다(마지막 '랜덤'은 무작위 티어). */}
                        <span className={styles.drawLabel}>{busy ? '처리 중…' : '팀장 티어'}</span>
                        {ALL_TIERS.map((t) => (
                            <button key={t} onClick={() => handleDraw(t)} disabled={busy} className={`${fonts.drawBtn} ${styles.drawBtn}`}>
                                {t}티어
                            </button>
                        ))}
                        <button onClick={() => handleDraw(null)} disabled={busy} className={`${fonts.drawBtn} ${styles.randomBtn}`}>
                            랜덤
                        </button>
                    </div>
                )}
            </div>

            {leaders.length === 0 ? (
                <div className={styles.empty}>
                    아직 팀장을 추첨하지 않았습니다.{isAdmin ? ' 우측 상단에서 팀장 티어를 골라 시작하세요.' : ''}
                </div>
            ) : (
                // 16팀 카드 그리드: 각 팀의 팀장(공개명) + 티어.
                <div className={styles.grid}>
                    {Array.from({ length: TEAM_COUNT }).map((_, i) => {
                        const teamName = `${i + 1}팀`;
                        const leader = leaders.find((p) => p.team_name === teamName);
                        return (
                            <div
                                key={i}
                                className={`${styles.card} ${leader ? styles.clickable : ''}`}
                                {...(leader ? clickable(() => setViewingToken(leader.p_token), `${teamName} 팀장 상세 보기`) : {})}
                            >
                                <div className={`${fonts.teamCardLabel} ${styles.cardLabel}`}>{teamName}</div>
                                {leader ? (
                                    <>
                                        {/* 팀장은 공개명(reveal_name=실명)으로 노출. 값이 없으면 익명 폴백. */}
                                        <div className={`${fonts.teamCardName} ${styles.cardName}`}>
                                            {leader.reveal_name ?? leader.fake_name} <span className={styles.leaderTag}>(팀장)</span>
                                        </div>
                                        <span className={`${fonts.tierChip} ${styles.chip} ${styles[`chipTier${leader.tier}`]}`}>
                                            {leader.tier}티어
                                        </span>
                                    </>
                                ) : (
                                    <div className={styles.unassigned}>미배정</div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* 팀장 상세 정보 팝업 (읽기 전용: 소개글 등) */}
            {viewingTarget && (
                <ParticipantDetailModal
                    target={viewingTarget}
                    realName={displayNames?.[viewingTarget.p_token]}
                    onClose={() => setViewingToken(null)}
                />
            )}
        </div>
    );
}
