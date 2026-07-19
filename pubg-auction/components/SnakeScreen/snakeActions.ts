// components/SnakeScreen/snakeActions.ts
// ---------------------------------------------------------------------------
// 스네이크 드래프트 관련 DB 액션 (진행자 전용 쓰기).
//   · drawSnakeLeaders : 지정(또는 무작위) 티어 16명을 팀장으로 배정.
//   · releaseLeaders   : 전원 팀장직 해제 → 익명 미배정 상태로 복귀.
//   · assignSnakePick  : 참가자를 현재 차례 팀에 배정(픽 등록).
//   · cancelSnakePick  : 팀 배정 해제(픽 취소, × 버튼).
//   · resetSnakeTier   : 한 티어의 배정을 통째로 초기화.
//   · fillTierRandomly : 한 티어 16명을 통째로 무작위 재배치(누를 때마다 다시 섞임).
//   · rerollTeamOrder  : 팀 번호를 통째로 재배열(= 뽑기 순서 리롤, 뽑힌 팀원도 함께 이동).
//   · fetch/saveActiveTier : 진행자가 보는 '지금 뽑는 티어'를 전원에게 공유.
// 모두 진행자(authenticated + is_admin) 세션에서만 RLS를 통과한다.
// ---------------------------------------------------------------------------
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/lib/toast';
import { TEAM_COUNT } from '../common/types';
import { shuffle } from '../common/utils';
import { resetDraftData, fetchSecretNames, rotateParticipantTokens } from '../common/data';
import { reassignAnonymous } from '../common/anonActions';
import { ALL_TIERS } from './snakeOrder';
import type { Participant } from '../common/types';

// 여러 행을 나눠 보낼 때의 동시 요청 상한. 64건을 한꺼번에 PATCH하면 브라우저가
// net::ERR_INSUFFICIENT_RESOURCES로 일부를 떨어뜨려 배정이 유실된다(anonActions와 동일한 이유).
const CHUNK = 8;

// [진행자] 팀장 추첨: 초기화 → 익명 재배정 → 지정 티어(없으면 무작위) 16명을 팀장으로.
// 팀장은 실명(reveal_name)으로 공개. 나머지 픽 참가자는 결과까지 익명.
export async function drawSnakeLeaders(leaderTier: string | null): Promise<boolean> {
    // ★ 먼저 p_token을 갈아 과거 F12 캡처(팀장 실명↔토큰 쌍)를 무효화한다.
    //   반드시 회전 → 재조회 순서. 낡은 토큰으로는 이후 update가 한 행도 못 맞춘다.
    if (!(await rotateParticipantTokens())) return false;

    const { data, error } = await supabase.from('participants').select('*');
    if (error) { toast.error('참가자 조회 실패: ' + error.message); return false; }
    const participants = (data ?? []) as Participant[];

    // 티어별 인원 확인: 각 티어가 정확히 16명이어야 한다
    // (뽑힌 티어=팀장 16명, 나머지 각 티어=스네이크로 채울 16명).
    for (const t of ALL_TIERS) {
        const n = participants.filter((p) => p.tier === t).length;
        if (n !== TEAM_COUNT) {
            toast.error(`${t}티어가 ${n}명입니다. 팀장 추첨에는 티어별 정확히 ${TEAM_COUNT}명이 필요합니다.`);
            return false;
        }
    }

    // 1) 이전 구성/진행 계획 초기화 (재추첨 = 완전 재설정)
    const resetErr = await resetDraftData({ keepLeaders: false });
    if (resetErr) { toast.error('초기화 실패: ' + resetErr.message); return false; }

    // 2) 익명(fake_name) + 티어 내 슬롯 셔플
    await reassignAnonymous(participants);

    // 3) 팀장 티어 확정 → 그 티어 16명을 팀장으로. 팀(1~16)은 셔플해 배정, 공개명은 실명.
    const tier = leaderTier ?? ALL_TIERS[Math.floor(Math.random() * ALL_TIERS.length)];
    const chosen = shuffle(participants.filter((p) => p.tier === tier));
    const realNames = await fetchSecretNames();
    const results = await Promise.all(
        chosen.map((p, i) =>
            supabase.from('participants')
                .update({ is_leader: true, team_name: `${i + 1}팀`, reveal_name: realNames[p.p_token] ?? null })
                .eq('p_token', p.p_token),
        ),
    );
    if (results.find((r) => r.error)) { toast.error('팀장 배정 중 오류가 발생했습니다.'); return false; }

    return true;
}

// [진행자] 팀장 해제: 초기화(전원 팀장직 박탈) + 익명 재배정 → 전원 익명 미배정으로 복귀.
export async function releaseLeaders(): Promise<boolean> {
    // 팀장 해제도 판을 완전히 되돌리는 지점이므로 토큰까지 함께 간다(회전 → 재조회).
    if (!(await rotateParticipantTokens())) return false;

    const { data } = await supabase.from('participants').select('*');
    const participants = (data ?? []) as Participant[];

    const resetErr = await resetDraftData({ keepLeaders: false });
    if (resetErr) { toast.error('초기화 실패: ' + resetErr.message); return false; }

    await reassignAnonymous(participants);
    return true;
}

// [진행자] 픽 등록: 참가자를 팀에 배정한다(스네이크 현재 차례 팀).
// assigned_randomly=false → 이 티어는 '직접 뽑은 티어'로 집계돼 지그재그 순번에 포함된다.
export async function assignSnakePick(pToken: string, team: string): Promise<boolean> {
    const { error } = await supabase.from('participants')
        .update({ team_name: team, assigned_randomly: false }).eq('p_token', pToken);
    if (error) { toast.error('지명 실패: ' + error.message); return false; }
    return true;
}

