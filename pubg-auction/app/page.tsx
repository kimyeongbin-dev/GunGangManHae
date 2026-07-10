'use client';
// app/page.tsx
// ---------------------------------------------------------------------------
// [SPA 루트] 3개 화면(추첨/경매/결과)을 전환하는 최상위 컴포넌트.
//  · 화면 전환은 page_state 테이블로 "공유"된다 → 진행자가 바꾸면 모든 접속자가 실시간 동기화.
//  · 진행자 인증은 Supabase Auth(이메일+비번). 로그인하면 isAdmin=true.
//  · 헤더에서 진행자는 화면 전환·익명/실명 토글·익명 재생성을 제어한다.
// 'use client'는 진입점인 여기만 있으면 되고, 하위 컴포넌트는 상속받는다.
// ---------------------------------------------------------------------------
import { useState, useEffect } from 'react';
import styles from './page.module.css';
import { supabase } from '@/lib/supabaseClient';
import { toast, confirmDialog } from '@/lib/toast';
import AuctionScreen from '@/components/AuctionScreen';
import DrawScreen from '@/components/DrawScreen';
import ResultScreen from '@/components/ResultScreen';
import { regenerateAnonymous } from '@/components/AuctionScreen/anonActions';

// 공유 화면 종류. page_state.current_page 와 동일한 값.
type PageView = 'draw' | 'auction' | 'result';

// 진행자 계정 이메일 (비밀 아님, 아이디 역할). Supabase Auth 계정 및 SQL is_admin()과 반드시 일치.
const ADMIN_EMAIL = 'admin@gungang.local';

export default function MainApp() {
  // currentView: 현재 보이는 화면. null = page_state 로드 전(초기 화면 반짝임 방지용 로딩 상태).
  const [currentView, setCurrentView] = useState<PageView | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);            // 진행자 세션 여부
  const [adminCode, setAdminCode] = useState('');           // 진행자 비밀번호 입력값
  const [revealNames, setRevealNames] = useState(false);    // 진행자 실명(비제이명) 공개 토글

  // 공유 화면(page_state) 구독: 새 접속자는 현재 화면을 그대로 보고, 이후 변경도 실시간 반영.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('page_state').select('current_page').eq('id', 1).maybeSingle();
      setCurrentView((data?.current_page as PageView) ?? 'auction');
    })();

    const channel = supabase
      .channel('page_state_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'page_state' },
        (payload) => {
          const next = (payload.new as { current_page: PageView }).current_page;
          if (next) setCurrentView(next); // DB 변경 감지 시 즉각 화면 전환
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

  // 진행자 화면 전환: page_state를 갱신하면 모든 접속자가 동기화된다.
  // DB를 먼저 갱신한 뒤 로컬 전환 → 결과 화면의 result_names()가 page_state='result'를 확실히 보게 함.
  const changePageAsAdmin = async (pageName: PageView) => {
    await supabase.from('page_state').update({ current_page: pageName }).eq('id', 1);
    setCurrentView(pageName);
  };
  
  // 진행자 인증 로직 (Supabase Auth: 서버에서 비밀번호 검증 → JWT 발급)
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
      {/* --- 상단 헤더 & 진행자 컨트롤 --- */}
      <header className={styles.header}>
        <h1 className={styles.title}>건강만해 블라인드 팀 뽑기</h1>

        <div className={styles.adminSection}>
          {!isAdmin ? (
            <div className={styles.loginBox}>
              <input
                type="password"
                placeholder="진행자 비밀번호"
                value={adminCode}
                onChange={(e) => setAdminCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdminLogin(); }}
                className={styles.input}
              />
              <button onClick={handleAdminLogin} className={styles.btn}>진행자 인증</button>
            </div>
          ) : (
            <div className={styles.navButtons}>
              <span className={styles.adminBadge}>
                진행자 모드 활성화
              </span>

              {/* 익명 표시 토글 & 익명 자동 생성 */}
              <button
                onClick={() => setRevealNames((v) => !v)}
                className={`${styles.headerBtn} ${revealNames ? styles.headerBtnActive : ''}`}
              >
                {revealNames ? '실명 보는 중' : '익명 보는 중'}
              </button>
              <button onClick={regenerateAnonymous} className={styles.anonBtn}>
                익명 만들기
              </button>

              {/* 화면 전환 버튼들 (진행자가 누르면 전원 동기화) */}
              <button
                onClick={() => changePageAsAdmin('draw')}
                className={`${styles.navBtn} ${currentView === 'draw' ? styles.active : ''}`}
              >
                1. 추첨
              </button>
              <button
                onClick={() => changePageAsAdmin('auction')}
                className={`${styles.navBtn} ${currentView === 'auction' ? styles.active : ''}`}
              >
                2. 경매
              </button>
              <button
                onClick={() => changePageAsAdmin('result')}
                className={`${styles.navBtn} ${currentView === 'result' ? styles.active : ''}`}
              >
                3. 결과
              </button>

              {/* 모드 해제 버튼 */}
              <button onClick={handleAdminLogout} className={styles.exitBtn}>
                모드 해제
              </button>
            </div>
          )}
        </div>
      </header>

      {/* --- 메인 콘텐츠 (SPA 화면 전환 영역) --- */}
      <main className={styles.mainContent}>
        {currentView === null ? (
          <div className={styles.loading}>불러오는 중…</div>
        ) : (
          <>
            {currentView === 'draw' && <DrawScreen isAdmin={isAdmin} revealNames={revealNames} />}
            {currentView === 'auction' && <AuctionScreen isAdmin={isAdmin} revealNames={revealNames} />}
            {currentView === 'result' && <ResultScreen />}
          </>
        )}
      </main>
    </div>
  );
}