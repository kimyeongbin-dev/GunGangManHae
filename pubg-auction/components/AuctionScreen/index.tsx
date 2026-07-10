// components/AuctionScreen/index.tsx
// ---------------------------------------------------------------------------
// [2단계 · 경매 화면의 메인 구조] 로직 훅들을 조립하고 하위 렌더링 컴포넌트에 값/콜백을 배치한다.
//
// 데이터 흐름:
//   useRealtimeAuction → participants·auctionBids·logs (실시간 구독)
//   useAuctionTimer    → timeLeft·currentPToken (서버 공유 타이머)   ─┐
//   useTeamManagement  → 파생값(최고가/예산) + 액션(입찰/낙찰/초기화)  ├→ UI 컴포넌트로 내려감
//   useLeaderAuth      → 팀장 PIN 세션 (입찰 권한)                    │
//   useAdminNames      → 진행자 전용 실명 맵 (showReal일 때만 표시)  ─┘
//
// 배치 컴포넌트: UnassignedGrid(좌) / AuctionPanel·TeamEntryTable(우) / 상세·편집 모달.
// 렌더 위치: page.tsx의 currentView==='auction'.
// ---------------------------------------------------------------------------
import { useState, useRef, useCallback, useEffect } from 'react';
import styles from './style.module.css';
import { toast, confirmDialog } from '@/lib/toast';
import { useRealtimeAuction } from './hooks/useRealtimeAuction';
import { useAuctionTimer } from './hooks/useAuctionTimer';
import { useTeamManagement } from './hooks/useTeamManagement';
import { useLeaderAuth } from './hooks/useLeaderAuth';
import { useAdminNames } from './hooks/useAdminNames';
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
    // 상세 보기는 토큰만 저장하고 실시간 목록에서 대상을 파생 → 초기화/재추첨/공석 변경이 팝업에 즉시 반영
    const [viewingToken, setViewingToken] = useState<string | null>(null);
    const [editSlot, setEditSlot] = useState<number | null>(null);                // 편집 모달 대상 슬롯
    const [editForm, setEditForm] = useState<ModalForm>(EMPTY_FORM);
    const showReal = isAdmin && revealNames; // 실명(비제이명) 표시 여부 (revealNames는 page.tsx에서 주입)

    // 진행자 전용 실명 맵(secrets). adminNames는 항상 로드하되(편집 모달용),
    // 화면 표시에는 showReal일 때만 displayNames로 하위에 내려 실명 노출을 게이팅한다.
    const adminNames = useAdminNames(isAdmin, participants.length);
    const displayNames = showReal ? adminNames : undefined;

    // 상세 팝업 대상: 토큰으로 저장하고 실시간 목록에서 파생 → 초기화/재추첨/공석 변경이 즉시 반영.
    const viewingTarget = participants.find((p) => p.p_token === viewingToken) ?? null;

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

    // --- 팀장 인증 (PIN) ---
    const { leaderTeam, leaderPin, loginLeader, logoutLeader } = useLeaderAuth();

    // --- 팀 관리 로직 ---
    const team = useTeamManagement({
        participants,
        auctionBids,
        auctionTarget,
        auctionRunning,
        isAdmin,
    });
    // 최신 자동 낙찰 함수를 ref에 보관 (타이머 만료 콜백이 참조)
    useEffect(() => {
        onExpireRef.current = team.autoFinalConfirm;
    });

    // 셀 클릭: 등록된 참가자는 상세 보기, 빈 슬롯은 진행자만 신규 등록
    const handleCellClick = (slotIndex: number) => {
        const p = participants.find((part) => part.slot_index === slotIndex);
        if (p) {
            setViewingToken(p.p_token);
        } else if (isAdmin) {
            setEditForm({ ...EMPTY_FORM, tier: getTierBySlot(slotIndex) });
            setEditSlot(slotIndex);
        }
    };

    // 기존 참가자 수정 버튼
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

    // 상세 팝업에서 경매 대상 지정 (서버에 공유). 진행 중/이미 낙찰된 참가자는 불가.
    const handleAssignTarget = (p: Participant) => {
        if (p.is_leader) { toast.error('팀장은 경매 대상이 될 수 없습니다.'); return; }
        if (p.team_name) { toast.error('이미 낙찰된 참가자입니다. 낙찰을 취소한 뒤 다시 올릴 수 있습니다.'); return; }
        if (auctionRunning) { toast.error('경매 진행 중에는 대상을 바꿀 수 없습니다.'); return; }
        timer.setTargetToken(p.p_token);
        setViewingToken(null);
    };

    // 낙찰 취소 (팀 배정/소모 포인트 되돌리기)
    const handleRevertWin = async (p: Participant) => {
        const ok = await team.revertWin(p);
        if (ok) setViewingToken(null);
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
                realNames={displayNames}
                onCellClick={handleCellClick}
                onEditParticipant={handleEditParticipant}
            />

            {/* 우측: 경매 진행 창 + 팀 확정 현황 */}
            <div className={styles.rightPanel}>
                <AuctionPanel
                    isAdmin={isAdmin}
                    realNames={displayNames}
                    participants={participants}
                    auctionTarget={auctionTarget}
                    currentHighestBid={team.currentHighestBid}
                    teamPoints={team.teamPoints}
                    timeLeft={timer.timeLeft}
                    logs={logs}
                    onStartAuction={handleStartAuction}
                    onStopAuction={team.stopAuction}
                    onBid={(amount) => team.placeBid(amount, leaderPin)}
                    onClearLogs={clearLogs}
                    ineligibleTeams={ineligibleTeams}
                    leaderTeam={leaderTeam}
                    onLeaderLogin={loginLeader}
                    onLeaderLogout={logoutLeader}
                />
                <TeamEntryTable
                    participants={participants}
                    teamPoints={team.teamPoints}
                    memberPrices={team.memberPrices}
                    isAdmin={isAdmin}
                    realNames={displayNames}
                    onResetAuction={team.resetAuction}
                    onViewMember={(p) => setViewingToken(p.p_token)}
                />
            </div>

            {/* 상세 정보 팝업 */}
            {viewingTarget && (
                <ParticipantDetailModal
                    target={viewingTarget}
                    isAdmin={isAdmin}
                    realName={displayNames?.[viewingTarget.p_token]}
                    auctionRunning={auctionRunning}
                    finalPrice={team.memberPrices[viewingTarget.p_token] ?? 0}
                    onClose={() => setViewingToken(null)}
                    onAssignTarget={handleAssignTarget}
                    onRevertWin={handleRevertWin}
                />
            )}

            {/* 진행자 참가자 편집 모달 */}
            {editSlot !== null && (
                <ParticipantEditModal
                    initialForm={editForm}
                    masked={!showReal}
                    onSave={team.saveParticipant}
                    onDelete={team.deleteParticipant}
                    onClose={() => setEditSlot(null)}
                />
            )}
        </div>
    );
}
