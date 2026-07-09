// components/AuctionScreen/index.tsx
// [메인 구조] 로직 훅을 조립하고 하위 렌더링 컴포넌트를 배치
import { useState, useRef, useCallback, useEffect } from 'react';
import styles from './style.module.css';
import { toast, confirmDialog } from '@/lib/toast';
import { useRealtimeAuction } from './hooks/useRealtimeAuction';
import { useAuctionTimer } from './hooks/useAuctionTimer';
import { useTeamManagement } from './hooks/useTeamManagement';
import { getTierBySlot } from './utils';
import UnassignedGrid from './ui/UnassignedGrid';
import AuctionPanel from './ui/AuctionPanel';
import TeamEntryTable from './ui/TeamEntryTable';
import ParticipantDetailModal from './ui/ParticipantDetailModal';
import ParticipantEditModal from './ui/ParticipantEditModal';
import type { Participant, ModalForm } from './types';

const EMPTY_FORM: ModalForm = { p_token: '', real_name: '', tier: '1', avg_damage: '', intro: '' };

export default function AuctionScreen({ isAdmin, revealNames }: { isAdmin: boolean; revealNames: boolean }) {
    // --- 실시간 데이터 ---
    const { participants, auctionBids, logs, clearLogs } = useRealtimeAuction();

    // --- 화면 조작 상태 (로컬 UI 전용) ---
    const [viewingTarget, setViewingTarget] = useState<Participant | null>(null); // 상세 보기
    const [editSlot, setEditSlot] = useState<number | null>(null);                // 편집 모달 대상 슬롯
    const [editForm, setEditForm] = useState<ModalForm>(EMPTY_FORM);
    const showReal = isAdmin && revealNames; // 실명(비제이명) 표시 여부 (revealNames는 page.tsx에서 주입)

    // --- 타이머 로직 ---
    // 만료 시 자동 낙찰은 팀 로직에 위임. 훅 간 순환참조를 피하기 위해 ref 경유.
    const onExpireRef = useRef<() => void>(() => {});
    const handleExpire = useCallback(() => onExpireRef.current(), []);
    const timer = useAuctionTimer({ isAdmin, onExpire: handleExpire });

    // 경매 대상자는 서버 공유 값(current_p_token)에서 파생 → 모든 클라이언트가 동일한 대상을 봄
    const auctionTarget = participants.find((p) => p.p_token === timer.currentPToken) ?? null;
    const auctionRunning = timer.timeLeft > 0; // 타이머 진행 중 = 경매 진행 중

    // 현재 대상과 같은 티어를 이미 확정한 팀 → 이 경매에 참여 불가
    const ineligibleTeams = auctionTarget
        ? participants
            .filter((p) => p.team_name && p.tier === auctionTarget.tier)
            .map((p) => p.team_name as string)
        : [];

    // --- 팀 관리 로직 ---
    const team = useTeamManagement({
        participants,
        auctionBids,
        auctionTarget,
        auctionRunning,
        isAdmin,
        extendOnBid: timer.extendOnBid,
    });
    // 최신 자동 낙찰 함수를 ref에 보관 (타이머 만료 콜백이 참조)
    useEffect(() => {
        onExpireRef.current = team.autoFinalConfirm;
    });

    // 셀 클릭: 등록된 참가자는 상세 보기, 빈 슬롯은 진행자만 신규 등록
    const handleCellClick = (slotIndex: number) => {
        const p = participants.find((part) => part.slot_index === slotIndex);
        if (p) {
            setViewingTarget(p);
        } else if (isAdmin) {
            setEditForm({ ...EMPTY_FORM, tier: getTierBySlot(slotIndex) });
            setEditSlot(slotIndex);
        }
    };

    // 기존 참가자 수정 버튼
    const handleEditParticipant = (p: Participant, slotIndex: number) => {
        setEditForm({
            p_token: p.p_token,
            real_name: p.real_name,
            tier: p.tier,
            avg_damage: p.avg_damage.toString(),
            intro: p.intro || '',
        });
        setEditSlot(slotIndex);
    };

    // 상세 팝업에서 경매 대상 지정 (서버에 공유). 진행 중/이미 낙찰된 참가자는 불가.
    const handleAssignTarget = (p: Participant) => {
        if (p.team_name) { toast.error('이미 낙찰된 참가자입니다. 낙찰을 취소한 뒤 다시 올릴 수 있습니다.'); return; }
        if (auctionRunning) { toast.error('경매 진행 중에는 대상을 바꿀 수 없습니다.'); return; }
        timer.setTargetToken(p.p_token);
        setViewingTarget(null);
    };

    // 낙찰 취소 (팀 배정/소모 포인트 되돌리기)
    const handleRevertWin = async (p: Participant) => {
        const ok = await team.revertWin(p);
        if (ok) setViewingTarget(null);
    };

    // 경매 시작 / 재시작. 진행 중이면 현재 회차 입찰 초기화 후 타이머 재시작.
    const handleStartAuction = async () => {
        if (!auctionTarget) { toast.error('대상자를 먼저 선택하세요.'); return; }
        if (auctionRunning) {
            if (!(await confirmDialog(`${auctionTarget.fake_name} 경매를 재시작하시겠습니까?\n현재 회차 입찰이 초기화됩니다.`))) return;
            await team.clearBidsForTarget();
            await timer.startAuction(auctionTarget, true);
            return;
        }
        timer.startAuction(auctionTarget);
    };

    return (
        <div className={styles.container}>
            {/* 좌측: 미배정 참가자 목록 */}
            <UnassignedGrid
                participants={participants}
                isAdmin={isAdmin}
                showReal={showReal}
                onCellClick={handleCellClick}
                onEditParticipant={handleEditParticipant}
            />

            {/* 우측: 경매 진행 창 + 팀 확정 현황 */}
            <div className={styles.rightPanel}>
                <AuctionPanel
                    isAdmin={isAdmin}
                    showReal={showReal}
                    auctionTarget={auctionTarget}
                    currentHighestBid={team.currentHighestBid}
                    teamPoints={team.teamPoints}
                    timeLeft={timer.timeLeft}
                    logs={logs}
                    onStartAuction={handleStartAuction}
                    onStopAuction={team.stopAuction}
                    onBid={team.placeBid}
                    onClearLogs={clearLogs}
                    ineligibleTeams={ineligibleTeams}
                />
                <TeamEntryTable
                    participants={participants}
                    teamPoints={team.teamPoints}
                    memberPrices={team.memberPrices}
                    isAdmin={isAdmin}
                    showReal={showReal}
                    onResetAuction={team.resetAuction}
                />
            </div>

            {/* 상세 정보 팝업 */}
            {viewingTarget && (
                <ParticipantDetailModal
                    target={viewingTarget}
                    isAdmin={isAdmin}
                    showReal={showReal}
                    auctionRunning={auctionRunning}
                    finalPrice={team.memberPrices[viewingTarget.p_token] ?? 0}
                    onClose={() => setViewingTarget(null)}
                    onAssignTarget={handleAssignTarget}
                    onRevertWin={handleRevertWin}
                />
            )}

            {/* 진행자 참가자 편집 모달 */}
            {editSlot !== null && (
                <ParticipantEditModal
                    initialForm={editForm}
                    onSave={team.saveParticipant}
                    onDelete={team.deleteParticipant}
                    onClose={() => setEditSlot(null)}
                />
            )}
        </div>
    );
}
