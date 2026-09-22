# UFE Захиалга — Classroom & Library Seat Booking

A Mongolian-language web app for University of Finance and Economics (UFE) students to book **classroom seats** and **library seats**.

- **Front-end:** plain HTML, CSS and JavaScript (no build step), hosted on **Vercel**
- **Back-end:** **Supabase**, which provides PostgreSQL, email login and Row Level Security
- **Login:** a one-time email code sent to **@ufe.edu.mn** addresses only
- **Double booking:** blocked by the database itself (exclusion constraints), so two students can never get the same seat

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
5. Go to **Authentication → Providers → Email** and make sure Email is **enabled**.
6. Go to **Authentication → Email Templates → Magic Link** and add the one-time code to the message so students can type it in, for example:
   ```html
   <h2>UFE Захиалга</h2>
   <p>Нэвтрэх код: <b>{{ .Token }}</b></p>
   <p>Эсвэл энд дарна уу: <a href="{{ .ConfirmationURL }}">Нэвтрэх</a></p>
   ```
7. Go to **Authentication → URL Configuration** and set:
   - **Site URL:** your Vercel address, for example `https://ufe-booking.vercel.app`
   - **Redirect URLs:** add `http://localhost:3000/**` and `https://*.vercel.app/**`

**Email limits:** Supabase's built-in email sender only allows a few emails per hour, which is fine for testing. For real students, go to **Authentication → Emails → SMTP Settings** and connect a real mail service (UFE's mail server, Resend, SendGrid, etc.).

### Optional: automatic no-show cleanup every minute
The booking functions already clear expired bookings before every new booking. If you also want it to happen on a timer, enable **Database → Extensions → pg_cron** and run:
```sql
select cron.schedule('ufe-expire', '* * * * *', 'select public.expire_reservations()');
```

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
| A seat can't be booked twice for overlapping time | `no_double_booking` exclusion constraint (tested: 20 simultaneous requests → 1 success) |
| One student = one seat at a time | `one_seat_per_student` exclusion constraint |
| Classroom: 26 bookable seats (01–26 of 30), periods I–XII, max 4 periods | `book_reservation()` |
| No booking during scheduled classes | `book_reservation()` checks `schedule.busy` |
| Library: exactly 1 hour, one upcoming booking at a time | `book_reservation()` |
| Book up to 7 days ahead, not in the past | `book_reservation()` |
| Cancel only your own booking, before it starts | `cancel_reservation()` |
| Check in 15 min before → 15 min after start | `check_in()` |
| No check-in → automatic cancellation | `expire_reservations()` |
| Students see only **their own** bookings; others appear only as "booked" | RLS on `reservations` + anonymous `occupancy()` |
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
| Library hours | 08:00–21:00, 1-hour slots |
| Classroom booking | up to 4 periods |
| Book ahead | 7 days |
| Check-in window / auto-cancel | 15 minutes |

The reminder texts shown after booking are in `REMINDERS` in `js/app.js`. To add a new kind of space, add one entry there.
