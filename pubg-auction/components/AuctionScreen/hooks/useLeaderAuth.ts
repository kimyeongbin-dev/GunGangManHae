// components/AuctionScreen/hooks/useLeaderAuth.ts
// [팀장 인증 로직] 팀장은 PIN으로 '입장'하면 자기 팀으로만 입찰할 수 있다.
// PIN/팀명은 localStorage에 보관해 새로고침해도 유지. 서버 검증은 verify_leader_pin RPC.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

const LS_KEY = 'gg_leader_auth';

export function useLeaderAuth() {
    const [leaderTeam, setLeaderTeam] = useState<string | null>(null);
    const [leaderPin, setLeaderPin] = useState<string | null>(null);

    // 최초 로드 시 저장된 팀장 세션 복원 (setState는 이름있는 함수 경유 → 렌더 중 직접 호출 아님)
    useEffect(() => {
        const restore = () => {
            try {
                const raw = localStorage.getItem(LS_KEY);
                if (!raw) return;
                const { team, pin } = JSON.parse(raw);
                if (team && pin) { setLeaderTeam(team); setLeaderPin(pin); }
            } catch { /* 무시 */ }
        };
        restore();
    }, []);

    // PIN 검증 → 성공 시 team_name 반환, 실패 시 null
    const loginLeader = async (pin: string): Promise<string | null> => {
        const trimmed = pin.trim();
        if (!trimmed) return null;
        const { data, error } = await supabase.rpc('verify_leader_pin', { p_pin: trimmed });
        if (error || !data) return null;
        const team = data as string;
        setLeaderTeam(team);
        setLeaderPin(trimmed);
        localStorage.setItem(LS_KEY, JSON.stringify({ team, pin: trimmed }));
        return team;
    };

    const logoutLeader = () => {
        setLeaderTeam(null);
        setLeaderPin(null);
        localStorage.removeItem(LS_KEY);
    };

    return { leaderTeam, leaderPin, loginLeader, logoutLeader };
}
