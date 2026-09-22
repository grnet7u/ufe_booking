-- =====================================================================
--  UFE Classroom & Library Seat Booking — Supabase / PostgreSQL schema
--  Run this whole file once in Supabase → SQL Editor → New query → Run.
--  Safe to re-run: objects are created with IF NOT EXISTS / OR REPLACE.
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
--  Tables
-- ---------------------------------------------------------------------

-- People allowed to upload the class schedule (no other admin powers).
create table if not exists public.app_admins (
  email text primary key check (email = lower(email))
);

-- One profile per authenticated @ufe.edu.mn account.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  name        text not null default '' check (char_length(name) <= 60),
  student_id  text check (student_id is null or student_id ~ '^[A-Z0-9-]{4,20}$'),
  notif_read  jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

-- Weekly class schedule (one row, id = 'current').
-- busy = { "R-706": { "<weekday 0=Mon>-<period 0..11>": "ACC221 · 151", ... }, ... }
create table if not exists public.schedule (
  id           text primary key default 'current' check (id = 'current'),
  title        text,
  imported_at  timestamptz not null default now(),
  busy         jsonb not null default '{}'::jsonb,
  classes      int not null default 0,
  unmatched    int not null default 0,
  skipped      jsonb
);

-- Seat reservations (classroom seats and library seats).
create table if not exists public.reservations (
  id             text primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  resource_type  text not null check (resource_type in ('CLASSROOM_SEAT', 'LIBRARY_SEAT')),
  resource_id    text not null,           -- 'R-701:S-05' or 'S-23'
  room_id        text,                    -- 'R-701' for classroom seats
  seat_n         int,                     -- 1..26 for classroom seats
  date           date not null,           -- local date, Asia/Ulaanbaatar
  start_min      int  not null check (start_min between 0 and 1440),
  end_min        int  not null check (end_min between 0 and 1440 and end_min > start_min),
  status         text not null default 'CONFIRMED'
                 check (status in ('CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW', 'COMPLETED')),
  created_at     timestamptz not null default now(),
  check_in_at    timestamptz,
  cancelled_at   timestamptz,

  -- The database itself guarantees that no seat is booked twice for overlapping time,
  -- even when two students press "book" at the same moment.
  constraint no_double_booking exclude using gist (
    resource_id with =, date with =, int4range(start_min, end_min) with &&
  ) where (status in ('CONFIRMED', 'CHECKED_IN')),

  -- One student can hold only one seat at any given time.
  constraint one_seat_per_student exclude using gist (
    user_id with =, date with =, int4range(start_min, end_min) with &&
  ) where (status in ('CONFIRMED', 'CHECKED_IN'))
);

create index if not exists reservations_date_idx on public.reservations (date);
create index if not exists reservations_user_idx on public.reservations (user_id);

-- ---------------------------------------------------------------------
--  Only @ufe.edu.mn e-mails can create an account
-- ---------------------------------------------------------------------
create or replace function public.enforce_ufe_domain()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is null or lower(new.email) not like '%@ufe.edu.mn' then
    raise exception 'Only @ufe.edu.mn e-mail addresses may sign in';
  end if;
  return new;
end $$;

drop trigger if exists enforce_ufe_domain on auth.users;
create trigger enforce_ufe_domain
  before insert or update of email on auth.users
  for each row execute function public.enforce_ufe_domain();

-- ---------------------------------------------------------------------
--  Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.reservations enable row level security;
alter table public.schedule     enable row level security;
alter table public.app_admins   enable row level security;

drop policy if exists "profile: read own"   on public.profiles;
drop policy if exists "profile: insert own" on public.profiles;
drop policy if exists "profile: update own" on public.profiles;
create policy "profile: read own"   on public.profiles for select to authenticated using (id = auth.uid());
create policy "profile: insert own" on public.profiles for insert to authenticated
  with check (id = auth.uid() and email = lower(auth.jwt() ->> 'email'));
create policy "profile: update own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and email = lower(auth.jwt() ->> 'email'));

