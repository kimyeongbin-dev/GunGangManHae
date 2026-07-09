// components/DrawScreen/index.tsx
// [렌더링] 1단계 팀장 추첨 화면 (다크 테마)
import { useRealtimeAuction } from '../AuctionScreen/hooks/useRealtimeAuction';
import { TEAM_COUNT } from '../AuctionScreen/types';
import { confirmDialog } from '@/lib/toast';
import { drawLeaders } from './drawActions';

const TIER_COLOR: Record<string, string> = { '1': '#ff9800', '2': '#2196f3', '3': '#4caf50', '4': '#9e9e9e' };

export default function DrawScreen({ isAdmin }: { isAdmin: boolean }) {
    const { participants } = useRealtimeAuction();
    const leaders = participants.filter((p) => p.is_leader);

    const handleDraw = async () => {
        if (leaders.length > 0 && !(await confirmDialog('다시 추첨하면 기존 팀 구성과 경매 내역이 모두 초기화됩니다.\n계속하시겠습니까?'))) return;
        await drawLeaders();
    };

    return (
        <div style={{ padding: 20, color: '#eee' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h2 style={{ margin: 0, color: '#ff9800' }}>
                    1단계 · 팀장 추첨 <span style={{ fontSize: 14, color: '#aaa' }}>({leaders.length}/{TEAM_COUNT}팀)</span>
                </h2>
                {isAdmin && (
                    <button
                        onClick={handleDraw}
                        style={{ background: '#9c27b0', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 20px', fontWeight: 'bold', fontSize: 15, cursor: 'pointer' }}
                    >
                        {leaders.length > 0 ? '팀장 다시 추첨' : '팀장 추첨'}
                    </button>
                )}
            </div>

            {leaders.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#888', padding: '60px 0' }}>
                    아직 팀장을 추첨하지 않았습니다.{isAdmin ? ' 우측 상단 “팀장 추첨”을 눌러 시작하세요.' : ''}
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, maxWidth: 760, margin: '0 auto' }}>
                    {Array.from({ length: TEAM_COUNT }).map((_, i) => {
                        const teamName = `${i + 1}팀`;
                        const leader = leaders.find((p) => p.team_name === teamName);
                        return (
                            <div key={i} style={{ background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, padding: 16 }}>
                                <div style={{ color: '#777', fontSize: 13, marginBottom: 8 }}>{teamName}</div>
                                {leader ? (
                                    <>
                                        <div style={{ fontWeight: 'bold', fontSize: 16, marginBottom: 6 }}>
                                            {leader.real_name} <span style={{ color: '#ff9800' }}>(팀장)</span>
                                        </div>
                                        <span style={{ background: TIER_COLOR[leader.tier] ?? '#555', color: '#fff', fontSize: 12, padding: '2px 8px', borderRadius: 10 }}>
                                            {leader.tier}티어
                                        </span>
                                    </>
                                ) : (
                                    <div style={{ color: '#555' }}>미배정</div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
