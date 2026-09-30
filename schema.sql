-- =====================================================================
--  UFE Classroom & Library Seat Booking — Supabase / PostgreSQL schema
--  Run this whole file in Supabase → SQL Editor → New query → Run.
--
--  Safe to re-run, and safe on an EXISTING database:
--    • tables are created with IF NOT EXISTS
--    • section 2 ("Upgrade existing databases") adds the new columns and
--      constraints to old tables without touching existing rows
--    • functions are dropped/re-created, policies are dropped/re-created
--  Existing CLASSROOM_SEAT / LIBRARY_SEAT reservations stay valid and keep
--  their IDs. Nothing is deleted.
-- =====================================================================

create extension if not exists btree_gist;

-- =====================================================================
--  1. Tables (fresh install)
-- =====================================================================

-- People allowed to upload the class schedule (no other admin powers).
-- NOTE: schedule admins are NOT automatically teachers (see profiles.role).
create table if not exists public.app_admins (
  email text primary key check (email = lower(email))
);

-- One profile per authenticated @ufe.edu.mn account.
-- role = 'STUDENT' (default) or 'TEACHER'. Users can never change their own
-- role: the protect_profile_role trigger below resets it. Teachers are
-- assigned only by an administrator with public.grant_teacher(...).
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  name        text not null default '' check (char_length(name) <= 60),
  student_id  text check (student_id is null or student_id ~ '^[A-Z0-9-]{4,20}$'),
  role        text not null default 'STUDENT',
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

-- Reservations:
--   CLASSROOM_SEAT  one seat in a classroom   resource_id 'R-701:S-05', room_id 'R-701', seat_n 5
--   LIBRARY_SEAT    one library seat          resource_id 'S-23'
--   FULL_CLASSROOM  a whole classroom         resource_id 'R-701',      room_id 'R-701', seat_n NULL
--                   (teachers only, reason required)
create table if not exists public.reservations (
  id             text primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  resource_type  text not null,
  resource_id    text not null,
  room_id        text,
  seat_n         int,
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

  -- One person can hold only one active booking at any given time.
  constraint one_seat_per_student exclude using gist (
    user_id with =, date with =, int4range(start_min, end_min) with &&
  ) where (status in ('CONFIRMED', 'CHECKED_IN'))
);

create index if not exists reservations_date_idx on public.reservations (date);
create index if not exists reservations_user_idx on public.reservations (user_id);

-- =====================================================================
--  2. Upgrade existing databases (teacher + full-classroom booking)
--     Every statement is idempotent. Existing rows are kept as they are.
-- =====================================================================

-- 2a. Role on profiles
alter table public.profiles add column if not exists role text not null default 'STUDENT';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_check') then
    alter table public.profiles add constraint profiles_role_check check (role in ('STUDENT', 'TEACHER'));
  end if;
end $$;

-- 2b. New reservation columns
alter table public.reservations add column if not exists reason     text;
alter table public.reservations add column if not exists updated_at timestamptz;

-- 2c. Allow the new FULL_CLASSROOM type (old types unchanged)
alter table public.reservations drop constraint if exists reservations_resource_type_check;
alter table public.reservations add constraint reservations_resource_type_check
  check (resource_type in ('CLASSROOM_SEAT', 'LIBRARY_SEAT', 'FULL_CLASSROOM'));

-- 2d. A full-classroom booking must have a reason (1–500 characters).
--     Seat bookings may leave it NULL.
alter table public.reservations drop constraint if exists reservations_reason_check;
alter table public.reservations add constraint reservations_reason_check check (
  (reason is null or char_length(reason) <= 500)
  and (resource_type <> 'FULL_CLASSROOM'
       or (reason is not null and char_length(btrim(reason)) between 1 and 500))
);

-- 2e. Shape of each type (FULL_CLASSROOM: room_id = resource_id, no seat)
alter table public.reservations drop constraint if exists reservations_shape_check;
alter table public.reservations add constraint reservations_shape_check check (
  case resource_type
    when 'FULL_CLASSROOM' then room_id is not null and resource_id = room_id and seat_n is null
    when 'CLASSROOM_SEAT' then room_id is not null and seat_n is not null
    else true
  end
);

