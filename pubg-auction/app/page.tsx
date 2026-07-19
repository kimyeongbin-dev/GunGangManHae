'use client';
// app/page.tsx
// ---------------------------------------------------------------------------
// [SPA 루트] 화면(참가자/추첨/스네이크/결과) 전환.
//  · 모든 접속자가 자기 nav로 자유 이동(로컬, 서로 독립) — 결과도 일반 페이지(강제 이동 없음).
//  · 실명 공개는 '전체 공개' 스위치로만 발생: 진행자가 결과 페이지의 '전체 실명 공개' 버튼을 누르면
//      page_state.reveal_until = now+60초 가 되고, 그 시각까지만 result_names() RPC가 전원에게 실명을 반환.
//      만료(60초) 또는 진행자 '모드 해제' 시 자동 비공개. (블라인드 종료는 이 버튼을 눌러야만 발생)
//  · 진행자는 '익명/실명 보는 중' 토글로 자기 화면에서만 실명을 개인 확인(전체 공개와 무관).
//  · 진행자 로그인은 Supabase Auth(이메일+비번). isAdmin은 UI용(실제 권한은 서버 RLS가 검증).
//  · 광클 방지: window 캡처 리스너로 버튼별 600ms 쓰로틀(모든 버튼 공통, React 디스패치 전 차단).
// ---------------------------------------------------------------------------
import { useState, useEffect, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import styles from './page.module.css';
import { supabase } from '@/lib/supabaseClient';
import { toast, confirmDialog } from '@/lib/toast';
import DrawScreen from '@/components/DrawScreen';
import ResultScreen from '@/components/ResultScreen';
import SnakeScreen from '@/components/SnakeScreen';
import ParticipantsScreen from '@/components/ParticipantsScreen';
import { RealtimeProvider } from '@/components/common/hooks/RealtimeProvider';
import { regenerateAnonymous } from '@/components/common/anonActions';

// 화면 종류(모두 로컬 자유 이동).
type PageView = 'participants' | 'draw' | 'snake' | 'result';

// 진행자 계정 이메일 (비밀 아님, 아이디 역할). Supabase Auth 계정 및 SQL is_admin()과 반드시 일치.
const ADMIN_EMAIL = 'admin@gungang.local';
const REVEAL_DURATION_MS = 60_000; // '전체 실명 공개'가 유지되는 시간(이후 자동 비공개)

export default function MainApp() {
  const [view, setView] = useState<PageView>('snake');                  // 로컬 화면(모두 자유 이동)
  const [isAdmin, setIsAdmin] = useState(false);                        // 진행자 세션 여부(UI용, 실제 권한은 서버 검증)
  const [adminCode, setAdminCode] = useState('');                      // 진행자 비밀번호 입력값
  const [revealNames, setRevealNames] = useState(false);               // 진행자 개인 실명 토글(자기 화면만)
  const [revealUntil, setRevealUntil] = useState<string | null>(null); // 전체 실명 공개 만료시각(공유). null=비공개
  const [nowTs, setNowTs] = useState(() => Date.now());                // 만료 판정용 현재시각(공개 중에만 초 단위 갱신)

  // 언로드(탭 닫기) 즉시 비공개 처리용 ref: 언로드 중엔 async/await를 못 쓰므로 값을 동기적으로 참조한다.
  const accessTokenRef = useRef<string | null>(null); // 현재 진행자 JWT (page_state 쓰기 인증용)
  const revealActiveRef = useRef(false);              // 지금 전체 공개 중인지

  // page_state.reveal_until 구독: 진행자의 '전체 공개' 스위치를 전원이 실시간으로 감지.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('page_state').select('reveal_until').eq('id', 1).maybeSingle();
      setRevealUntil((data?.reveal_until as string | null) ?? null);
    })();

    const channel = supabase
      .channel('page_state_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'page_state' },
        (payload) => setRevealUntil((payload.new as { reveal_until: string | null }).reveal_until ?? null),
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // 공개 자동 만료(UI용): 실명 게이팅 자체는 서버(result_names가 reveal_until>now() 검사)가 하고,
  // 여기선 만료 '시점에 1회만' now를 갱신해 화면(버튼 라벨·표시 이름)을 비공개로 되돌린다.
  // Realtime은 행 변경 때만 이벤트를 쏘고 시간 경과로는 안 쏘므로, 이 1회 타이머로 만료 순간을 잡는다.
  useEffect(() => {
    if (!revealUntil) return;
    const ms = Date.parse(revealUntil) - Date.now();
    if (ms <= 0) { setNowTs(Date.now()); return; }
    const id = setTimeout(() => setNowTs(Date.now()), ms);
    return () => clearTimeout(id);
  }, [revealUntil]);

  const publicReveal = !!revealUntil && Date.parse(revealUntil) > nowTs;
  useEffect(() => { revealActiveRef.current = publicReveal; }, [publicReveal]);

  // 진행자 세션 감시: Supabase Auth 세션이 진행자 계정이면 isAdmin. 새로고침해도 유지. JWT는 언로드 처리용으로 ref에도 보관.
  useEffect(() => {
    const apply = (session: Session | null) => {
      setIsAdmin(session?.user.email === ADMIN_EMAIL);
      accessTokenRef.current = session?.access_token ?? null;
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => apply(session));
    return () => sub.subscription.unsubscribe();
  }, []);

  // 탭 닫기/이탈 즉시 비공개: 공개 중이면 언로드 순간 keepalive fetch로 reveal_until=null 전송.
  // (supabase-js update는 언로드 중 취소될 수 있어 raw fetch+keepalive 사용. 60초 만료는 최후 안전망.)
  useEffect(() => {
    const onHide = () => {
      const token = accessTokenRef.current;
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!revealActiveRef.current || !token || !url || !key) return;
      try {
        fetch(`${url}/rest/v1/page_state?id=eq.1`, {
          method: 'PATCH',
          keepalive: true,
          headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ reveal_until: null }),
        });
      } catch {
        /* 언로드 중 실패는 무시 — 60초 만료가 최후 안전망 */
      }
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  // 광클(1초에 수십 번) 방지: 같은 버튼의 연속 클릭을 600ms 쓰로틀한다.
  // ★ React onClickCapture의 stopPropagation()으로는 onClick이 확실히 안 막힌다(경매 시작 중복 발생).
  //   또 Next(app router)는 document에 React를 하이드레이트해 이벤트가 document에 붙으므로, document에 뒤늦게
  //   붙인 리스너는 React보다 늦게 실행된다. → 캡처 경로상 더 위인 window에 붙여 React 디스패치보다 먼저
  //   stopImmediatePropagation으로 차단한다.
  useEffect(() => {
    const times = new WeakMap<Element, number>();
    const onClick = (e: Event) => {
      const btn = (e.target as HTMLElement)?.closest?.('button');
      if (!btn || (btn as HTMLButtonElement).disabled) return;
      const now = Date.now();
      if (now - (times.get(btn) ?? 0) < 600) {
        e.stopImmediatePropagation(); // window 캡처에서 멈춤 → document(React)까지 도달 안 함 → onClick 미발생
        e.preventDefault();
        console.debug('[광클차단] 600ms 내 같은 버튼 재클릭 무시');
        return;
      }
      times.set(btn, now);
    };
    window.addEventListener('click', onClick, true); // window 캡처 = document(React)보다 먼저
    return () => window.removeEventListener('click', onClick, true);
  }, []);

  // '익명 만들기'는 64명 슬롯 재배정이라 동시 실행 시 슬롯이 겹쳐 참가자가 사라진다.
  // 실행 중 버튼을 비활성화해 재클릭을 막는다(원천 차단은 regenerateAnonymous 내부 모듈 잠금이 담당).
  const [anonBusy, setAnonBusy] = useState(false);
  const handleRegenAnon = async () => {
    if (anonBusy) return;
    setAnonBusy(true);
    try {
      await regenerateAnonymous();
    } finally {
      setAnonBusy(false);
    }
  };

  // 전체 실명 공개/비공개 스위치(진행자 전용). on=now+60초, off=null(비공개).
  // RLS로 막히면(진행자 세션 만료 등) Supabase는 "에러 없이 0행"만 갱신하므로 .select()로 반영을 확인한다.
  const setPublicReveal = async (on: boolean): Promise<boolean> => {
    const reveal_until = on ? new Date(Date.now() + REVEAL_DURATION_MS).toISOString() : null;
    const { data, error } = await supabase
      .from('page_state')
      .update({ reveal_until, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .select();
    if (error || !data?.length) {
      toast.error('저장에 실패했습니다.\n진행자 세션이 만료됐을 수 있어요. 모드 해제 후 다시 로그인해 주세요.');
      return false;
    }
    setRevealUntil(reveal_until); // 낙관적 반영(실시간 이벤트로도 곧 동일 갱신)
    return true;
  };

  // 결과 페이지 헤더 버튼: 전체 실명 공개(블라인드 종료 확인) / 비공개. 켜면 60초 뒤 자동 비공개.
  const handleTogglePublicReveal = async () => {
    if (!publicReveal && !(await confirmDialog('지금 전체에게 실명을 공개하면 블라인드가 종료됩니다.\n1분 뒤 자동으로 비공개로 돌아갑니다. 공개할까요?'))) return;
    await setPublicReveal(!publicReveal);
  };

  // 진행자 로그인 로직 (Supabase Auth: 서버에서 비밀번호 검증 → JWT 발급)
  const handleAdminLogin = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email: ADMIN_EMAIL, password: adminCode });
    if (error) {
      toast.error('비밀번호가 일치하지 않습니다.');
      return;
    }
    setAdminCode('');
    toast.success('진행자 모드로 전환되었습니다.');
    // isAdmin은 onAuthStateChange가 반영
  };

  // 진행자 모드 해제: 진행자가 빠지면 전체 실명 공개는 비공개로 고정(로그아웃 전 인증 상태에서 갱신).
  const handleAdminLogout = async () => {
    if (!(await confirmDialog('진행자 모드를 해제하시겠습니까?'))) return;
    await supabase.from('page_state').update({ reveal_until: null, updated_at: new Date().toISOString() }).eq('id', 1);
    setRevealUntil(null);
    await supabase.auth.signOut();
    setAdminCode('');
    toast.info('일반 참가자 모드로 전환되었습니다.');
  };

  return (
    <RealtimeProvider>
    <div className={styles.container}>
      {/* --- 상단 헤더 & 화면 전환 --- */}
      <header className={styles.header}>
        {/* 좌측: 페이지 이동 탭 (모두 동일하게 로컬 이동, 결과 포함) */}
        <div className={styles.navGroup}>
          <button onClick={() => setView('participants')} className={`${styles.navBtn} ${view === 'participants' ? styles.active : ''}`}>참가자</button>
          <button onClick={() => setView('draw')} className={`${styles.navBtn} ${view === 'draw' ? styles.active : ''}`}>팀장 추첨</button>
          <button onClick={() => setView('snake')} className={`${styles.navBtn} ${view === 'snake' ? styles.active : ''}`}>스네이크</button>
          <button onClick={() => setView('result')} className={`${styles.navBtn} ${view === 'result' ? styles.active : ''}`}>결과</button>
        </div>

        {/* 중앙: 로고 + 제목 (좌우 그룹 폭과 무관하게 가운데 열에 고정) */}
        <div className={styles.brand}>
          {/* public/logo.png. 투명 PNG로 교체하면 코드 수정 없이 바로 반영됨(파일명은 ASCII 유지 — 한글명은 preload Link 헤더에서 ByteString 오류) */}
          <img src="/logo.png" alt="건강만해 로고" className={styles.logo} />
          <h1 className={styles.title}>건강만해 블라인드 팀 뽑기</h1>
          <img src="/logo.png" alt="건강만해 로고" className={styles.logo} />
        </div>

        {/* 우측: 진행자 도구(실명 토글·익명 만들기·모드 해제) 또는 진행자 로그인 */}
        <div className={styles.headerRight}>
          {isAdmin ? (
            <>
              {/* 결과 페이지에서만: 전체 실명 공개/비공개 스위치(블라인드 종료 스위치) */}
              {view === 'result' && (
                <button
                  onClick={handleTogglePublicReveal}
                  className={publicReveal ? styles.revealOnBtn : styles.revealBtn}
                >
                  {publicReveal ? '전체 실명 비공개' : '전체 실명 공개'}
                </button>
              )}
              <button
                onClick={() => setRevealNames((v) => !v)}
                className={`${styles.headerBtn} ${revealNames ? styles.headerBtnActive : ''}`}
              >
                {revealNames ? '실명 보는 중' : '익명 보는 중'}
              </button>
              <button onClick={handleRegenAnon} disabled={anonBusy} className={styles.anonBtn}>
                {anonBusy ? '생성 중…' : '익명 만들기'}
              </button>
              <button onClick={handleAdminLogout} className={styles.exitBtn}>모드 해제</button>
            </>
          ) : (
            <>
              <input
                type="password"
                placeholder="진행자 코드를 입력하세요."
                value={adminCode}
                onChange={(e) => setAdminCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdminLogin(); }}
                className={styles.input}
              />
              <button onClick={handleAdminLogin} className={styles.btn}>로그인</button>
            </>
          )}
        </div>
      </header>

      {/* --- 메인 콘텐츠 (SPA 화면 전환 영역) --- */}
      <main className={styles.mainContent}>
        {view === 'participants' && <ParticipantsScreen isAdmin={isAdmin} revealNames={revealNames} />}
        {view === 'draw' && <DrawScreen isAdmin={isAdmin} revealNames={revealNames} />}
        {view === 'snake' && <SnakeScreen isAdmin={isAdmin} revealNames={revealNames} />}
        {view === 'result' && (
          <ResultScreen isAdmin={isAdmin} revealNames={revealNames} publicReveal={publicReveal} />
        )}
      </main>
    </div>
    </RealtimeProvider>
  );
}
