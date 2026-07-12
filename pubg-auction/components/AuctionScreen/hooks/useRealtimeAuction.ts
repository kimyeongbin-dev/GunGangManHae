// components/AuctionScreen/hooks/useRealtimeAuction.ts
// 실시간 데이터(참가자/입찰/로그)는 앱 루트의 RealtimeAuctionProvider가 한 번만 구독·보관한다.
// 이 훅은 그 Context를 읽어 모든 화면에 같은 데이터를 준다 → 페이지 전환 시 재fetch/깜빡임 없음.
export { useRealtimeAuction } from './RealtimeAuctionProvider';