// [진행자] 픽 취소: 팀 배정을 해제한다. 취소하면 그 칸이 현재 차례로 되돌아간다.
export async function cancelSnakePick(pToken: string): Promise<boolean> {
    const { error } = await supabase.from('participants')
        .update({ team_name: null, assigned_randomly: false }).eq('p_token', pToken);
    if (error) { toast.error('지명 취소 실패: ' + error.message); return false; }
    return true;
}

// [진행자] 특정 티어 초기화: 그 티어에 배정된 팀원(팀장 제외)을 전부 미배정으로 되돌린다.
// 팀장 티어는 대상이 아니다(is_leader=true는 건드리지 않음).
export async function resetSnakeTier(tier: string): Promise<boolean> {
    const { error } = await supabase.from('participants')
        .update({ team_name: null, assigned_randomly: false }).eq('tier', tier).eq('is_leader', false);
    if (error) { toast.error('티어 초기화 실패: ' + error.message); return false; }
    return true;
}

// [진행자] 티어 랜덤 배치: 그 티어 16명(팀장 제외)을 통째로 1~16팀에 무작위 재배치한다.
// 이미 지명된 칸도 전부 다시 섞이므로, 마음에 안 들면 다시 눌러 새로 돌릴 수 있다.
// assigned_randomly=true로 표시해, 이 티어는 지그재그 '뽑은 순번'에서 빠지게 한다
// (한 명씩 지명한 게 아니라 운에 맡긴 티어라 방향 계산에 끼면 실제 지명 순서와 어긋난다).
export async function fillTierRandomly(tier: string, participants: Participant[]): Promise<boolean> {
    const pool = shuffle(participants.filter((p) => p.tier === tier && !p.is_leader));
    if (pool.length !== TEAM_COUNT) {
        toast.error(`${tier}티어가 ${pool.length}명입니다. 랜덤 배치에는 ${TEAM_COUNT}명이 필요합니다.`);
        return false;
    }

    const assignments = pool.map((p, i) => ({ p_token: p.p_token, team: `${i + 1}팀` }));
    for (let i = 0; i < assignments.length; i += CHUNK) {
        const results = await Promise.all(
            assignments.slice(i, i + CHUNK).map((a) =>
                supabase.from('participants')
                    .update({ team_name: a.team, assigned_randomly: true }).eq('p_token', a.p_token),
            ),
        );
        const firstErr = results.find((r) => r.error)?.error;
        if (firstErr) { toast.error('랜덤 배치 실패: ' + firstErr.message); return false; }
    }
    return true;
}

// [진행자] 뽑기 순서 리롤: 팀 번호(1~16)를 무작위로 재배열한다.
// ★ 팀장만 옮기는 게 아니라 '팀 전체'를 통째로 옮긴다 — 팀장과 이미 뽑힌 팀원이 함께 움직이므로
//   1티어를 다 뽑은 뒤 2티어 차례에 리롤해도 기존 팀 구성이 그대로 유지된다.
//   (예: 3팀 = 팀장 A + 1티어 X 였다면, 리롤 후 7팀 = 팀장 A + 1티어 X)
export async function rerollTeamOrder(participants: Participant[]): Promise<boolean> {
    const leaders = participants.filter((p) => p.is_leader);
    if (leaders.length !== TEAM_COUNT) {
        toast.error(`팀장이 ${leaders.length}명입니다. 먼저 팀장 추첨을 해 주세요.`);
        return false;
    }

    // 팀 번호 → 새 팀 번호 매핑(순열). 배정된 참가자 전원에게 같은 매핑을 적용한다.
    const shuffled = shuffle(Array.from({ length: TEAM_COUNT }, (_, i) => `${i + 1}팀`));
    const remap: Record<string, string> = {};
    for (let i = 0; i < TEAM_COUNT; i++) remap[`${i + 1}팀`] = shuffled[i];

    const assignments = participants
        .filter((p) => p.team_name && remap[p.team_name])
        .map((p) => ({ p_token: p.p_token, team: remap[p.team_name as string] }));

    for (let i = 0; i < assignments.length; i += CHUNK) {
        const results = await Promise.all(
            assignments.slice(i, i + CHUNK).map((a) =>
                supabase.from('participants').update({ team_name: a.team }).eq('p_token', a.p_token),
            ),
        );
        const firstErr = results.find((r) => r.error)?.error;
        if (firstErr) { toast.error('순서 리롤 실패: ' + firstErr.message); return false; }
    }
    return true;
}

// ── 진행 티어 공유 ─────────────────────────────────────────────────────────
// '지금 어느 티어를 뽑는 중인가'는 진행자가 보는 티어를 그대로 따른다.
// 이 값이 있어야 참가자가 다른 티어를 열람하고 있어도 편성표의 '지명 대기'가 전원에게 같게 보인다.

export async function fetchActiveTier(): Promise<string | null> {
    const { data } = await supabase.from('page_state').select('active_tier').eq('id', 1).maybeSingle();
    return (data?.active_tier as string | null) ?? null;
}

// [진행자] 진행 티어 저장 → 전원이 realtime으로 같은 차례를 본다.
// RLS로 막히면 Supabase는 "에러 없이 0행"만 갱신하므로 .select()로 반영을 확인한다.
export async function saveActiveTier(tier: string): Promise<boolean> {
    const { data, error } = await supabase.from('page_state')
        .update({ active_tier: tier, updated_at: new Date().toISOString() })
        .eq('id', 1)
        .select();
    if (error || !data?.length) {
        toast.error('진행 티어 저장에 실패했습니다.\n진행자 세션이 만료됐을 수 있어요.');
        return false;
    }
    return true;
}
