// components/AuctionScreen/hooks/useAdminNames.ts
// [진행자 전용] 실명(real_name) 맵. participant_secrets는 진행자만 RLS로 읽을 수 있다.
// 참가자 목록이 바뀔 때(등록/삭제/추첨) 다시 불러온다.
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

async function fetchSecrets(): Promise<Record<string, string>> {
    const { data } = await supabase.from('participant_secrets').select('p_token, real_name');
    const rows = (data ?? []) as { p_token: string; real_name: string }[];
    const map: Record<string, string> = {};
    rows.forEach((r) => { map[r.p_token] = r.real_name; });
    return map;
}

// isAdmin이 아니면 항상 빈 맵. participantCount로 변동 시 갱신.
export function useAdminNames(isAdmin: boolean, participantCount: number) {
    const [names, setNames] = useState<Record<string, string>>({});
    useEffect(() => {
        const load = async () => {
            if (!isAdmin) { return; }
            setNames(await fetchSecrets());
        };
        load();
    }, [isAdmin, participantCount]);
    return names;
}
