-- =====================================================================
-- 0002_hide_real_names.sql
-- 블라인드 강제: 실명(real_name)을 anon/Realtime에서 제거.
--   - participant_secrets : 실명 보관 (진행자만 접근, Realtime 미등록)
--   - participants.reveal_name : 공개 표시용 (팀장만 채워짐 / 나머지 null=블라인드)
--   - result_names() RPC : page_state='result'일 때만 전체 실명 공개
-- 선행: 0001_security_lockdown.sql 실행 완료(is_admin 존재)
-- =====================================================================

-- 1) 실명 보관 테이블 (진행자 전용)
create table if not exists public.participant_secrets (
  p_token   text primary key references public.participants(p_token) on delete cascade,
  real_name text not null
);
alter table public.participant_secrets enable row level security;
drop policy if exists admin_all on public.participant_secrets;
create policy admin_all on public.participant_secrets
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 2) 기존 실명을 secrets로 이관
insert into public.participant_secrets (p_token, real_name)
  select p_token, real_name from public.participants
  on conflict (p_token) do update set real_name = excluded.real_name;

-- 3) 공개 표시용 컬럼 추가 후 팀장만 공개
alter table public.participants add column if not exists reveal_name text;
update public.participants set reveal_name = real_name where is_leader is true;

-- 4) participants에서 real_name 제거 → 더 이상 anon/Realtime로 나가지 않음
alter table public.participants drop column if exists real_name;

-- 5) 결과 공개용: page_state가 'result'일 때만 전체 실명 반환
create or replace function public.result_names()
returns table(p_token text, real_name text)
language sql
stable
security definer
set search_path = public
as $$
  select s.p_token, s.real_name
  from public.participant_secrets s
  where (select current_page from public.page_state where id = 1) = 'result';
$$;
grant execute on function public.result_names() to anon, authenticated;
