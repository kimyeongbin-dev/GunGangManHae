// lib/supabaseClient.ts
// 앱 전역에서 공유하는 단일 Supabase 클라이언트.
//
// ★ 보안 모델의 전제:
//   여기 쓰이는 anon 키는 브라우저 번들에 노출되는 "공개" 키다(정상). 따라서 실제 보안은
//   전적으로 서버측 RLS + RPC에서 나온다 — anon은 읽기 전용, 쓰기는 진행자 인증(Auth) 또는
//   검증된 RPC(place_bid 등) 뒤에만 존재한다. (정책은 supabase/migrations/*.sql 참고)
//   로그인하면 이 클라이언트가 진행자 세션 JWT를 자동으로 실어 보낸다.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
