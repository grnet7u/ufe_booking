# UFE Захиалга — Classroom & Library Seat Booking

A Mongolian-language web app for University of Finance and Economics (UFE) students and teachers to book **classroom seats**, **library seats** and (teachers only) **whole classrooms**.

- **Front-end:** plain HTML, CSS and JavaScript (no build step), hosted on **Vercel**
- **Back-end:** **Supabase**, which provides PostgreSQL, email login and Row Level Security
- **Login:** @ufe.edu.mn email + password (no emails are sent, so there are no email limits)
- **Roles:** `STUDENT` (default) and `TEACHER` in `profiles.role`, assigned only by an admin
- **Double booking:** blocked by the database itself (exclusion constraints), so two students can never get the same seat, and a teacher's whole-classroom booking can never overlap any seat booking in that room
- **Bookable space:** 30 classrooms (floors 13, 7, 6, 5 — floor 11 offices and floor 2 are not bookable) and 110 library seats

```
ufe-booking/
├── index.html            ← page shell
├── css/styles.css        ← all styles (light / dark theme)
├── js/config.js          ← ✏️ put your Supabase URL + anon key here
├── js/app.js             ← the whole app (UI, rules, Supabase calls)
├── js/demo-schedule.js   ← sample schedule used only in demo mode
├── supabase/schema.sql   ← tables, security rules, booking functions
├── supabase/seed.sql     ← fall 2026 class schedule + first admin
├── vercel.json           ← Vercel settings
└── package.json          ← `npm run dev` for local testing
```

---

## 1. Run it locally (VS Code)

1. Unzip the folder and open it in VS Code (**File → Open Folder**).
2. Start a local server, either way:
   - Install the **Live Server** extension, right-click `index.html`, and choose **Open with Live Server**; or
   - In the terminal, run `npm run dev` and open http://localhost:3000 (this needs Node.js).
3. With `js/config.js` still empty, the site runs in **demo mode**: you can click through everything, but nothing is saved.
   Demo accounts: student `oyutan` / `oyutan123`, teachers `bagsh` / `bagsh123` (Батбаяр) and `bagsh2` / `bagsh123` (Сараа).

> Opening `index.html` by double-clicking (`file://`) also works in demo mode. Real login needs `http://localhost` or a real domain.

---

## 2. Create the Supabase backend (about 10 minutes, free)

1. Go to https://supabase.com, sign up, and click **New project**. The **Singapore** region is closest to Mongolia.
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, and click **Run**.
3. Open `supabase/seed.sql` and change `your.name@ufe.edu.mn` to the email of the person who will upload schedules. Then paste it into a new query and **Run** it.
4. Go to **Project Settings → API** and copy:
   - **Project URL** into `SUPABASE_URL` in `js/config.js`
   - the **anon public** key into `SUPABASE_ANON_KEY`

   (Never use the `service_role` key in the website.)
5. Go to **Authentication → Sign In / Providers → Email** and:
   - keep **Enable Email provider** on
   - turn **Confirm email** **OFF**, so students can log in right after registering and no email is sent
   - click **Save**
6. Go to **Authentication → Rate Limits** and raise **"Rate limit for sign ups and sign ins"** (for example to 300 per 5 minutes). Students on the campus Wi-Fi share one IP address, and the default of 30 could block them at busy times.
7. Go to **Authentication → URL Configuration** and set **Site URL** to your Vercel address.

**Forgotten passwords:** students can change their password on **Профайл** (Profile) while logged in. If someone forgets it, an admin opens **Authentication → Users**, finds the student and deletes the user; the student then registers again. Their past bookings are removed with the account. Optionally, once you connect SMTP (Authentication → Emails → SMTP Settings), you could add email-based password reset.

**Note:** because no email is sent, the system can't prove that a student really owns the @ufe.edu.mn address they register with. For stronger security later, connect SMTP and turn **Confirm email** back on; the app already handles that.

### Optional: automatic no-show cleanup every minute
The booking functions already clear expired bookings before every new booking. If you also want it to happen on a timer, enable **Database → Extensions → pg_cron** and run:
```sql
select cron.schedule('ufe-expire', '* * * * *', 'select public.expire_reservations()');
```

---

## 2b. Upgrading an existing database (teacher + full-classroom booking)

`supabase/schema.sql` is safe to run again on the live database. Its section **2. Upgrade existing databases** adds, without deleting anything:

- `profiles.role` (`STUDENT` by default — every existing user stays a student)
- `reservations.reason`, `reservations.updated_at`, the `FULL_CLASSROOM` type and the reason rule
- the generated column `seat_span` and the exclusion constraint `no_room_conflict`
- new/updated functions: `book_reservation(..., p_reason)`, `update_full_classroom`, `cancel_reservation`, `check_in`, `occupancy` (now returns teacher name + reason for full-class bookings), `is_teacher`, `grant_teacher`, `revoke_teacher`

Steps: **SQL Editor → New query → paste all of `schema.sql` → Run.** Then deploy the new front-end.
The old website keeps working in between (the new `p_reason` argument is optional).

