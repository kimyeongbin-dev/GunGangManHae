// components/common/ui/ParticipantDetailModal.tsx
// [렌더링] 참가자 상세 정보 팝업 (읽기 전용).
// 렌더: SnakeScreen/DrawScreen에서 카드·셀을 클릭했을 때.
// 진행자가 현재 차례 팀에 지명할 수 있는 상황이면 snakePick으로 '지명' 버튼을 받아 노출한다.
// realName이 있으면(진행자 실명모드) 비제이명까지 표시.
import { useEffect, useRef } from 'react';
import { getState } from '@/lib/toast';
import styles from './modal.module.css';
import fonts from '../../typography.module.css';
import { participantLabel } from '../utils';
import type { Participant } from '../types';

type Props = {
    target: Participant;
    realName?: string; // 진행자 실명모드에서만 전달된 실명
    onClose: () => void;
    snakePick?: { label: string; onPick: () => void }; // 진행자·현재 차례일 때만 전달되는 '지명' 액션
    onCancelPick?: () => void; // 진행자가 이미 지명된 팀원을 볼 때만 전달되는 '지명 취소' 액션
};

export default function ParticipantDetailModal({ target, realName, onClose, snakePick, onCancelPick }: Props) {
    // Enter=주 액션 / Esc=닫기. 확인창(confirmDialog)이 떠 있으면 그쪽이 키를 처리하므로 양보한다.
    // 주 액션은 화면에 실제로 떠 있는 버튼 하나뿐이다: 미배정이면 '지명', 이미 배정됐으면 '지명 취소'.
    // (둘은 동시에 뜨지 않는다. 취소는 다시 지명하면 원상복구라 Enter에 걸어도 위험하지 않다)
    const primaryAction = snakePick?.onPick ?? onCancelPick ?? null;

    // ★ 열릴 때 포커스를 모달로 가져온다. 안 그러면 이 팝업을 연 그리드 셀/이름(clickable)이 포커스를
    //   계속 쥐고, 그 요소의 onKeyDown 이 Enter 를 stopPropagation 으로 삼켜 아래 window 리스너까지
    //   도달하지 못한다(Esc 는 clickable 이 처리 안 해 통과 → Esc 만 되던 증상).
    const boxRef = useRef<HTMLDivElement>(null);
    useEffect(() => { boxRef.current?.focus(); }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (getState().confirms.length) return;
            if (e.key === 'Escape') {
                onClose();
            } else if (e.key === 'Enter' && primaryAction) {
                e.preventDefault();
                primaryAction();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [primaryAction, onClose]);

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div ref={boxRef} tabIndex={-1} className={styles.detailModalContent} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="참가자 상세 정보">
                <button className={styles.closeButton} onClick={onClose}>×</button>

                {/* 핵심 정보 상단 배치 */}
                <h2 className={styles.detailName}>{participantLabel(target, realName)}</h2>
                <div className={styles.infoGrid}>
                    {/* 티어 배지: tier 값에 따라 클래스 동적 할당 */}
                    <span className={`${styles.statBadge} ${styles[`tier${target.tier}Badge`]}`}>
                        {target.tier} 티어
                    </span>

                    {/* 딜량 배지 */}
                    <span className={styles.statBadge}>
                        평균 딜량: {target.avg_damage}
                    </span>

                    {/* 팀 배지 + 팀장이면 팀장 배지 */}
                    {target.team_name && (
                        <span className={`${styles.statBadge} ${styles.badgeTeam}`}>
                            {target.team_name}
                        </span>
                    )}
                    {target.is_leader && (
                        <span className={`${styles.statBadge} ${styles.badgeLeader}`}>
                            팀장
                        </span>
                    )}

                    {/* 실명 공개 시에만 비제이명 표시 */}
                    {realName && (
                        <span className={`${styles.statBadge} ${styles.badgeReal}`}>
                            비제이명: {realName}
                        </span>
                    )}
                </div>

                {/* 소개글 강조 구역 */}
                <div className={styles.introDisplay}>
                    &quot;{target.intro || '등록된 소개글이 없습니다.'}&quot;
                </div>

                {/* 현재 상태 안내 + 진행자 액션. 편성표의 × 와 같은 동작이지만, 좌측 그리드에서 바로
                    누른 경우엔 편성표에서 그 사람을 다시 찾아야 해서 여기에도 둔다. */}
                {target.is_leader ? (
                    <div className={`${fonts.detailNote} ${styles.detailNoteBox} ${styles.noteLeader}`}>
                        팀장은 추첨 페이지에서 관리됩니다.
                    </div>
                ) : target.team_name ? (
                    <>
                        <div className={`${fonts.detailNote} ${styles.detailNoteBox} ${styles.noteWin}`}>
                            이미 {target.team_name}에 지명됨
                        </div>
                        {onCancelPick && (
                            <button onClick={onCancelPick} className={`${fonts.detailActionBtn} ${styles.detailBtn} ${styles.detailBtnRevert}`}>
                                지명 취소
                            </button>
                        )}
                    </>
                ) : null}

                {/* 진행자·현재 차례일 때만: 이 참가자를 현재 차례 팀에 지명 */}
                {snakePick && (
                    <button onClick={snakePick.onPick} className={`${fonts.detailActionBtn} ${styles.detailBtn} ${styles.detailBtnAssign}`}>
                        {snakePick.label}
                    </button>
                )}
            </div>
        </div>
    );
}