-- 2f. Resource hierarchy: which seats of the room a reservation occupies.
--       CLASSROOM_SEAT n  → [n, n+1)     (one seat)
--       FULL_CLASSROOM    → [1, 31)      (every seat of the room)
--       LIBRARY_SEAT      → NULL         (not part of a classroom)
--     "Same room + same date + overlapping time + overlapping seat_span" is a conflict, so:
--       FULL  vs any seat of that room → conflict
--       FULL  vs FULL in that room     → conflict
--       seat  vs a different seat      → no conflict (ranges don't overlap)
alter table public.reservations add column if not exists seat_span int4range
  generated always as (
    case resource_type
      when 'FULL_CLASSROOM' then int4range(1, 31)
      when 'CLASSROOM_SEAT' then int4range(seat_n, seat_n + 1)
    end
  ) stored;

-- 2g. The exclusion constraint that makes teacher/student conflicts impossible,
--     enforced by PostgreSQL itself on commit (also under concurrency).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'no_room_conflict') then
    alter table public.reservations add constraint no_room_conflict exclude using gist (
      room_id with =, date with =, int4range(start_min, end_min) with &&, seat_span with &&
    ) where (status in ('CONFIRMED', 'CHECKED_IN') and room_id is not null);
  end if;
end $$;

create index if not exists reservations_room_date_idx on public.reservations (room_id, date);

-- =====================================================================
--  3. Only @ufe.edu.mn e-mails can create an account
-- =====================================================================
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

-- =====================================================================
--  4. Roles — users can never make themselves a teacher
-- =====================================================================
-- Requests from the website run as the database role "authenticated".
-- For those, a new profile is always STUDENT and an existing role is never
-- changed, whatever the browser sends. Only the SQL editor / service role
-- (e.g. public.grant_teacher) can set role = 'TEACHER'.
-- (Deliberately NOT security definer, so current_user is the caller.)
create or replace function public.protect_profile_role()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.role := 'STUDENT';
    else
      new.role := old.role;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
  before insert or update on public.profiles
  for each row execute function public.protect_profile_role();

-- Is the calling user a teacher? (read from the database, never from the browser)
create or replace function public.is_teacher()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'TEACHER')
$$;

-- Admin helpers (run in the SQL editor; not callable from the website):
--   select public.grant_teacher('bat.baatar@ufe.edu.mn', 'Батбаяр');
--   select public.revoke_teacher('bat.baatar@ufe.edu.mn');
-- The teacher's login must already exist (Authentication → Users → Add user).
create or replace function public.grant_teacher(p_email text, p_name text)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.profiles;
begin
  select id into v_uid from auth.users where lower(email) = lower(btrim(p_email));
  if v_uid is null then
    raise exception 'No login for %. Create it first in Authentication → Users → Add user.', p_email;
  end if;
  insert into public.profiles (id, email, name, role)
  values (v_uid, lower(btrim(p_email)), btrim(coalesce(p_name, '')), 'TEACHER')
  on conflict (id) do update
    set role = 'TEACHER',
        name = case when btrim(coalesce(p_name, '')) <> '' then btrim(p_name) else public.profiles.name end
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.revoke_teacher(p_email text)
returns void language sql security definer set search_path = public as $$
  update public.profiles set role = 'STUDENT' where lower(email) = lower(btrim(p_email));
$$;

-- =====================================================================
--  5. Row Level Security
-- =====================================================================
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

-- A user can read only their own reservations. Other people's bookings are
-- visible only through public.occupancy() below (seats: anonymous; full
-- classroom bookings: teacher name + reason).
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

-- =====================================================================
--  6. Helpers
-- =====================================================================
create or replace function public.ub_now() returns timestamp
language sql stable as $$ select (now() at time zone 'Asia/Ulaanbaatar') $$;

-- The bookable classrooms (single list used by every booking function).
-- Floor 11 (offices) and floor 2 (IT lab, 202–208) are not bookable.
-- Keep in sync with ROOM_RANGES in js/app.js.
create or replace function public.bookable_rooms()
returns text[] language sql immutable as $$
  select array[
    'R-1301','R-1302','R-1303','R-1304','R-1305','R-1306',
    'R-701','R-702','R-703','R-704','R-705','R-706','R-707','R-708',
    'R-601','R-602','R-603','R-604','R-605','R-606','R-607','R-608',
    'R-501','R-502','R-503','R-504','R-505','R-506','R-507','R-508']
$$;

