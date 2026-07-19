// components/common/hooks/useParticipantCrud.ts
// ---------------------------------------------------------------------------
// [참가자 관리 훅] 진행자의 참가자 등록/수정/삭제.
// ParticipantsScreen이 등록/편집 모달에 콜백으로 내려준다.
//
// ★ 보안 경계: 여기 쓰기는 전부 진행자(authenticated + is_admin) 세션에서만 RLS를 통과한다.
//   실명은 participant_secrets(진행자 전용)에만 저장 — participants에는 절대 넣지 않는다.
// ---------------------------------------------------------------------------
import { supabase } from '@/lib/supabaseClient';
import { toast, confirmDialog } from '@/lib/toast';
import { firstFreeSlotInTier } from '../utils';
import { pickUnusedAnonName } from '../anonNames';
import type { Participant, ModalForm } from '../types';

export function useParticipantCrud(participants: Participant[]) {
    // 참가자 등록(신규) 또는 수정. 호출: ParticipantEditModal의 저장 버튼.
    // 실명(real_name)은 participant_secrets(진행자 전용)에, 나머지는 participants에 나눠 저장한다.
    const saveParticipant = async (form: ModalForm): Promise<boolean> => {
        const { p_token, real_name, tier, avg_damage, intro } = form;
        if (!real_name || !tier || !avg_damage) {
            toast.error('비제이명, 티어, 딜량을 입력하세요.');
            return false;
        }

        // [수정] 티어 변경 시에만 슬롯을 재배치, 실명은 secrets에 upsert.
        if (p_token) {
            const existing = participants.find((p) => p.p_token === p_token);
            let slot_index = existing?.slot_index ?? null;
            if (existing && existing.tier !== tier) {
                const occupied = new Set(
                    participants.filter((p) => p.p_token !== p_token && p.slot_index != null).map((p) => p.slot_index as number),
                );
                const free = firstFreeSlotInTier(tier, occupied);
                if (free === -1) { toast.error(`${tier}티어 자리가 가득 찼습니다.`); return false; }
                slot_index = free;
            }
            const patch: Record<string, unknown> = { tier, avg_damage: parseInt(avg_damage), intro, slot_index };
            if (existing?.is_leader) patch.reveal_name = real_name; // 팀장이면 공개명도 실명으로 동기화
            const { error } = await supabase.from('participants').update(patch).eq('p_token', p_token);
            if (error) { toast.error('저장 에러: ' + error.message); return false; }
            const { error: sErr } = await supabase.from('participant_secrets').upsert({ p_token, real_name });
            if (sErr) { toast.error('실명 저장 에러: ' + sErr.message); return false; }
            return true;
        }

        // [신규] 선택 티어의 첫 빈 슬롯에 배치. reveal_name=null(블라인드).
        //        익명(fake_name)은 기존에 쓰인 이름과 겹치지 않게 자동 생성(이후 '익명 만들기'로 일괄 재배정 가능).
        const occupied = new Set(participants.filter((p) => p.slot_index != null).map((p) => p.slot_index as number));
        const free = firstFreeSlotInTier(tier, occupied);
        if (free === -1) { toast.error(`${tier}티어 자리가 가득 찼습니다.`); return false; }

        const usedNames = participants.map((p) => p.fake_name).filter((n): n is string => !!n);
        const fakeName = pickUnusedAnonName(usedNames); // 현재 사용 중인 익명과 중복되지 않는 이름
        // ★ 토큰에 등록 시각을 넣지 않는다 — p_token은 anon도 읽는 공개 값이라, 시각이 박히면
        //   티어별 등록 순서가 그대로 드러나 명단과 대조될 수 있다. 순수 무작위로만 만든다.
        //   (crypto.randomUUID는 http LAN 접속 시 secure context가 아니라 없을 수 있어 쓰지 않는다)
        const rand = () => Math.random().toString(36).slice(2, 11);
        const newToken = `p_${rand()}${rand()}`;
        const { error } = await supabase.from('participants').insert({
            p_token: newToken, slot_index: free, tier, fake_name: fakeName,
            avg_damage: parseInt(avg_damage), intro, reveal_name: null,
        });
        if (error) { toast.error('저장 에러: ' + error.message); return false; }
        const { error: sErr } = await supabase.from('participant_secrets').insert({ p_token: newToken, real_name });
        if (sErr) { toast.error('실명 저장 에러: ' + sErr.message); return false; }
        return true;
    };

    // 참가자 영구 삭제. 실명(secrets)은 FK on-delete-cascade로 함께 지워진다.
    // 호출: ParticipantEditModal의 삭제 버튼.
    const deleteParticipant = async (p_token: string): Promise<boolean> => {
        if (!p_token) return false;
        if (!(await confirmDialog('해당 참가자 데이터를 영구 삭제하시겠습니까?'))) return false;

        const { error } = await supabase.from('participants').delete().eq('p_token', p_token);
        if (error) { toast.error('삭제 실패: ' + error.message); return false; }
        return true;
    };

    return { saveParticipant, deleteParticipant };
}
