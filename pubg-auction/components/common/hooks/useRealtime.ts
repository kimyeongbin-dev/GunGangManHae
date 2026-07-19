// components/common/hooks/useRealtime.ts
// 실시간 참가자 데이터는 앱 루트의 RealtimeProvider가 한 번만 구독·보관한다.
// 이 훅은 그 Context를 읽어 모든 화면에 같은 데이터를 준다 → 페이지 전환 시 재fetch/깜빡임 없음.
export { useRealtime } from './RealtimeProvider';