-- Automatic no-show / completion handling (called before every booking,
-- and optionally every minute by pg_cron — see README).
-- Full-classroom bookings need no check-in: they simply complete at the end.
create or replace function public.expire_reservations()
returns void language sql security definer set search_path = public as $$
  update public.reservations set status = 'NO_SHOW'
   where status = 'CONFIRMED' and resource_type <> 'FULL_CLASSROOM'
     and (date + make_interval(mins => start_min + 15)) <= public.ub_now();
  update public.reservations set status = 'COMPLETED'
   where (status = 'CHECKED_IN' or (status = 'CONFIRMED' and resource_type = 'FULL_CLASSROOM'))
     and (date + make_interval(mins => end_min)) <= public.ub_now();
$$;

-- Checks shared by seat and full-classroom bookings of a classroom:
-- valid room, whole UFE periods, max length, no scheduled class.
create or replace function public._check_room_window(
  p_room_id text, p_date date, p_start int, p_end int, p_max_periods int)
returns void language plpgsql stable security definer set search_path = public as $$
declare
  -- UFE periods I–XII (minutes after midnight)
  v_p_start int[] := array[460,520,580,640,700,760,860,920,980,1040,1100,1160];
  v_p_end   int[] := array[510,570,630,690,750,810,910,970,1030,1090,1150,1210];
  v_sp int; v_ep int; v_wd int; v_busy jsonb;
begin
  if p_room_id is null or not (p_room_id = any (public.bookable_rooms())) then raise exception 'BAD_ROOM'; end if;
  v_sp := array_position(v_p_start, p_start);
  v_ep := array_position(v_p_end, p_end);
  if v_sp is null or v_ep is null or v_ep < v_sp or v_ep - v_sp + 1 > p_max_periods then
    raise exception 'BAD_TIME';
  end if;
  select s.busy -> p_room_id into v_busy from public.schedule s where s.id = 'current';
  v_wd := extract(isodow from p_date)::int - 1;          -- 0 = Monday
  if v_busy is not null then
    for i in v_sp .. v_ep loop
      if v_busy ? (v_wd || '-' || (i - 1)) then raise exception 'CLASS_IN_SESSION'; end if;
    end loop;
  end if;
end $$;

