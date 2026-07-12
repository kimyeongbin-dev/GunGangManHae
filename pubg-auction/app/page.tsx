'use client';
// app/page.tsx
// ---------------------------------------------------------------------------
// [SPA 루트] 화면(참가자/추첨/경매/스네이크/결과) 전환.
//  · 참가자·추첨·경매·스네이크: 모든 접속자가 자기 nav로 자유 이동(로컬, 서로 독립).
//  · 결과: 진행자만 이동 가능. 진행자가 결과로 넘기면 page_state='result'가 되어
//      (1) 전원이 결과 화면으로 강제 전환되고 (2) 서버(result_names RPC)가 실명을 공개한다.
//  · 즉 page_state(hostPage)는 진행자 전용 — '결과 공개 스위치' + 신규 접속 기본 화면 역할.
//  · 진행자 로그인은 Supabase Auth(이메일+비번). 로그인하면 isAdmin=true(단, 실제 권한은 서버 RLS가 검증).
//  · 광클 방지: window 캡처 리스너로 버튼별 600ms 쓰로틀(모든 버튼 공통, React 디스패치 전 차단).
// ---------------------------------------------------------------------------
import { useState, useEffect } from 'react';
import styles from './page.module.css';
import { supabase } from '@/lib/supabaseClient';
import { toast, confirmDialog } from '@/lib/toast';
import AuctionScreen from '@/components/AuctionScreen';
import DrawScreen from '@/components/DrawScreen';
import ResultScreen from '@/components/ResultScreen';
import SnakeScreen from '@/components/SnakeScreen';
import ParticipantsScreen from '@/components/ParticipantsScreen';
import { regenerateAnonymous } from '@/components/AuctionScreen/anonActions';

// 화면 종류. page_state.current_page 와 동일한 값('participants'는 로컬 브라우즈용이라 결과 게이팅과 무관).
type PageView = 'participants' | 'draw' | 'auction' | 'snake' | 'result';

// 진행자 계정 이메일 (비밀 아님, 아이디 역할). Supabase Auth 계정 및 SQL is_admin()과 반드시 일치.
const ADMIN_EMAIL = 'admin@gungang.local';

