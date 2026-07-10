-- =====================================================================
-- 0001_security_lockdown.sql
-- 건강만해 경매 보안 강화
--   - anon(참가자/관전자)  : 읽기 전용
--   - 진행자(Supabase Auth): 모든 직접 쓰기 (is_admin)
--   - 팀장(PIN)            : place_bid RPC 로만 입찰 (참가자는 입찰 불가)
--
-- 실행 순서
--   1) Supabase 대시보드 > Authentication > Users > "Add user" 로
--      진행자 계정 1개 생성 (이메일 = 아래 ADMIN_EMAIL 과 반드시 일치, 비번 지정)
--   2) Authentication > Providers > Email 에서
--      "Allow new users to sign up" 끄기 (진행자 외 가입 차단)
--   3) 이 파일 전체를 SQL Editor 에 붙여 실행
-- =====================================================================

-- ---------- 0) 진행자 판별 ----------
-- ADMIN_EMAIL: 이 한 줄만 바꾸면 됨 (1번에서 만든 계정 이메일과 동일해야 함)
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'admin@gungang.local';
$$;

-- ---------- 1) 팀장 PIN 테이블 (비밀: anon 접근 불가, Realtime 미등록) ----------
create table if not exists public.leader_pins (
  team_name  text primary key,
  p_token    text not null,
  pin        text not null unique,
  created_at timestamptz not null default now()
);
alter table public.leader_pins enable row level security;

-- ---------- 2) 기존 정책 전부 제거 (드리프트 무시하고 깨끗이 재구성) ----------
do $$
declare r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('participants','auction_bids','auction_meta',
                        'auction_logs','page_state','leader_pins')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------- 3) 읽기: anon + authenticated 모두 허용 ----------
create policy read_all on public.participants for select to anon, authenticated using (true);
create policy read_all on public.auction_bids for select to anon, authenticated using (true);
create policy read_all on public.auction_meta for select to anon, authenticated using (true);
create policy read_all on public.auction_logs for select to anon, authenticated using (true);
create policy read_all on public.page_state   for select to anon, authenticated using (true);

-- ---------- 4) 쓰기: 진행자(authenticated + is_admin)만 직접 허용 ----------
-- anon 은 어떤 쓰기 정책도 없으므로 전부 거부. 참가자 입찰은 오직 place_bid RPC.
do $$
declare t text;
begin
  foreach t in array array['participants','auction_bids','auction_meta','auction_logs','page_state']
  loop
    execute format(
      'create policy admin_insert on public.%I for insert to authenticated with check (public.is_admin())', t);
    execute format(
      'create policy admin_update on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    execute format(
      'create policy admin_delete on public.%I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- ---------- 5) leader_pins: 진행자만 읽기/쓰기 (PIN 배포용) ----------
create policy admin_all on public.leader_pins
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- 6) 팀장 PIN 검증 (팀장 입장 로그인용) ----------
-- 유효하면 team_name 반환, 아니면 null. SECURITY DEFINER 로 leader_pins 를 대신 조회.
create or replace function public.verify_leader_pin(p_pin text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select team_name from public.leader_pins where pin = p_pin;
$$;
grant execute on function public.verify_leader_pin(text) to anon, authenticated;

-- ---------- 7) 입찰 RPC (참가자→팀장 유일한 공개 쓰기 경로) ----------
-- 팀장 PIN 검증 + 경매상태 + 티어중복 + 최고가 + 예산 + 10초룰을 서버에서 최종 검증.
create or replace function public.place_bid(
  p_target_token text,
  p_amount       int,
  p_pin          text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team    text;
  v_meta    public.auction_meta%rowtype;
  v_target  public.participants%rowtype;
  v_highest int;
  v_spent   int;
  v_budget  constant int := 10000;   -- TEAM_BUDGET (types.ts 와 동일하게 유지)
begin
  -- (1) PIN -> 팀 (팀장만 입찰 가능. 참가자는 PIN 이 없어 여기서 차단)
  select team_name into v_team from public.leader_pins where pin = p_pin;
  if v_team is null then
    raise exception '입찰 권한이 없습니다. (PIN을 확인하세요)';
  end if;

  -- (2) 경매 진행 상태 (공유 대상 + 타이머)
  select * into v_meta from public.auction_meta where id = 1;
  if v_meta.current_p_token is distinct from p_target_token then
    raise exception '현재 경매 대상이 아닙니다.';
  end if;
  if v_meta.timer_end_at is null or v_meta.timer_end_at <= now() then
    raise exception '경매가 진행 중이 아닙니다.';
  end if;

  -- (3) 대상 참가자
  select * into v_target from public.participants where p_token = p_target_token;
  if not found then
    raise exception '대상 참가자를 찾을 수 없습니다.';
  end if;
  if v_target.team_name is not null then
    raise exception '이미 낙찰된 참가자입니다.';
  end if;

  -- (4) 팀당 티어별 1명 (팀장 포함해서 같은 티어가 이미 있으면 차단)
  perform 1 from public.participants
    where team_name = v_team and tier = v_target.tier;
  if found then
    raise exception '이미 %티어 팀원이 있어 입찰할 수 없습니다.', v_target.tier;
  end if;

  -- (5) 금액 / 최고가
  if p_amount is null or p_amount <= 0 then
    raise exception '입찰 금액이 올바르지 않습니다.';
  end if;
  select coalesce(max(bid_amount), 0) into v_highest
    from public.auction_bids where p_token = p_target_token;
  if p_amount <= v_highest then
    raise exception '현재 최고가(%P)보다 높아야 합니다.', v_highest;
  end if;

  -- (6) 예산 = 확정 팀원(비팀장)들의 최종 낙찰가 합
  select coalesce(sum(fp), 0) into v_spent from (
    select (select coalesce(max(b.bid_amount), 0)
              from public.auction_bids b where b.p_token = p.p_token) as fp
    from public.participants p
    where p.team_name = v_team and p.is_leader = false
  ) s;
  if p_amount > v_budget - v_spent then
    raise exception '남은 예산(%P)을 초과했습니다.', v_budget - v_spent;
  end if;

  -- (7) 입찰 기록 + 로그 (로그 insert 는 definer 권한으로 통과 → 방송 토스트 정상)
  insert into public.auction_bids (p_token, team_name, bid_amount)
    values (p_target_token, v_team, p_amount);
  insert into public.auction_logs (message)
    values ('[' || v_team || '] ' || p_amount || 'P 입찰!');

  -- (8) 10초 룰: 남은 시간 10초 이하이면 10초로 연장
  if v_meta.timer_end_at - now() <= interval '10 seconds' then
    update public.auction_meta set timer_end_at = now() + interval '10 seconds' where id = 1;
    insert into public.auction_logs (message) values ('입찰 발생! 종료 시간 10초 연장!');
  end if;
end;
$$;
grant execute on function public.place_bid(text, int, text) to anon, authenticated;

-- =====================================================================
-- 끝. 검증용(선택): 아래로 정책이 의도대로 깔렸는지 확인 가능
--   select tablename, policyname, cmd, roles from pg_policies
--   where schemaname='public' order by tablename, cmd;
-- =====================================================================