-- Friendly error for a classroom conflict (student seat vs teacher full booking etc.).
-- p_ignore = reservation being edited (not a conflict with itself).
create or replace function public._room_conflict(
  p_room_id text, p_date date, p_start int, p_end int, p_full boolean, p_seat_n int, p_ignore text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when bool_or(r.resource_type = 'FULL_CLASSROOM') then
      case when p_full then 'FULL_CLASS_CONFLICT' else 'CLASSROOM_BOOKED' end
    when p_full and count(*) > 0 then 'CLASSROOM_HAS_SEATS'
    when not p_full and bool_or(r.seat_n = p_seat_n) then 'SEAT_TAKEN'
  end
  from public.reservations r
  where r.room_id = p_room_id and r.date = p_date
    and r.status in ('CONFIRMED', 'CHECKED_IN')
    and int4range(r.start_min, r.end_min) && int4range(p_start, p_end)
    and r.id is distinct from p_ignore
$$;

-- Availability for everyone logged in.
--   seat bookings:           which seats are taken, never by whom
--   full-classroom bookings: teacher name + reason (the feature requires it)
drop function if exists public.occupancy(date, date);
create function public.occupancy(p_from date, p_to date)
returns table (resource_type text, resource_id text, room_id text, seat_n int,
               date date, start_min int, end_min int, status text, is_mine boolean,
               booked_by text, reason text)
language sql stable security definer set search_path = public as $$
  select r.resource_type, r.resource_id, r.room_id, r.seat_n, r.date, r.start_min, r.end_min,
         r.status, r.user_id = auth.uid(),
         case when r.resource_type = 'FULL_CLASSROOM' then coalesce(nullif(p.name, ''), 'Багш') end,
         case when r.resource_type = 'FULL_CLASSROOM' then r.reason end
    from public.reservations r
    left join public.profiles p on p.id = r.user_id and r.resource_type = 'FULL_CLASSROOM'
   where r.date between p_from and p_to
     and r.status in ('CONFIRMED', 'CHECKED_IN')
     and (p_to - p_from) <= 31
$$;

-- =====================================================================
--  7. Booking rules (server side — the browser cannot bypass these)
-- =====================================================================
-- Old 7-argument version is replaced by this one (p_reason is optional,
-- so the currently deployed website keeps working).
drop function if exists public.book_reservation(text, text, text, int, date, int, int);
create or replace function public.book_reservation(
  p_type text, p_resource_id text, p_room_id text, p_seat_n int,
  p_date date, p_start int, p_end int, p_reason text default null)
returns public.reservations
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_now    timestamp := public.ub_now();
  v_row    public.reservations;
  v_cons   text;
  v_code   text;
  v_reason text := null;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if v_email not like '%@ufe.edu.mn' then raise exception 'BAD_DOMAIN'; end if;
  if p_date is null or p_start is null or p_end is null then raise exception 'BAD_TIME'; end if;
  if p_date < v_now::date or p_date > v_now::date + 7 then raise exception 'OUT_OF_WINDOW'; end if;
  if (p_date + make_interval(mins => p_start + 15)) <= v_now then raise exception 'IN_PAST'; end if;

  perform public.expire_reservations();

  if p_type = 'LIBRARY_SEAT' then
    -- 110 seats: S-01 … S-110
    if p_resource_id is null or p_resource_id !~ '^S-(0[1-9]|[1-9][0-9]|10[0-9]|110)$' then
      raise exception 'BAD_SEAT';
    end if;
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
    if p_seat_n is null or p_seat_n < 1 or p_seat_n > 26 then raise exception 'BAD_SEAT'; end if;
    if p_resource_id is distinct from p_room_id || ':S-' || lpad(p_seat_n::text, 2, '0') then raise exception 'BAD_SEAT'; end if;
    perform public._check_room_window(p_room_id, p_date, p_start, p_end, 4);

  elsif p_type = 'FULL_CLASSROOM' then
    -- Teacher permission comes from profiles.role in the database.
    if not public.is_teacher() then raise exception 'TEACHER_ONLY' using errcode = '42501'; end if;
    v_reason := btrim(coalesce(p_reason, ''));
    if char_length(v_reason) < 1 or char_length(v_reason) > 500 then raise exception 'INVALID_REASON'; end if;
    perform public._check_room_window(p_room_id, p_date, p_start, p_end, 4);
    p_resource_id := p_room_id; p_seat_n := null;

  else
    raise exception 'BAD_TYPE';
  end if;

  -- Classroom bookings of the same room + date are serialised by a transaction-level
  -- lock, so the checks below always see every committed booking. (The exclusion
  -- constraints are the final guarantee even without this lock.)
  if p_room_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('ufe-room:' || p_room_id || ':' || p_date::text, 0));
    v_code := public._room_conflict(p_room_id, p_date, p_start, p_end,
                                    p_type = 'FULL_CLASSROOM', p_seat_n, null);
    if v_code is not null then raise exception '%', v_code; end if;
  end if;

  begin
    insert into public.reservations (id, user_id, resource_type, resource_id, room_id, seat_n,
                                     date, start_min, end_min, reason)
    values ('RES-' || to_char(p_date, 'YYYYMMDD') || '-' ||
              upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5)),
            v_uid, p_type, p_resource_id, p_room_id, p_seat_n, p_date, p_start, p_end, v_reason)
    returning * into v_row;
  exception when exclusion_violation then
    get stacked diagnostics v_cons = constraint_name;
    if v_cons = 'one_seat_per_student' then raise exception 'USER_OVERLAP'; end if;
    if p_room_id is not null then
      v_code := public._room_conflict(p_room_id, p_date, p_start, p_end,
                                      p_type = 'FULL_CLASSROOM', p_seat_n, null);
    end if;
    raise exception '%', coalesce(v_code, case when p_type = 'FULL_CLASSROOM' then 'FULL_CLASS_CONFLICT' else 'SEAT_TAKEN' end);
  end;
  return v_row;
end $$;

-- Teacher edits their own full-classroom booking (room, date, time, reason).
-- Everything is validated first; the row is changed in ONE statement, so if
-- anything conflicts the whole call fails and the original booking is untouched.
create or replace function public.update_full_classroom(
  p_id text, p_room_id text, p_date date, p_start int, p_end int, p_reason text)
