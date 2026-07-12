// components/AuctionScreen/hooks/useAdminNames.ts
// [진행자 전용 실명 맵 훅] { p_token: "실명" }.
// 실명은 participant_secrets(진행자만 RLS 허용)에서 온다 → 진행자 화면에서 "실명 보기"에 사용.
// 참가자 목록이 바뀔 때(등록/삭제/추첨)마다 다시 불러온다.
//
// ★ 모듈 캐시: 화면 전환 때마다 이 훅이 새로 mount되며 빈 맵으로 시작하면, 진행자 실명모드에서
//   'anon 이름 → 실명'으로 잠깐 바뀌는 깜빡임이 난다. 마지막으로 불러온 실명을 세션 캐시에 보관해
//   재mount 시 즉시 그 값으로 시작(그 뒤 최신값으로 갱신)한다.
//
// 사용처: AuctionScreen 등 — showReal일 때만 이 맵을 하위에 realNames로 내려 실명 표시.
import { useEffect, useState } from 'react';
import { fetchSecretNames } from '../auctionData';

let cache: Record<string, string> = {}; // 세션 내 마지막 실명 맵(재mount 깜빡임 방지)

// isAdmin이 아니면 실명을 쓰지 않으므로 빈 맵. participantCount 변동 시 재조회.
export function useAdminNames(isAdmin: boolean, participantCount: number) {
    const [names, setNames] = useState<Record<string, string>>(() => (isAdmin ? cache : {}));
    useEffect(() => {
        if (!isAdmin) return; // 비진행자는 secrets를 읽을 수 없으므로 조회하지 않음
        fetchSecretNames().then((n) => {
            cache = n;
            setNames(n);
        });
    }, [isAdmin, participantCount]);
    return names;
}
