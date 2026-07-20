// components/common/hooks/useAdminNames.ts
// [진행자 전용 실명 맵 훅] { p_token: "실명" }.
// 실명은 participant_secrets(진행자만 RLS 허용)에서 온다 → 진행자 화면에서 "실명 보기"에 사용.
//
// ★ 모듈 캐시: 화면 전환 때마다 이 훅이 새로 mount되며 빈 맵으로 시작하면, 진행자 실명모드에서
//   'anon 이름 → 실명'으로 잠깐 바뀌는 깜빡임이 난다. 마지막으로 불러온 실명을 세션 캐시에 보관해
//   재mount 시 즉시 그 값으로 시작(그 뒤 최신값으로 갱신)한다.
//
// ★ 재조회 트리거가 인원수여선 안 된다: 토큰 회전(팀장 추첨/해제/익명 만들기)은 인원수를 바꾸지
//   않고 p_token 만 전부 갈아치운다. 예전엔 의존성이 [isAdmin, participantCount] 라 재조회가
//   안 걸렸고, 맵이 옛 토큰을 키로 남아 "실명 보는 중"인데 익명이 표시됐다.
//   그래서 토큰 서명(인원수 + 첫/끝 토큰)을 의존성으로 쓴다.
//   ★ 서명만으로는 "비제이명만 수정"을 못 잡는다(토큰·인원 불변) → refresh() 를 노출해
//     참가자 저장 직후 호출부가 강제로 다시 읽게 한다.
// 사용처: SnakeScreen, DrawScreen, ParticipantsScreen.
import { useCallback, useEffect, useState } from 'react';
import { fetchSecretNames } from '../data';
import type { Participant } from '../types';

let cache: Record<string, string> = {}; // 세션 내 마지막 실명 맵(재mount 깜빡임 방지)

// 토큰이 바뀌었는지 O(1)로 판별하는 서명. 회전은 모든 토큰을 바꾸므로 첫/끝만 봐도 반드시 달라진다.
// 등록/삭제는 길이가, 슬롯 재배정은 정렬 순서(첫/끝)가 바뀐다.
function tokenSignature(participants: Participant[]): string {
    if (participants.length === 0) return '0';
    return `${participants.length}|${participants[0].p_token}|${participants[participants.length - 1].p_token}`;
}

// isAdmin이 아니면 실명을 쓰지 않으므로 빈 맵.
// 반환: [실명맵, 강제 재조회 함수].
export function useAdminNames(isAdmin: boolean, participants: Participant[]): [Record<string, string>, () => void] {
    const [names, setNames] = useState<Record<string, string>>(() => (isAdmin ? cache : {}));
    const [manualTick, setManualTick] = useState(0);
    const signature = tokenSignature(participants);

    useEffect(() => {
        if (!isAdmin) return; // 비진행자는 secrets를 읽을 수 없으므로 조회하지 않음
        let alive = true;
        fetchSecretNames().then((n) => {
            cache = n;
            if (alive) setNames(n);
        });
        return () => { alive = false; };
    }, [isAdmin, signature, manualTick]);

    const refresh = useCallback(() => setManualTick((t) => t + 1), []);
    return [names, refresh];
}

// 진행자 모드 해제 시 호출: 메모리에 남은 실명 맵을 비운다.
// (같은 PC를 다른 사람이 쓰는 상황에서 실명이 계속 상주하지 않도록)
export function clearAdminNameCache() {
    cache = {};
}
