-- =====================================================================
-- 0000_schema.sql  —  통합 베이스라인 스키마 (pg_dump --schema-only)
--
-- ★ 이것은 "현재 DB의 전체 스키마 스냅샷"이다(테이블·함수·정책·트리거·뷰·시퀀스·확장).
--   0001~0012 마이그레이션이 전부 반영된 최종 상태를 한 파일로 담는다.
--
-- 새 Supabase 프로젝트를 세울 때:
--   · 이 파일 "하나만" 실행하면 현재 스키마가 그대로 선다.
--   · 0001~0012 는 다시 실행하지 않는다(이력용 기록. 특히 0002 는 재실행 불가).
--
-- ※ 선행: Supabase Auth 진행자 계정 생성 + 가입 차단은 supabase/README.md 참고.
--   생성 방법: npx supabase db dump --db-url "<Session pooler URI>" -f 0000_schema.sql
-- =====================================================================



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."assert_admin"() RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception '권한이 없습니다.' using errcode = '42501';
  end if;
end;
$$;


ALTER FUNCTION "public"."assert_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bump_page_state"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.page_state set updated_at = now() where id = 1;
  return null;
end;
$$;


ALTER FUNCTION "public"."bump_page_state"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce(auth.jwt() ->> 'email', '') = 'admin@gungang.local';
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_bid"("p_target_token" "text", "p_amount" integer, "p_pin" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."place_bid"("p_target_token" "text", "p_amount" integer, "p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."result_names"() RETURNS TABLE("p_token" "text", "real_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select s.p_token, s.real_name
  from public.participant_secrets s
  where coalesce((select reveal_until from public.page_state where id = 1),
'epoch'::timestamptz) > now();
$$;


ALTER FUNCTION "public"."result_names"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."roster_names"() RETURNS TABLE("tier" "text", "real_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select p.tier, s.real_name
  from public.participants p
  join public.participant_secrets s on s.p_token = p.p_token
  order by p.tier, s.real_name;
$$;


ALTER FUNCTION "public"."roster_names"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rotate_participant_tokens"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception '권한이 없습니다.';
  end if;

  -- ★ where 절이 반드시 있어야 한다.
  --   Supabase는 API 역할(anon/authenticated) 세션에 safeupdate 가드를 걸어 두어서
  --   WHERE 없는 UPDATE/DELETE를 '21000: UPDATE requires a WHERE clause'로 거부한다.
  --   security definer로 실행 주체가 바뀌어도 세션 설정은 그대로라 이 가드는 계속 적용된다.
  --   (클라이언트 쿼리들이 .not('p_token','is',null) 같은 '항상 참' 필터를 붙이는 것과 같은 이유)
  update public.participants
    set p_token = 'p_' || replace(gen_random_uuid()::text, '-', '')
    where p_token is not null;
end;
$$;


ALTER FUNCTION "public"."rotate_participant_tokens"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."server_now"() RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE
    AS $$ select now() $$;


ALTER FUNCTION "public"."server_now"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_reveal_window"("p_seconds" integer) RETURNS timestamp with time zone
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_until timestamptz;
begin
  perform public.assert_admin();

  if p_seconds is null or p_seconds <= 0 then
    v_until := null;                       -- 즉시 비공개
  elsif p_seconds > 600 then
    raise exception '공개 시간이 너무 깁니다(최대 600초).';
  else
    v_until := now() + make_interval(secs => p_seconds);
  end if;

  update public.page_state set reveal_until = v_until, updated_at = now() where id = 1;
  return v_until;
end;
$$;


ALTER FUNCTION "public"."set_reveal_window"("p_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."snake_assign_pick"("p_target" "text", "p_team" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_tier text;
begin
  perform public.assert_admin();

  update public.participants
    set team_name = p_team, assigned_randomly = false
    where p_token = p_target
    returning tier into v_tier;

  if v_tier is null then
    raise exception '대상 참가자를 찾을 수 없습니다.';
  end if;

  -- 이미 방향이 있으면 유지, 없으면 '지금까지 방향이 정해진 티어 수'의 짝/홀로 확정.
  -- ★ jsonb 의 키 개수는 jsonb_object_keys(set 반환)를 세어 구한다(jsonb_object_length 는 없는 함수).
  update public.page_state
    set tier_direction = case
          when tier_direction ? v_tier then tier_direction
          else tier_direction || jsonb_build_object(
                 v_tier,
                 case when (select count(*) from jsonb_object_keys(tier_direction)) % 2 = 0
                      then 'asc' else 'desc' end)
        end,
        updated_at = now()
    where id = 1;
end;
$$;


ALTER FUNCTION "public"."snake_assign_pick"("p_target" "text", "p_team" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."snake_cancel_pick"("p_target" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.assert_admin();
  update public.participants
    set team_name = null, assigned_randomly = false
    where p_token = p_target;
  if not found then
    raise exception '대상 참가자를 찾을 수 없습니다.';
  end if;
end;
$$;


ALTER FUNCTION "public"."snake_cancel_pick"("p_target" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."snake_draw_leaders"("p_leader_tier" "text", "p_names" "text"[]) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_tier text;
  v_bad  int;
begin
  perform public.assert_admin();

  select count(*) into v_bad
    from (select tier, count(*) c from public.participants group by tier) x
    where x.c <> 16;
  if v_bad > 0 or (select count(distinct tier) from public.participants) <> 4 then
    raise exception '티어별 정확히 16명이어야 팀장 추첨을 할 수 있습니다.';
  end if;

  if p_leader_tier is not null and p_leader_tier not in ('1','2','3','4') then
    raise exception '팀장 티어 값이 올바르지 않습니다: %', p_leader_tier;
  end if;
  v_tier := coalesce(p_leader_tier, (array['1','2','3','4'])[floor(random() * 4)::int + 1]);

  update public.participants
    set team_name = null, is_leader = false, reveal_name = null, assigned_randomly = false
    where p_token is not null;
  update public.page_state
    set tier_direction = '{}'::jsonb, active_tier = null, reveal_until = null, updated_at = now()
    where id = 1;

  update public.participants
    set p_token = 'p_' || replace(gen_random_uuid()::text, '-', '')
    where p_token is not null;

  perform public.snake_reassign_anonymous(p_names);

  update public.participants p
    set is_leader = true,
        team_name = r.rn::text || '팀',
        reveal_name = s.real_name
    from (
      select p_token, row_number() over (order by random()) as rn
      from public.participants
      where tier = v_tier
    ) r
    left join public.participant_secrets s on s.p_token = r.p_token
    where p.p_token = r.p_token;

  return v_tier;
end;
$$;


ALTER FUNCTION "public"."snake_draw_leaders"("p_leader_tier" "text", "p_names" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."snake_fill_tier_randomly"("p_tier" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_n int;
begin
  perform public.assert_admin();

  select count(*) into v_n from public.participants where tier = p_tier and is_leader = false;
  if v_n <> 16 then
    raise exception '% 티어의 비팀장 인원이 %명입니다. 16명이어야 합니다.', p_tier, v_n;
  end if;

  update public.participants p
    set team_name = t.team, assigned_randomly = true
    from (
      select p_token, (row_number() over (order by random()))::text || '팀' as team
      from public.participants
      where tier = p_tier and is_leader = false
    ) t
    where p.p_token = t.p_token;

  update public.page_state
    set tier_direction = tier_direction - p_tier, updated_at = now()
    where id = 1;
end;
$$;


ALTER FUNCTION "public"."snake_fill_tier_randomly"("p_tier" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."snake_reassign_anonymous"("p_names" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.assert_admin();

  if array_length(p_names, 1) is distinct from 64 then
    raise exception '익명 이름이 %개입니다. 64개가 필요합니다.', coalesce(array_length(p_names, 1), 0);
  end if;

  update public.participants p
    set slot_index = t.new_slot,
        fake_name  = p_names[t.new_slot + 1]
    from (
      select p_token,
             ((tier::int - 1) * 16 + (row_number() over (partition by tier order by random()) - 1))::int as new_slot
      from public.participants
    ) t
    where p.p_token = t.p_token;
end;
$$;


ALTER FUNCTION "public"."snake_reassign_anonymous"("p_names" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."snake_release_leaders"("p_names" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.assert_admin();

  update public.participants
    set team_name = null, is_leader = false, reveal_name = null, assigned_randomly = false
    where p_token is not null;
  update public.page_state
    set tier_direction = '{}'::jsonb, active_tier = null, reveal_until = null, updated_at = now()
    where id = 1;

  update public.participants
    set p_token = 'p_' || replace(gen_random_uuid()::text, '-', '')
    where p_token is not null;

  perform public.snake_reassign_anonymous(p_names);
end;
$$;


ALTER FUNCTION "public"."snake_release_leaders"("p_names" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."snake_reroll_teams"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_leaders int;
begin
  perform public.assert_admin();

  select count(*) into v_leaders from public.participants where is_leader;
  if v_leaders <> 16 then
    raise exception '팀장이 %명입니다. 먼저 팀장 추첨을 해 주세요.', v_leaders;
  end if;

  update public.participants p
    set team_name = m.new_team
    from (
      select n::text || '팀' as old_team,
             (row_number() over (order by random()))::text || '팀' as new_team
      from generate_series(1, 16) n
    ) m
    where p.team_name = m.old_team;
end;
$$;


ALTER FUNCTION "public"."snake_reroll_teams"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."snake_reset_tier"("p_tier" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public.assert_admin();
  update public.participants
    set team_name = null, assigned_randomly = false
    where tier = p_tier and is_leader = false;
  update public.page_state
    set tier_direction = tier_direction - p_tier, updated_at = now()
    where id = 1;
end;
$$;


ALTER FUNCTION "public"."snake_reset_tier"("p_tier" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_leader_pin"("p_pin" "text") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select team_name from public.leader_pins where pin = p_pin;
$$;


ALTER FUNCTION "public"."verify_leader_pin"("p_pin" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."auction_bids" (
    "id" bigint NOT NULL,
    "p_token" "text",
    "real_name" "text",
    "fake_name" "text",
    "bid_amount" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "team_name" "text"
);


ALTER TABLE "public"."auction_bids" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."auction_bids_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."auction_bids_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."auction_bids_id_seq" OWNED BY "public"."auction_bids"."id";



CREATE TABLE IF NOT EXISTS "public"."auction_logs" (
    "id" integer NOT NULL,
    "message" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);

ALTER TABLE ONLY "public"."auction_logs" REPLICA IDENTITY FULL;


ALTER TABLE "public"."auction_logs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."auction_logs_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."auction_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."auction_logs_id_seq" OWNED BY "public"."auction_logs"."id";



CREATE TABLE IF NOT EXISTS "public"."auction_meta" (
    "id" integer DEFAULT 1 NOT NULL,
    "timer_end_at" timestamp with time zone,
    "status" "text" DEFAULT 'idle'::"text",
    "current_p_token" "text"
);


ALTER TABLE "public"."auction_meta" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leader_pins" (
    "team_name" "text" NOT NULL,
    "p_token" "text" NOT NULL,
    "pin" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."leader_pins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."page_state" (
    "id" integer DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "reveal_until" timestamp with time zone,
    "active_tier" "text",
    "tier_direction" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."page_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."participant_secrets" (
    "p_token" "text" NOT NULL,
    "real_name" "text" NOT NULL
);


ALTER TABLE "public"."participant_secrets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."participants" (
    "p_token" "text" NOT NULL,
    "fake_name" "text" NOT NULL,
    "avg_damage" integer NOT NULL,
    "tier" "text" NOT NULL,
    "intro" "text" NOT NULL,
    "team_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "slot_index" integer,
    "is_leader" boolean DEFAULT false,
    "reveal_name" "text",
    "assigned_randomly" boolean DEFAULT false NOT NULL,
    CONSTRAINT "participants_damage_chk" CHECK (("avg_damage" >= 0)),
    CONSTRAINT "participants_slot_range_chk" CHECK ((("slot_index" >= 0) AND ("slot_index" <= 63))),
    CONSTRAINT "participants_team_fmt_chk" CHECK ((("team_name" IS NULL) OR ("team_name" ~ '^([1-9]|1[0-6])팀$'::"text"))),
    CONSTRAINT "participants_tier_chk" CHECK (("tier" = ANY (ARRAY['1'::"text", '2'::"text", '3'::"text", '4'::"text"])))
);


ALTER TABLE "public"."participants" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."participants_public" AS
 SELECT "p_token",
    "tier",
    "fake_name",
    "reveal_name",
    "team_name",
    "is_leader",
    "slot_index",
    "assigned_randomly",
    "avg_damage",
    "intro"
   FROM "public"."participants";


ALTER VIEW "public"."participants_public" OWNER TO "postgres";


ALTER TABLE ONLY "public"."auction_bids" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."auction_bids_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."auction_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."auction_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."auction_bids"
    ADD CONSTRAINT "auction_bids_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auction_logs"
    ADD CONSTRAINT "auction_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auction_meta"
    ADD CONSTRAINT "auction_meta_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leader_pins"
    ADD CONSTRAINT "leader_pins_pin_key" UNIQUE ("pin");



ALTER TABLE ONLY "public"."leader_pins"
    ADD CONSTRAINT "leader_pins_pkey" PRIMARY KEY ("team_name");



ALTER TABLE ONLY "public"."page_state"
    ADD CONSTRAINT "page_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."participant_secrets"
    ADD CONSTRAINT "participant_secrets_pkey" PRIMARY KEY ("p_token");



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_p_token_key" UNIQUE ("p_token");



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_pkey" PRIMARY KEY ("p_token");



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_slot_uniq" UNIQUE ("slot_index") DEFERRABLE INITIALLY DEFERRED;



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_team_tier_uniq" UNIQUE ("team_name", "tier") DEFERRABLE INITIALLY DEFERRED;



CREATE OR REPLACE TRIGGER "participants_bump" AFTER INSERT OR DELETE OR UPDATE ON "public"."participants" FOR EACH STATEMENT EXECUTE FUNCTION "public"."bump_page_state"();



ALTER TABLE ONLY "public"."auction_bids"
    ADD CONSTRAINT "auction_bids_p_token_fkey" FOREIGN KEY ("p_token") REFERENCES "public"."participants"("p_token") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."participant_secrets"
    ADD CONSTRAINT "participant_secrets_p_token_fkey" FOREIGN KEY ("p_token") REFERENCES "public"."participants"("p_token") ON UPDATE CASCADE ON DELETE CASCADE;



CREATE POLICY "admin_all" ON "public"."leader_pins" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin_all" ON "public"."participant_secrets" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin_delete" ON "public"."auction_bids" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "admin_delete" ON "public"."auction_logs" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "admin_delete" ON "public"."auction_meta" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "admin_delete" ON "public"."page_state" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "admin_delete" ON "public"."participants" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "admin_insert" ON "public"."auction_bids" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin_insert" ON "public"."auction_logs" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin_insert" ON "public"."auction_meta" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin_insert" ON "public"."page_state" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin_insert" ON "public"."participants" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin_update" ON "public"."auction_bids" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin_update" ON "public"."auction_logs" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin_update" ON "public"."auction_meta" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin_update" ON "public"."page_state" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "admin_update" ON "public"."participants" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."auction_bids" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."auction_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."auction_meta" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leader_pins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."page_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."participant_secrets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."participants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "read_all" ON "public"."auction_bids" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "read_all" ON "public"."auction_logs" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "read_all" ON "public"."auction_meta" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "read_all" ON "public"."page_state" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "read_all" ON "public"."participants" FOR SELECT TO "authenticated", "anon" USING (true);





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."auction_bids";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."auction_logs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."auction_meta";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."page_state";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."assert_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assert_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."assert_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assert_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bump_page_state"() TO "anon";
GRANT ALL ON FUNCTION "public"."bump_page_state"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bump_page_state"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."place_bid"("p_target_token" "text", "p_amount" integer, "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."place_bid"("p_target_token" "text", "p_amount" integer, "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."place_bid"("p_target_token" "text", "p_amount" integer, "p_pin" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."result_names"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."result_names"() TO "anon";
GRANT ALL ON FUNCTION "public"."result_names"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."result_names"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."roster_names"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."roster_names"() TO "anon";
GRANT ALL ON FUNCTION "public"."roster_names"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."roster_names"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."rotate_participant_tokens"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rotate_participant_tokens"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rotate_participant_tokens"() TO "service_role";



GRANT ALL ON FUNCTION "public"."server_now"() TO "anon";
GRANT ALL ON FUNCTION "public"."server_now"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."server_now"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_reveal_window"("p_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_reveal_window"("p_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."set_reveal_window"("p_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_reveal_window"("p_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."snake_assign_pick"("p_target" "text", "p_team" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."snake_assign_pick"("p_target" "text", "p_team" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."snake_assign_pick"("p_target" "text", "p_team" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."snake_assign_pick"("p_target" "text", "p_team" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."snake_cancel_pick"("p_target" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."snake_cancel_pick"("p_target" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."snake_cancel_pick"("p_target" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."snake_cancel_pick"("p_target" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."snake_draw_leaders"("p_leader_tier" "text", "p_names" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."snake_draw_leaders"("p_leader_tier" "text", "p_names" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."snake_draw_leaders"("p_leader_tier" "text", "p_names" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."snake_draw_leaders"("p_leader_tier" "text", "p_names" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."snake_fill_tier_randomly"("p_tier" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."snake_fill_tier_randomly"("p_tier" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."snake_fill_tier_randomly"("p_tier" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."snake_fill_tier_randomly"("p_tier" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."snake_reassign_anonymous"("p_names" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."snake_reassign_anonymous"("p_names" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."snake_reassign_anonymous"("p_names" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."snake_reassign_anonymous"("p_names" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."snake_release_leaders"("p_names" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."snake_release_leaders"("p_names" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."snake_release_leaders"("p_names" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."snake_release_leaders"("p_names" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."snake_reroll_teams"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."snake_reroll_teams"() TO "anon";
GRANT ALL ON FUNCTION "public"."snake_reroll_teams"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."snake_reroll_teams"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."snake_reset_tier"("p_tier" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."snake_reset_tier"("p_tier" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."snake_reset_tier"("p_tier" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."snake_reset_tier"("p_tier" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."verify_leader_pin"("p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."verify_leader_pin"("p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_leader_pin"("p_pin" "text") TO "service_role";


















GRANT ALL ON TABLE "public"."auction_bids" TO "anon";
GRANT ALL ON TABLE "public"."auction_bids" TO "authenticated";
GRANT ALL ON TABLE "public"."auction_bids" TO "service_role";



GRANT ALL ON SEQUENCE "public"."auction_bids_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."auction_bids_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."auction_bids_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."auction_logs" TO "anon";
GRANT ALL ON TABLE "public"."auction_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."auction_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."auction_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."auction_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."auction_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."auction_meta" TO "anon";
GRANT ALL ON TABLE "public"."auction_meta" TO "authenticated";
GRANT ALL ON TABLE "public"."auction_meta" TO "service_role";



GRANT ALL ON TABLE "public"."leader_pins" TO "anon";
GRANT ALL ON TABLE "public"."leader_pins" TO "authenticated";
GRANT ALL ON TABLE "public"."leader_pins" TO "service_role";



GRANT ALL ON TABLE "public"."page_state" TO "anon";
GRANT ALL ON TABLE "public"."page_state" TO "authenticated";
GRANT ALL ON TABLE "public"."page_state" TO "service_role";



GRANT ALL ON TABLE "public"."participant_secrets" TO "anon";
GRANT ALL ON TABLE "public"."participant_secrets" TO "authenticated";
GRANT ALL ON TABLE "public"."participant_secrets" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."participants" TO "anon";
GRANT ALL ON TABLE "public"."participants" TO "authenticated";
GRANT ALL ON TABLE "public"."participants" TO "service_role";



GRANT ALL ON TABLE "public"."participants_public" TO "service_role";
GRANT SELECT ON TABLE "public"."participants_public" TO "anon";
GRANT SELECT ON TABLE "public"."participants_public" TO "authenticated";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