-- A student can read only their own reservations. Other students' bookings are
-- visible only as anonymous occupancy through public.occupancy() below.
-- There are NO insert/update/delete policies: writes go through the functions below.
drop policy if exists "reservations: read own" on public.reservations;
create policy "reservations: read own" on public.reservations for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "schedule: read"        on public.schedule;
drop policy if exists "schedule: admin write" on public.schedule;
create policy "schedule: read" on public.schedule for select to anon, authenticated using (true);
create policy "schedule: admin write" on public.schedule for all to authenticated
  using      (exists (select 1 from public.app_admins a where a.email = lower(auth.jwt() ->> 'email')))
  with check (exists (select 1 from public.app_admins a where a.email = lower(auth.jwt() ->> 'email')));

drop policy if exists "admins: see self" on public.app_admins;
create policy "admins: see self" on public.app_admins for select to authenticated
  using (email = lower(auth.jwt() ->> 'email'));

-- ---------------------------------------------------------------------
--  Helpers
-- ---------------------------------------------------------------------
create or replace function public.ub_now() returns timestamp
language sql stable as $$ select (now() at time zone 'Asia/Ulaanbaatar') $$;

-- Automatic no-show / completion handling (called before every booking,
-- and optionally every minute by pg_cron — see README).
create or replace function public.expire_reservations()
returns void language sql security definer set search_path = public as $$
  update public.reservations set status = 'NO_SHOW'
   where status = 'CONFIRMED'
     and (date + make_interval(mins => start_min + 15)) <= public.ub_now();
  update public.reservations set status = 'COMPLETED'
   where status = 'CHECKED_IN'
     and (date + make_interval(mins => end_min)) <= public.ub_now();
$$;

-- Anonymous availability: which seats are taken, never by whom.
create or replace function public.occupancy(p_from date, p_to date)
returns table (resource_type text, resource_id text, room_id text, seat_n int,
               date date, start_min int, end_min int, status text, is_mine boolean)
language sql stable security definer set search_path = public as $$
  select r.resource_type, r.resource_id, r.room_id, r.seat_n, r.date, r.start_min, r.end_min,
         r.status, r.user_id = auth.uid()
    from public.reservations r
   where r.date between p_from and p_to
     and r.status in ('CONFIRMED', 'CHECKED_IN')
     and (p_to - p_from) <= 31
$$;

-- ---------------------------------------------------------------------
--  Booking rules (server side — the browser cannot bypass these)
-- ---------------------------------------------------------------------
create or replace function public.book_reservation(
  p_type text, p_resource_id text, p_room_id text, p_seat_n int,
  p_date date, p_start int, p_end int)
