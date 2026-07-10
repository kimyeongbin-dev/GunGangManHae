'use client'; 

import { useState, useEffect } from 'react';
import styles from './page.module.css';
import { supabase } from '../lib/supabaseClient'; // (경로 확인 필요 시 수정)
import { toast, confirmDialog } from '../lib/toast';
import AuctionScreen from '../components/AuctionScreen';
import DrawScreen from '../components/DrawScreen';
import ResultScreen from '../components/ResultScreen';
import { regenerateAnonymous } from '../components/AuctionScreen/anonActions';

// 진행자 계정 이메일 (비밀 아님). Supabase Auth의 계정 이메일 및 SQL is_admin()과 반드시 일치.
const ADMIN_EMAIL = 'admin@gungang.local';

export default function MainApp() {
  // 상태 관리
  // null = page_state 아직 로드 전 (초기 경매창 반짝임 방지)
  const [currentView, setCurrentView] = useState<'draw' | 'auction' | 'result' | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminCode, setAdminCode] = useState(''); // 진행자 비밀번호 입력값
  const [revealNames, setRevealNames] = useState(false); // 진행자 실명(비제이명) 공개 토글
    
  // 핵심: 참가자들의 브라우저가 DB를 실시간으로 구독하는 로직
  useEffect(() => {
    // 초기 로드: 현재 공유 페이지(page_state)를 반영 → 새 접속자도 같은 화면을 봄
    (async () => {
      const { data } = await supabase.from('page_state').select('current_page').eq('id', 1).maybeSingle();
      setCurrentView((data?.current_page as 'draw' | 'auction' | 'result') ?? 'auction');
    })();

    const channel = supabase
      .channel('page_state_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'page_state' },
        (payload) => {
          // DB 변경 감지 시 즉각 화면 전환
          const next = (payload.new as { current_page: 'draw' | 'auction' | 'result' }).current_page;
          if (next) setCurrentView(next);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel) };
  }, []);

  // 진행자 세션 감시: Supabase Auth 세션이 진행자 계정이면 isAdmin. 새로고침해도 유지.
  useEffect(() => {
    const apply = (email: string | undefined) => setIsAdmin(email === ADMIN_EMAIL);
    supabase.auth.getSession().then(({ data }) => apply(data.session?.user.email ?? undefined));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => apply(session?.user.email ?? undefined));
    return () => sub.subscription.unsubscribe();
  }, []);

  // 진행자 버튼 로직 (DB 업데이트를 통해 모든 참가자 화면 동기화)
  // DB를 먼저 갱신한 뒤 화면 전환 → 결과 화면의 result_names()가 page_state='result'를 보게 함
  const changePageAsAdmin = async (pageName: 'draw' | 'auction' | 'result') => {
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

              {/* 화면 전환 버튼들 */}
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