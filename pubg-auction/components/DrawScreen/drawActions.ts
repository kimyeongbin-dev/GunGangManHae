// components/DrawScreen/drawActions.ts
// ---------------------------------------------------------------------------
// 1단계 팀장(뽑기권) 추첨 관련 DB 액션.
//   · drawLeaders   : 무작위 16명을 팀장으로 선정 → 팀 배정 + 공개명 + PIN 발급.
//   · releaseLeaders: 전원 팀장직 해제 → 익명 미배정 상태로 복귀.
// 두 액션 모두 시작 전에 경매 데이터를 완전 초기화(resetAuctionData)하고 익명/슬롯을 다시 섞는다.
// 호출: DrawScreen(index.tsx)의 '팀장 추첨' / '팀장 해제' 버튼 핸들러.
// ---------------------------------------------------------------------------
import { supabase } from '@/lib/supabaseClient';
import { toast } from '@/lib/toast';
import { TEAM_COUNT } from '../AuctionScreen/types';
import { shuffle } from '../AuctionScreen/utils';
import { resetAuctionData, fetchSecretNames } from '../AuctionScreen/auctionData';
import { reassignAnonymous } from '../AuctionScreen/anonActions';
import type { Participant } from '../AuctionScreen/types';

// ── 팀장 PIN 생성 ──────────────────────────────────────────────────────────
// 혼동 문자(O,0,I,1,L 등)를 뺀 6자리 코드. 팀장이 "자기 팀으로만" 입찰할 때의 신원 증명.
// (실제 검증은 서버의 place_bid / verify_leader_pin RPC가 한다. 여기서는 발급만.)
const PIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PIN_LENGTH = 6;

function genPin(): string {
    let s = '';
    for (let i = 0; i < PIN_LENGTH; i++) s += PIN_ALPHABET[Math.floor(Math.random() * PIN_ALPHABET.length)];
    return s;
}

// 서로 겹치지 않는 PIN n개 (leader_pins.pin 은 unique 제약).
function genUniquePins(n: number): string[] {
    const set = new Set<string>();
    while (set.size < n) set.add(genPin());
    return [...set];
}

// ── 액션 ────────────────────────────────────────────────────────────────────

// [진행자] 팀장 추첨: 초기화 → 익명 재배정 → 무작위 16명 선정 → 팀/공개명/PIN 배정.
export async function drawLeaders() {
    const { data, error } = await supabase.from('participants').select('*');
    if (error) { toast.error('참가자 조회 실패: ' + error.message); return; }
    const participants = (data ?? []) as Participant[];
    if (participants.length < TEAM_COUNT) {
        toast.error(`팀장 추첨에는 최소 ${TEAM_COUNT}명이 필요합니다. (현재 ${participants.length}명)`);
        return;
    }

    // 1) 이전 경매/팀 구성/PIN/로그 전부 초기화 (재추첨 = 완전 재설정)
    const resetErr = await resetAuctionData({ keepLeaders: false });
    if (resetErr) { toast.error('초기화 실패: ' + resetErr.message); return; }

    // 2) 익명(fake_name) + 티어 내 슬롯 셔플
    await reassignAnonymous(participants);

    // 3) 무작위 16명 선정 (원본 배열을 건드리지 않도록 복사본을 섞는다)
    const leaders = shuffle([...participants]).slice(0, TEAM_COUNT);

    // 4) 팀장 배정: is_leader + 팀명 + 공개명(reveal_name).
    //    공개명 = 진행자 전용 secrets의 실명 → 팀장만 실명이 공개(anon도 볼 수 있게 됨).
    const realNames = await fetchSecretNames();
    const results = await Promise.all(
        leaders.map((p, i) =>
            supabase.from('participants')
                .update({ is_leader: true, team_name: `${i + 1}팀`, reveal_name: realNames[p.p_token] ?? null })
                .eq('p_token', p.p_token),
        ),
    );
    if (results.find((r) => r.error)) { toast.error('팀장 추첨 중 오류가 발생했습니다.'); return; }

    // 5) 팀장 PIN 발급 (진행자가 각 팀장에게 개별 전달 → 팀장만 입찰 가능)
    const pins = genUniquePins(TEAM_COUNT);
    const pinRows = leaders.map((p, i) => ({ team_name: `${i + 1}팀`, p_token: p.p_token, pin: pins[i] }));
    const { error: pinErr } = await supabase.from('leader_pins').insert(pinRows);
    if (pinErr) { toast.error('팀장 PIN 생성 실패: ' + pinErr.message); return; }
}

// [진행자] 팀장 해제: 초기화(전원 팀장직 박탈) + 익명 재배정 → 전원 익명 미배정으로 복귀.
export async function releaseLeaders() {
    const { data } = await supabase.from('participants').select('*');
    const participants = (data ?? []) as Participant[];

    const resetErr = await resetAuctionData({ keepLeaders: false });
    if (resetErr) { toast.error('초기화 실패: ' + resetErr.message); return; }

    await reassignAnonymous(participants);
}
