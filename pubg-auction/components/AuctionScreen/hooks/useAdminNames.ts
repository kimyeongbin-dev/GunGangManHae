// components/AuctionScreen/hooks/useAdminNames.ts
// [진행자 전용 실명 맵 훅] { p_token: "실명" }.
// 실명은 participant_secrets(진행자만 RLS 허용)에서 온다 → 진행자 화면에서 "실명 보기"에 사용.
// 참가자 목록이 바뀔 때(등록/삭제/추첨)마다 다시 불러온다.
//
// 사용처: AuctionScreen(index.tsx) — showReal일 때만 이 맵을 하위 컴포넌트에 realNames로 내려
//        참가자를 실명으로 표시(participantLabel). 편집 모달의 실명 채우기에도 쓰인다.
import { useEffect, useState } from 'react';
import { fetchSecretNames } from '../auctionData';

// isAdmin이 아니면 항상 빈 맵. participantCount 변동 시 재조회.
export function useAdminNames(isAdmin: boolean, participantCount: number) {
    const [names, setNames] = useState<Record<string, string>>({});
    useEffect(() => {
        const load = async () => {
            if (!isAdmin) return; // 비진행자는 secrets를 읽을 수 없으므로 조회하지 않음
            setNames(await fetchSecretNames());
        };
        load();
    }, [isAdmin, participantCount]);
    return names;
}
