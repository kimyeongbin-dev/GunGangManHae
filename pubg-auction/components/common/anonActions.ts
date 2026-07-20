// components/common/anonActions.ts
// 익명(fake_name) 재배정 + 동일 티어 내 그리드 슬롯 셔플.
// 실제 쓰기는 서버의 snake_reassign_anonymous RPC 가 한 트랜잭션으로 처리한다.
// 여기서는 익명 이름 풀만 만들어 넘긴다 — 이름 테마를 SQL 에 중복 정의하지 않기 위해서다.
//
// ★ 예전에는 64건을 8건씩 나눠 PATCH 했다. 중간 청크가 실패하면 앞 청크의 slot_index 만
//   새 값이 되어 뒤 청크의 옛 값과 겹쳤고, 그리드가 슬롯 기준 렌더라 참가자가 화면에서 사라졌다.
//   RPC 한 번이면 전부 반영되거나 전부 롤백된다.
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/lib/toast';
import { generateAnonNames } from './anonNames';
import { runExclusive } from './actionLock';
import { SLOT_COUNT } from './types';

// [코어] 익명 이름 64개를 만들어 서버에 재배정을 요청한다.
// 토스트를 띄우지 않으므로 다른 흐름(추첨/해제)에서 조용히 재사용할 수 있다.
// 호출: regenerateAnonymous(아래). 팀장 추첨/해제는 서버 RPC 안에서 같은 로직을 직접 수행한다.
async function reassignAnonymous(): Promise<boolean> {
    const { error } = await supabase.rpc('snake_reassign_anonymous', {
        p_names: generateAnonNames(SLOT_COUNT),
    });
    if (error) {
        console.error('[익명 재배정] 실패:', error);
        return false;
    }
    return true;
}

// [진행자] 헤더 '익명 만들기' 버튼 핸들러.
// 판을 바꾸는 작업이므로 전역 잠금(runExclusive)으로 다른 파괴적 조작과 겹치지 않게 한다.
export async function regenerateAnonymous(): Promise<void> {
    await runExclusive(async () => {
        const ok = await reassignAnonymous();
        if (!ok) { toast.error('익명 생성에 실패했습니다.'); return; }
        toast.success('익명이 생성되었습니다.');
    });
}
