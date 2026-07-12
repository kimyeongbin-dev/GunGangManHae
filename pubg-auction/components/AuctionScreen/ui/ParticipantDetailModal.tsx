// components/AuctionScreen/ui/ParticipantDetailModal.tsx
// [렌더링] 참가자 상세 정보 팝업. 렌더: AuctionScreen(index.tsx)에서 viewingToken이 있을 때.
// 진행자에게는 상황별 액션 노출: 대상 지정(onAssignTarget) / 낙찰 취소(onRevertWin) / 안내.
// realName이 있으면(진행자 실명모드) 비제이명까지 표시.
import { useEffect } from 'react';
import { getState } from '@/lib/toast';
import styles from '../style.module.css';
import fonts from '../../typography.module.css';
import { participantLabel } from '../utils';
import type { Participant } from '../types';

type Props = {
    target: Participant;
    isAdmin: boolean;
    realName?: string; // 진행자 실명모드에서만 전달된 실명
    auctionRunning: boolean;
    finalPrice: number; // 낙찰가 (team_name 있을 때 의미)
    onClose: () => void;
    onAssignTarget: (target: Participant) => void;
    onRevertWin: (target: Participant) => void;
    snakePick?: { label: string; onPick: () => void }; // 스네이크 화면 전용: '지명' 버튼(전달 시에만 노출)
};

export default function ParticipantDetailModal({ target, isAdmin, realName, auctionRunning, finalPrice, onClose, onAssignTarget, onRevertWin, snakePick }: Props) {
    // 화면에 실제로 보이는 '주 액션' 버튼(하나만 노출됨): 지명 / 낙찰 취소 / 경매 대상 지정.
    // 없으면(팀장·진행 중·읽기 전용) Enter는 아무 것도 하지 않는다.
    const primaryAction = snakePick
        ? snakePick.onPick
        : isAdmin && !target.is_leader && target.team_name
            ? () => onRevertWin(target)
            : isAdmin && !target.is_leader && !target.team_name && !auctionRunning
                ? () => onAssignTarget(target)
                : null;

    // Enter=주 액션 / Esc=닫기. 확인창(confirmDialog)이 떠 있으면 그쪽이 키를 처리하므로 양보한다.
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
            <div className={styles.detailModalContent} onClick={(e) => e.stopPropagation()}>
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

                    {/* 팀 배지 + (팀장이면 팀장 배지 / 낙찰이면 낙찰가) */}
                    {target.team_name && (
                        <span className={`${styles.statBadge} ${styles.badgeTeam}`}>
                            {target.team_name}
                        </span>
                    )}
                    {target.is_leader ? (
                        <span className={`${styles.statBadge} ${styles.badgeLeader}`}>
                            팀장
                        </span>
                    ) : target.team_name && finalPrice > 0 ? (
                        // 낙찰가는 실제 입찰(경매)이 있을 때만. 스네이크 픽은 입찰이 없어 표시하지 않음.
                        <span className={`${styles.statBadge} ${styles.badgeWin}`}>
                            낙찰가: {finalPrice}P
                        </span>
                    ) : null}

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

                {/* 진행자 전용 액션: 팀장 → 안내 / 낙찰됨 → 낙찰 취소 / 진행 중 → 불가 / 그 외 → 대상 지정 */}
                {isAdmin && (
                    target.is_leader ? (
                        <div className={`${fonts.detailNote} ${styles.detailNoteBox} ${styles.noteLeader}`}>
                            팀장은 추첨 페이지에서 관리됩니다.
                        </div>
                    ) : target.team_name ? (
                        <>
                            {/* 스네이크 픽(입찰 없음, 낙찰가 0)은 '지명', 경매 낙찰(낙찰가>0)은 '낙찰'로 구분 표시 */}
                            <div className={`${fonts.detailNote} ${styles.detailNoteBox} ${styles.noteWin}`}>
                                이미 {target.team_name}에 {finalPrice > 0 ? '낙찰' : '지명'}됨
                            </div>
                            <button onClick={() => onRevertWin(target)} className={`${fonts.detailActionBtn} ${styles.detailBtn} ${styles.detailBtnRevert}`}>
                                {finalPrice > 0 ? '낙찰 취소' : '지명 취소'}
                            </button>
                        </>
                    ) : auctionRunning ? (
                        <div className={`${fonts.detailNote} ${styles.detailNoteBox} ${styles.noteBlocked}`}>
                            경매 진행 중에는 대상을 변경할 수 없습니다.
                        </div>
                    ) : (
                        <button onClick={() => onAssignTarget(target)} className={`${fonts.detailActionBtn} ${styles.detailBtn} ${styles.detailBtnAssign}`}>
                            경매 대상 지정
                        </button>
                    )
                )}

                {/* 스네이크 화면 전용: 상세에서 '지명' (전달 시에만 노출) */}
                {snakePick && (
                    <button onClick={snakePick.onPick} className={`${fonts.detailActionBtn} ${styles.detailBtn} ${styles.detailBtnAssign}`}>
                        {snakePick.label}
                    </button>
                )}
            </div>
        </div>
    );
}