export default function MainApp() {
  // hostPage: page_state(공유). 진행자가 정하는 값 = 결과 공개 스위치 + 신규 접속 기본 화면. null=로딩.
  const [hostPage, setHostPage] = useState<PageView | null>(null);
  // localView: 비진행자의 로컬 이동 위치(참가자/추첨/경매/스네이크). 진행자에겐 쓰이지 않음.
  const [localView, setLocalView] = useState<PageView>('auction');
  const [isAdmin, setIsAdmin] = useState(false);            // 진행자 세션 여부(UI용, 실제 권한은 서버 검증)
  const [adminCode, setAdminCode] = useState('');           // 진행자 비밀번호 입력값
  const [revealNames, setRevealNames] = useState(false);    // 진행자 실명(비제이명) 공개 토글

  // page_state 구독: 신규 접속 기본 화면 + 진행자의 '결과' 전환(전원 강제/실명 공개) 감지.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('page_state').select('current_page').eq('id', 1).maybeSingle();
      const initial = (data?.current_page as PageView) ?? 'auction';
      setHostPage(initial);
      setLocalView(initial === 'result' ? 'auction' : initial); // 접속 시 진행자 위치로 착지(결과면 경매 기본)
    })();

    const channel = supabase
      .channel('page_state_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'page_state' },
        (payload) => {
          const next = (payload.new as { current_page: PageView }).current_page;
          if (next) setHostPage(next); // 결과로 바뀌면 비진행자는 아래 view 계산으로 강제 전환됨
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // 진행자 세션 감시: Supabase Auth 세션이 진행자 계정이면 isAdmin. 새로고침해도 유지.
  useEffect(() => {
    const apply = (email: string | undefined) => setIsAdmin(email === ADMIN_EMAIL);
    supabase.auth.getSession().then(({ data }) => apply(data.session?.user.email ?? undefined));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => apply(session?.user.email ?? undefined));
    return () => sub.subscription.unsubscribe();
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

  // 실제 렌더 화면:
  //  · 진행자 → 자기가 고른 화면(hostPage).
  //  · 비진행자 → 진행자가 '결과'로 넘겼으면 강제로 결과, 아니면 자기 로컬 화면(localView).
  const view: PageView | null =
    hostPage === null ? null : isAdmin ? hostPage : hostPage === 'result' ? 'result' : localView;

  // 진행자 화면 전환: page_state 갱신(신규 기본 화면 + 결과 공개 스위치).
  // DB를 먼저 갱신한 뒤 로컬 반영 → 결과 화면의 result_names()가 page_state='result'를 확실히 보게 함.
  // ★ 결과 전환은 전원 실명 공개(블라인드 종료)라 되돌릴 수 없으므로 실수 방지 확인을 받는다.
  const changePageAsAdmin = async (pageName: PageView) => {
    if (
      pageName === 'result' &&
      hostPage !== 'result' &&
      !(await confirmDialog('결과 화면으로 넘기면 전원에게 실명이 공개되고 블라인드가 종료됩니다.\n정말 결과를 공개하시겠습니까?'))
    ) {
      return;
    }
    await supabase.from('page_state').update({ current_page: pageName }).eq('id', 1);
    setHostPage(pageName);
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

  // 진행자 모드 해제 로직
  const handleAdminLogout = async () => {
    if (await confirmDialog('진행자 모드를 해제하시겠습니까?')) {
      await supabase.auth.signOut();
      setAdminCode('');
      toast.info('일반 참가자 모드로 전환되었습니다.');
    }
  };

  return (
    <div className={styles.container}>
      {/* --- 상단 헤더 & 화면 전환 --- */}
      <header className={styles.header}>
        <h1 className={styles.title}>건강만해 블라인드 팀 뽑기</h1>

        <div className={styles.adminSection}>
          {!isAdmin ? (
            <div className={styles.navButtons}>
              {/* 비진행자 자유 이동(결과는 진행자만). 진행자가 결과 발표 중이면 전원 결과로 고정. */}
              {hostPage === 'result' ? (
                <span className={styles.adminBadge}>진행자가 결과를 발표 중입니다</span>
              ) : (
                <>
                  <button
                    onClick={() => setLocalView('participants')}
                    className={`${styles.navBtn} ${view === 'participants' ? styles.active : ''}`}
                  >
                    참가자
                  </button>
                  <button
                    onClick={() => setLocalView('draw')}
                    className={`${styles.navBtn} ${view === 'draw' ? styles.active : ''}`}
                  >
                    팀장 추첨
                  </button>
                  <button
                    onClick={() => setLocalView('auction')}
                    className={`${styles.navBtn} ${view === 'auction' ? styles.active : ''}`}
                  >
                    경매
                  </button>
                  <button
                    onClick={() => setLocalView('snake')}
                    className={`${styles.navBtn} ${view === 'snake' ? styles.active : ''}`}
                  >
                    스네이크
                  </button>
                </>
              )}

              {/* 진행자 로그인 */}
              <div className={styles.loginBox}>
                <input
                  type="password"
                  placeholder="진행자 코드를 입력하세요."
                  value={adminCode}
                  onChange={(e) => setAdminCode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAdminLogin(); }}
                  className={styles.input}
                />
              </div>
              <div>
                <button onClick={handleAdminLogin} className={styles.btn}>로그인</button>
              </div>
            </div>
          ) : (
            <div className={styles.navButtons}>
              {/* 페이지 이동 탭 (한 그룹). 결과로 넘기면 전원 강제 전환 + 실명 공개. */}
              <div className={styles.navGroup}>
                <button
                  onClick={() => changePageAsAdmin('participants')}
                  className={`${styles.navBtn} ${hostPage === 'participants' ? styles.active : ''}`}
                >
                  참가자
                </button>
                <button
                  onClick={() => changePageAsAdmin('draw')}
                  className={`${styles.navBtn} ${hostPage === 'draw' ? styles.active : ''}`}
                >
                  팀장 추첨
                </button>
                <button
                  onClick={() => changePageAsAdmin('auction')}
                  className={`${styles.navBtn} ${hostPage === 'auction' ? styles.active : ''}`}
                >
                  경매
                </button>
                <button
                  onClick={() => changePageAsAdmin('snake')}
                  className={`${styles.navBtn} ${hostPage === 'snake' ? styles.active : ''}`}
                >
                  스네이크
                </button>
                <button
                  onClick={() => changePageAsAdmin('result')}
                  className={`${styles.navBtn} ${hostPage === 'result' ? styles.active : ''}`}
                >
                  결과
                </button>
              </div>

              {/* 진행자 관리 (구분선과 함께 한 덩어리로 이동): 실명/익명 토글 · 익명 재생성 · 모드 해제 */}
              <div className={styles.toolGroup}>
                <button
                  onClick={() => setRevealNames((v) => !v)}
                  className={`${styles.headerBtn} ${revealNames ? styles.headerBtnActive : ''}`}
                >
                  {revealNames ? '실명 보는 중' : '익명 보는 중'}
                </button>
                <button onClick={handleRegenAnon} disabled={anonBusy} className={styles.anonBtn}>
                  {anonBusy ? '생성 중…' : '익명 만들기'}
                </button>
                <button onClick={handleAdminLogout} className={styles.exitBtn}>
                  모드 해제
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* --- 메인 콘텐츠 (SPA 화면 전환 영역) --- */}
      <main className={styles.mainContent}>
        {view === null ? (
          <div className={styles.loading}>불러오는 중…</div>
        ) : (
          <>
            {view === 'participants' && <ParticipantsScreen isAdmin={isAdmin} revealNames={revealNames} />}
            {view === 'draw' && <DrawScreen isAdmin={isAdmin} revealNames={revealNames} />}
            {view === 'auction' && <AuctionScreen isAdmin={isAdmin} revealNames={revealNames} />}
            {view === 'snake' && <SnakeScreen isAdmin={isAdmin} revealNames={revealNames} />}
            {view === 'result' && <ResultScreen />}
          </>
        )}
      </main>
    </div>
  );
}
