'use client'; 

import { useState, useEffect } from 'react';
import styles from './page.module.css';
import { supabase } from '../lib/supabaseClient'; // (경로 확인 필요 시 수정)
import { toast, confirmDialog } from '../lib/toast';
import AuctionScreen from '../components/AuctionScreen';
import { regenerateAnonymous } from '../components/AuctionScreen/anonActions';

// 메인 컴포넌트 임시 분리
const DrawScreen = () => <div style={{ padding: '20px', textAlign: 'center' }}>1단계: 16인 추첨 화면 (준비 중)</div>;
const ResultScreen = () => <div style={{ padding: '20px', textAlign: 'center' }}>3단계: 최종 팀 편성 결과 화면 (준비 중)</div>;

export default function MainApp() {
  // 상태 관리
  const [currentView, setCurrentView] = useState<'draw' | 'auction' | 'result'>('auction');
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminCode, setAdminCode] = useState('');
  const [revealNames, setRevealNames] = useState(false); // 진행자 실명(비제이명) 공개 토글
    
  // 핵심: 참가자들의 브라우저가 DB를 실시간으로 구독하는 로직
  useEffect(() => {
    const channel = supabase
      .channel('page_state_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'page_state' }, 
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
            <div className={styles.navButtons} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className={styles.adminBadge} style={{ color: '#4caf50', fontWeight: 'bold', marginRight: '10px' }}>
                진행자 모드 활성화
              </span>

              {/* 익명 표시 토글 & 익명 자동 생성 */}
              <button
                onClick={() => setRevealNames((v) => !v)}
                style={{ background: revealNames ? '#4caf50' : '#555', color: '#fff', border: 'none', borderRadius: '4px', padding: '5px 12px', fontWeight: 'bold', cursor: 'pointer' }}
              >
                {revealNames ? '실명 보는 중' : '익명 보는 중'}
              </button>
              <button
                onClick={regenerateAnonymous}
                style={{ background: '#9c27b0', color: '#fff', border: 'none', borderRadius: '4px', padding: '5px 12px', fontWeight: 'bold', cursor: 'pointer' }}
              >
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

              {/* 추가된 모드 해제 버튼 */}
              <button 
                onClick={handleAdminLogout} 
                style={{ 
                  background: '#f44336', 
                  padding: '5px 15px', 
                  border: 'none', 
                  color: 'white', 
                  fontWeight: 'bold', 
                  borderRadius: '4px', 
                  cursor: 'pointer',
                  marginLeft: '10px'
                }}
              >
                모드 해제
              </button>
            </div>
          )}
        </div>
      </header>

      {/* --- 메인 콘텐츠 (SPA 화면 전환 영역) --- */}
      <main className={styles.mainContent}>
        {currentView === 'draw' && <DrawScreen />}
        {currentView === 'auction' && <AuctionScreen isAdmin={isAdmin} revealNames={revealNames} />}
        {currentView === 'result' && <ResultScreen />}
      </main>
    </div>
  );
}