returns public.reservations
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_now   timestamp := public.ub_now();
  v_row   public.reservations;
  v_busy  jsonb;
  v_wd    int;
  v_cons  text;
  v_sp    int; v_ep int;
  -- UFE periods I–XII (minutes after midnight)
  v_p_start int[] := array[460,520,580,640,700,760,860,920,980,1040,1100,1160];
  v_p_end   int[] := array[510,570,630,690,750,810,910,970,1030,1090,1150,1210];
  v_rooms text[] := array[
    'R-1301','R-1302','R-1303','R-1304','R-1305','R-1306',
    'R-1101','R-1102','R-1103','R-1104','R-1105','R-1106','R-1107','R-1108',
    'R-701','R-702','R-703','R-704','R-705','R-706','R-707','R-708',
    'R-601','R-602','R-603','R-604','R-605','R-606','R-607','R-608',
    'R-501','R-502','R-503','R-504','R-505','R-506','R-507','R-508',
    'R-202','R-203','R-204','R-205','R-206','R-207','R-208'];
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if v_email not like '%@ufe.edu.mn' then raise exception 'BAD_DOMAIN'; end if;
  if p_date < v_now::date or p_date > v_now::date + 7 then raise exception 'OUT_OF_WINDOW'; end if;
  if (p_date + make_interval(mins => p_start + 15)) <= v_now then raise exception 'IN_PAST'; end if;

  perform public.expire_reservations();

  if p_type = 'LIBRARY_SEAT' then
    if p_resource_id !~ '^S-(0[1-9]|[1-6][0-9]|70)$' then raise exception 'BAD_SEAT'; end if;
    if p_end - p_start <> 60 or p_start % 60 <> 0 or p_start < 480 or p_end > 1260 then
      raise exception 'BAD_TIME';
    end if;
    -- only one not-yet-started library booking at a time (book again after it starts)
    if exists (select 1 from public.reservations
                where user_id = v_uid and resource_type = 'LIBRARY_SEAT' and status = 'CONFIRMED'
                  and (date + make_interval(mins => start_min)) > v_now) then
      raise exception 'LIB_LIMIT';
    end if;
    p_room_id := null; p_seat_n := null;

  elsif p_type = 'CLASSROOM_SEAT' then
    if not (p_room_id = any (v_rooms)) then raise exception 'BAD_ROOM'; end if;
    if p_seat_n is null or p_seat_n < 1 or p_seat_n > 26 then raise exception 'BAD_SEAT'; end if;
    if p_resource_id <> p_room_id || ':S-' || lpad(p_seat_n::text, 2, '0') then raise exception 'BAD_SEAT'; end if;
    v_sp := array_position(v_p_start, p_start);
    v_ep := array_position(v_p_end, p_end);
    if v_sp is null or v_ep is null or v_ep < v_sp or v_ep - v_sp + 1 > 4 then raise exception 'BAD_TIME'; end if;
    select s.busy -> p_room_id into v_busy from public.schedule s where s.id = 'current';
    v_wd := extract(isodow from p_date)::int - 1;          -- 0 = Monday
    if v_busy is not null then
      for i in v_sp .. v_ep loop
        if v_busy ? (v_wd || '-' || (i - 1)) then raise exception 'CLASS_IN_SESSION'; end if;
      end loop;
    end if;
  else
    raise exception 'BAD_TYPE';
  end if;

  begin
    insert into public.reservations (id, user_id, resource_type, resource_id, room_id, seat_n, date, start_min, end_min)
    values ('RES-' || to_char(p_date, 'YYYYMMDD') || '-' ||
              upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5)),
            v_uid, p_type, p_resource_id, p_room_id, p_seat_n, p_date, p_start, p_end)
    returning * into v_row;
  exception when exclusion_violation then
    get stacked diagnostics v_cons = constraint_name;
    if v_cons = 'one_seat_per_student' then raise exception 'USER_OVERLAP';
    else raise exception 'SEAT_TAKEN'; end if;
  end;
  return v_row;
end $$;

create or replace function public.cancel_reservation(p_id text)
returns public.reservations
language plpgsql security definer set search_path = public as $$
declare v_row public.reservations;
begin
  update public.reservations
     set status = 'CANCELLED', cancelled_at = now()
   where id = p_id and user_id = auth.uid() and status = 'CONFIRMED'
     and (date + make_interval(mins => start_min)) > public.ub_now()
  returning * into v_row;
  if v_row.id is null then raise exception 'CANNOT_CANCEL'; end if;
  return v_row;
end $$;

create or replace function public.check_in(p_id text)
returns public.reservations
language plpgsql security definer set search_path = public as $$
declare v_row public.reservations;
begin
  update public.reservations
     set status = 'CHECKED_IN', check_in_at = now()
   where id = p_id and user_id = auth.uid() and status = 'CONFIRMED'
     and public.ub_now() >= (date + make_interval(mins => start_min - 15))
     and public.ub_now() <  (date + make_interval(mins => start_min + 15))
  returning * into v_row;
  if v_row.id is null then raise exception 'CANNOT_CHECK_IN'; end if;
  return v_row;
end $$;

-- ---------------------------------------------------------------------
--  Permissions
-- ---------------------------------------------------------------------
revoke all on function public.book_reservation(text,text,text,int,date,int,int) from public, anon;
revoke all on function public.cancel_reservation(text) from public, anon;
revoke all on function public.check_in(text)          from public, anon;
revoke all on function public.occupancy(date,date)    from public, anon;
revoke all on function public.expire_reservations()   from public, anon;
grant execute on function public.book_reservation(text,text,text,int,date,int,int) to authenticated;
grant execute on function public.cancel_reservation(text) to authenticated;
grant execute on function public.check_in(text)          to authenticated;
grant execute on function public.occupancy(date,date)    to authenticated;
grant execute on function public.expire_reservations()   to authenticated;