returns public.reservations
language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_now    timestamp := public.ub_now();
  v_old    public.reservations;
  v_row    public.reservations;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_code   text;
  v_cons   text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_teacher() then raise exception 'TEACHER_ONLY' using errcode = '42501'; end if;

  if p_room_id is null or p_date is null then raise exception 'BAD_ROOM'; end if;
  -- same lock order as book_reservation: room/date lock first, then the row
  perform pg_advisory_xact_lock(hashtextextended('ufe-room:' || p_room_id || ':' || p_date::text, 0));

  -- lock the teacher's own booking (another teacher's id is simply "not found")
  select * into v_old from public.reservations
   where id = p_id and user_id = v_uid and resource_type = 'FULL_CLASSROOM'
   for update;
  if v_old.id is null or v_old.status <> 'CONFIRMED'
     or (v_old.date + make_interval(mins => v_old.start_min)) <= v_now then
    raise exception 'CANNOT_EDIT';
  end if;

  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then raise exception 'INVALID_REASON'; end if;
  if p_date is null or p_start is null or p_end is null then raise exception 'BAD_TIME'; end if;
  if p_date < v_now::date or p_date > v_now::date + 7 then raise exception 'OUT_OF_WINDOW'; end if;
  if (p_date + make_interval(mins => p_start + 15)) <= v_now then raise exception 'IN_PAST'; end if;
  perform public._check_room_window(p_room_id, p_date, p_start, p_end, 4);

  perform public.expire_reservations();
  v_code := public._room_conflict(p_room_id, p_date, p_start, p_end, true, null, p_id);
  if v_code is not null then raise exception '%', v_code; end if;

  begin
    update public.reservations
       set room_id = p_room_id, resource_id = p_room_id, date = p_date,
           start_min = p_start, end_min = p_end, reason = v_reason, updated_at = now()
     where id = p_id
    returning * into v_row;
  exception when exclusion_violation then
    get stacked diagnostics v_cons = constraint_name;
    if v_cons = 'one_seat_per_student' then raise exception 'USER_OVERLAP'; end if;
    raise exception '%', coalesce(public._room_conflict(p_room_id, p_date, p_start, p_end, true, null, p_id),
                                  'FULL_CLASS_CONFLICT');
  end;
  return v_row;
end $$;

-- Cancel your OWN booking before it starts (seat or full classroom).
-- Nobody can cancel someone else's booking: user_id must be the caller.
create or replace function public.cancel_reservation(p_id text)
returns public.reservations
language plpgsql security definer set search_path = public as $$
declare v_row public.reservations;
begin
  update public.reservations
     set status = 'CANCELLED', cancelled_at = now(), updated_at = now()
   where id = p_id and user_id = auth.uid() and status = 'CONFIRMED'
     and (date + make_interval(mins => start_min)) > public.ub_now()
  returning * into v_row;
  if v_row.id is null then raise exception 'CANNOT_CANCEL'; end if;
  return v_row;
end $$;

-- Check-in is for seat bookings only.
create or replace function public.check_in(p_id text)
returns public.reservations
language plpgsql security definer set search_path = public as $$
declare v_row public.reservations;
begin
  update public.reservations
     set status = 'CHECKED_IN', check_in_at = now()
   where id = p_id and user_id = auth.uid() and status = 'CONFIRMED'
     and resource_type <> 'FULL_CLASSROOM'
     and public.ub_now() >= (date + make_interval(mins => start_min - 15))
     and public.ub_now() <  (date + make_interval(mins => start_min + 15))
  returning * into v_row;
  if v_row.id is null then raise exception 'CANNOT_CHECK_IN'; end if;
  return v_row;
end $$;

-- =====================================================================
--  8. Permissions
--  (Supabase grants EXECUTE to anon/authenticated by default, so internal
--   helpers and admin functions are revoked explicitly.)
-- =====================================================================
revoke all on function public.book_reservation(text,text,text,int,date,int,int,text) from public, anon;
revoke all on function public.update_full_classroom(text,text,date,int,int,text)    from public, anon;
revoke all on function public.cancel_reservation(text) from public, anon;
revoke all on function public.check_in(text)          from public, anon;
revoke all on function public.occupancy(date,date)    from public, anon;
revoke all on function public.expire_reservations()   from public, anon;
revoke all on function public.is_teacher()            from public, anon;
grant execute on function public.book_reservation(text,text,text,int,date,int,int,text) to authenticated;
grant execute on function public.update_full_classroom(text,text,date,int,int,text)    to authenticated;
grant execute on function public.cancel_reservation(text) to authenticated;
grant execute on function public.check_in(text)          to authenticated;
grant execute on function public.occupancy(date,date)    to authenticated;
grant execute on function public.expire_reservations()   to authenticated;
grant execute on function public.is_teacher()            to authenticated;

revoke all on function public._check_room_window(text,date,int,int,int)              from public, anon, authenticated;
revoke all on function public._room_conflict(text,date,int,int,boolean,int,text)     from public, anon, authenticated;
revoke all on function public.grant_teacher(text,text)                              from public, anon, authenticated;
revoke all on function public.revoke_teacher(text)                                  from public, anon, authenticated;