## 2c. Adding a teacher

Teachers cannot register themselves, and choosing **Багш** on the login page gives no rights by itself.

1. **Authentication → Users → Add user → Create new user**: the teacher's `@ufe.edu.mn` e-mail and a password, with **Auto Confirm User** ticked.
2. **SQL Editor**:
   ```sql
   select public.grant_teacher('bat.baatar@ufe.edu.mn', 'Батбаяр');
   ```
   To remove the role: `select public.revoke_teacher('bat.baatar@ufe.edu.mn');`

The teacher then logs in with the **Багш** switch. Schedule admins (`app_admins`) are a separate list and are not teachers unless you also run `grant_teacher`.

---

## 3. Put it on GitHub

```bash
git init
git add .
git commit -m "UFE booking system"
git branch -M main
git remote add origin https://github.com/<your-username>/ufe-booking.git
git push -u origin main
```
Or in VS Code: open **Source Control**, choose **Publish to GitHub**, and select **Public** or **Private**.

---

## 4. Deploy on Vercel

1. Go to https://vercel.com, sign in with GitHub, click **Add New → Project**, and import `ufe-booking`.
2. **Framework preset:** `Other`. Leave **Build command** and **Output directory** empty.
3. Click **Deploy**. Every `git push` to `main` redeploys automatically.
4. Copy the Vercel URL into Supabase **Site URL** (step 2.7).

---

## How the rules are enforced

| Rule | Where it is enforced |
|---|---|
| Only `@ufe.edu.mn` can sign in | `enforce_ufe_domain` trigger on `auth.users` + check in `book_reservation` |
| Only teachers can book a whole classroom | `is_teacher()` (reads `profiles.role`) inside `book_reservation` / `update_full_classroom` → `TEACHER_ONLY` (HTTP 403) |
| Users can't make themselves teachers | `protect_profile_role` trigger resets `role` on every insert/update from the website |
| Whole-classroom booking needs a reason (1–500 chars) | `reservations_reason_check` constraint + `INVALID_REASON` in the functions |
| Teacher booking ↔ student seat can never overlap in the same room | `no_room_conflict` exclusion constraint (`room_id`, date, time, `seat_span`) + a per-room advisory lock for clear error messages |
| Teacher edits change nothing if the new time conflicts | `update_full_classroom()` validates, then updates in one statement inside one transaction |
| A seat can't be booked twice for overlapping time | `no_double_booking` exclusion constraint (tested: 20 simultaneous requests → 1 success) |
| One student = one seat at a time | `one_seat_per_student` exclusion constraint |
| Classroom: 26 bookable seats (01–26 of 30), periods I–XII, max 4 periods (same for whole-classroom) | `book_reservation()` → `_check_room_window()` |
| Only the 30 bookable classrooms | `bookable_rooms()` (keep in sync with `ROOM_RANGES` in `js/app.js`) |
| No booking during scheduled classes | `book_reservation()` checks `schedule.busy` |
| Library: exactly 1 hour, one upcoming booking at a time | `book_reservation()` |
| Book up to 7 days ahead, not in the past | `book_reservation()` |
| Cancel only your own booking, before it starts (students can't cancel a teacher's booking and vice versa) | `cancel_reservation()` |
| Check in 15 min before → 15 min after start (seat bookings only) | `check_in()` |
| No check-in → automatic cancellation (seat bookings only; whole-classroom bookings simply complete) | `expire_reservations()` |
| Users see only **their own** bookings; others' seats appear only as "booked"; whole-classroom bookings show teacher name + reason | RLS on `reservations` + `occupancy()` |
| Only admins can upload the schedule | RLS on `schedule` + `app_admins` table |

The browser holds only the Supabase login token and the theme choice. Which seat is "таных" (yours) is always read from the database for the logged-in account.

---

## Updating the class schedule

Log in with an email listed in `app_admins`, open **Профайл** (Profile) and use **Excel файл сонгох** (choose Excel file) to upload the semester's `.xlsx`. It uses the same layout as `negdsen huvaari namar.xlsx`: Monday–Sunday × periods I–XII, with cells like `ACC221 / 151 / 10:40-13:30 / C - C706`.
- `C - C706` means room 706 in the C building.
- Online classes and rooms in other buildings are skipped automatically.

To add another admin:
```sql
insert into public.app_admins (email) values ('someone@ufe.edu.mn');
```

---

## Changing settings

The booking limits are in `js/app.js` (the `CFG` object at the top) **and** in `supabase/schema.sql` (`book_reservation`). Change both, and re-run the SQL after editing.

| Setting | Current value |
|---|---|
| Library | 110 seats, 08:00–21:00, 1-hour slots |
| Classroom booking | up to 4 periods |
| Book ahead | 7 days |
| Check-in window / auto-cancel | 15 minutes |

The reminder texts shown after booking are in `REMINDERS` in `js/app.js`. To add a new kind of space, add one entry there.
