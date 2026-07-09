// app/layout.tsx
import type { Metadata } from 'next';
import './globals.css'; // 이 줄이 반드시 있어야 전체 뼈대 디자인이 적용됩니다.

export const metadata: Metadata = {
  title: 'PUBG 블라인드 팀 뽑기',
  description: '배틀그라운드 64인 팀 뽑기 시스템',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        {children}
      </body>
    </html>
  );
}