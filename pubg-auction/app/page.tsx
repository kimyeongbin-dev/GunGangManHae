'use client'; 

import { useState, useEffect } from 'react';
import styles from './page.module.css';
import { supabase } from '@/lib/supabaseClient'; // (세팅 예정)
import AuctionScreen from '@/components/AuctionScreen';

// 메인 컴포넌트 임시 분리
const DrawScreen = () => <div className={styles.placeholder}>1단계: 16인 추첨 화면 (준비 중)</div>;
const ResultScreen = () => <div className={styles.placeholder}>3단계: 최종 팀 편성 결과 화면 (준비 중)</div>;

export default function MainApp() {
  // 상태 관리 (중복 제거)
  const [currentView, setCurrentView] = useState<'draw' | 'auction' | 'result'>('auction');
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminCode, setAdminCode] = useState('');
    
  // ⭐️ 핵심: 참가자들의 브라우저가 DB를 실시간으로 구독하는 로직
  useEffect(() => {
    const channel = supabase
      .channel('game_state_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_state' }, 
        (payload) => {
          // DB 변경 감지 시 즉각 화면 전환
          setCurrentView(payload.new.current_page); 
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel) };
  }, []);

  // 진행자 버튼 로직 (DB 업데이트를 통해 모든 참가자 화면 동기화)
  const changePageAsAdmin = async (pageName: 'draw' | 'auction' | 'result') => {
    setCurrentView(pageName); // 내 화면 즉시 변경
    // Supabase DB 업데이트 로직
    await supabase.from('game_state').update({ current_page: pageName }).eq('id', 1); 
  };
  
  // 진행자 인증 로직
  const handleAdminLogin = () => {
    if (adminCode === '0000') {
      setIsAdmin(true);
      alert('진행자 모드로 전환되었습니다.');
    } else {
      alert('코드가 일치하지 않습니다.');
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
              <span className={styles.adminBadge}>진행자 모드 활성화</span>
              {/* 버튼 클릭 시 changePageAsAdmin 호출 */}
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
            </div>
          )}
        </div>
      </header>

      {/* --- 메인 콘텐츠 (SPA 화면 전환 영역) --- */}
      <main className={styles.mainContent}>
        {currentView === 'draw' && <DrawScreen />}
        {currentView === 'auction' && <AuctionScreen isAdmin={isAdmin} />}
        {currentView === 'result' && <ResultScreen />}
      </main>
    </div>
  );
}