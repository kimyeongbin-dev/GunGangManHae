'use client'; 

import { useState, useEffect } from 'react';
import styles from './page.module.css';
import { supabase } from '../lib/supabaseClient'; // (경로 확인 필요 시 수정)
import { toast, confirmDialog } from '../lib/toast';
import AuctionScreen from '../components/AuctionScreen';
import DrawScreen from '../components/DrawScreen';
import { regenerateAnonymous } from '../components/AuctionScreen/anonActions';

// 3단계 결과 화면 (준비 중)
const ResultScreen = () => <div className={styles.placeholder}>3단계: 최종 팀 편성 결과 화면 (준비 중)</div>;

export default function MainApp() {
  // 상태 관리
  // null = page_state 아직 로드 전 (초기 경매창 반짝임 방지)
  const [currentView, setCurrentView] = useState<'draw' | 'auction' | 'result' | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminCode, setAdminCode] = useState('');
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

  // 진행자 버튼 로직 (DB 업데이트를 통해 모든 참가자 화면 동기화)
  const changePageAsAdmin = async (pageName: 'draw' | 'auction' | 'result') => {
    setCurrentView(pageName); // 내 화면 즉시 변경
    // Supabase DB 업데이트 로직
    await supabase.from('page_state').update({ current_page: pageName }).eq('id', 1); 
  };
  
  // 진행자 인증 로직
  const handleAdminLogin = () => {
    if (adminCode === '0000') {
      setIsAdmin(true);
      toast.success('진행자 모드로 전환되었습니다.');
    } else {
      toast.error('코드가 일치하지 않습니다.');
    }
  };

  // 진행자 모드 해제 로직
  const handleAdminLogout = async () => {
    if (await confirmDialog('진행자 모드를 해제하시겠습니까?')) {
      setIsAdmin(false);
      setAdminCode(''); // 입력된 코드 초기화
      toast.info('일반 참가자 모드로 전환되었습니다.');
    }
  };

  return (
    <div className={styles.container}>
      {/* --- 상단 헤더 & 진행자 컨트롤 --- */}
      <header className={styles.header}>
        <h1 className={styles.title}>PUBG 블라인드 팀 뽑기</h1>
        
        <div className={styles.adminSection}>
          {!isAdmin ? (
            <div className={styles.loginBox}>
              <input 
                type="password" 
                placeholder="진행자 코드" 
                value={adminCode} 
                onChange={(e) => setAdminCode(e.target.value)} 
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
            {currentView === 'draw' && <DrawScreen isAdmin={isAdmin} />}
            {currentView === 'auction' && <AuctionScreen isAdmin={isAdmin} revealNames={revealNames} />}
            {currentView === 'result' && <ResultScreen />}
          </>
        )}
      </main>
    </div>
  );
}