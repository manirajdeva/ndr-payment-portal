# TiDB-backed API — NDR EDTECH Student Portal

A drop-in replacement for the Google Apps Script backend (`apps-script/`, kept
in the repo as a reference/fallback): same action names, same request/response
envelope, same validation and role rules — just backed by a real TiDB database
via a small Express server instead of Google Sheets.

- **Contract:** identical to `apps-script/*.gs` and `mock-server/server.js` —
  `js/api.js` and every `js/*.js` module work against it completely unchanged.
- **Storage:** TiDB (MySQL wire-protocol compatible) via `mysql2`.
- **Auth:** same salted-SHA-256 password scheme as `apps-script/Auth.gs`, so
  the hashing logic is portable between the two.
- **Concurrency:** SQL transactions + `SELECT ... FOR UPDATE` do the job
  `LockService` does in Apps Script (student-ID/payment-ID sequence
  generation, the overpayment guard).
- **Audit trail:** every add / edit / delete on students, jobs, payments and
  documents appends a row to `students_log` / `jobs_log` / `payments_log` /
  `documents_log` — see *Audit / history log* below. (TiDB-specific; the
  Apps Script backend does not record this.)

## 1. Get a TiDB database

Easiest path — **TiDB Cloud Serverless** (has a free tier):

1. Go to https://tidbcloud.com and sign up / sign in.
2. **Create Cluster** → choose **Serverless** → pick a region → **Create**.
   Takes under a minute to provision.
3. Once it's ready, click **Connect** on the cluster. Choose connection type
   **General** (or **Node.js**) and copy:
   - **Host** (looks like `gateway01.<region>.prod.aws.tidbcloud.com`)
   - **Port** (`4000`)
   - **User** (looks like `<random>.root`)
   - **Password** — click **Generate Password** if you haven't already; TiDB
     Cloud only shows it once, so save it now.
4. Under **Connect** you can also **Create Database** (or just use the
   default one, e.g. `test`) — either way, note the database name; you'll
   put it all in `.env` next.

TLS is required and TiDB Cloud Serverless's certificate is publicly trusted,
so you don't need to download a CA file — `TIDB_SSL=true` (the default) is
enough.

Self-hosted / other TiDB works too — same env vars, just point `TIDB_HOST`
at your cluster and set `TIDB_SSL=false` if it doesn't use TLS.

## 2. Local setup

```
cd tidb-server
npm install
cp .env.example .env
```

Edit `.env` with the values from step 1. Then create the tables and the
admin login:

```
npm run setup
```

This is safe to re-run — it won't touch existing tables or overwrite an
already-seeded user's password (same as `apps-script/Setup.gs`). Output
tells you the login it created:

```
Default admin login -> username: admin  password: Admin@123  — change it after first login.
```

Start the server:

```
npm start
```

It listens on `http://localhost:4001` (`PORT` in `.env`). Point the frontend
at it for local testing by opening the app with `?api=tidb`, e.g.
`http://localhost:5500/login.html?api=tidb` (see `js/api.js`'s header
comment — this is remembered on the device until you switch back with
`?api=mock`).

### Users and roles

The `users` table holds every portal login. `role` is one of:

- **admin** — full access, including Payments and adding/removing other users
- **employee** — full add / edit / delete on Student Enquiries and Job
  Status, plus the Dashboard and Reports. **No access to the Payments
  section** (the API rejects every `*Payment*` action for this role) and
  cannot manage users. (`hr` on older rows is a synonym for `employee`.)

`npm run setup` seeds the bootstrap **admin** (and an optional starter
**employee** if `EMPLOYEE_USERNAME` / `EMPLOYEE_PASSWORD`, or the older
`HR_USERNAME` / `HR_PASSWORD`, are set). After that, add and manage users
from the app: **Settings → User Management** (admins only), which also
resets any user's password.

### Changing the bootstrap admin password

The first admin can also be rotated from Settings → User Management like any
other user. If you'd rather not go through the UI (or you're locked out),
connect to your TiDB database with any MySQL client and update the `users`
row directly, or write a tiny one-off script using `logic.js`'s
`hashPassword(password, salt)` to compute the new hash. A
`crypto.randomUUID()` makes a fine salt.

### Audit / history log

Four append-only tables record every change to the core data:

| table          | one row per                                   |
|----------------|-----------------------------------------------|
| `students_log` | add / edit / delete of a Student Enquiry      |
| `jobs_log`     | add / edit / delete of a Job Status record    |
| `payments_log` | add / edit / delete of a Payment              |
| `documents_log`| add / edit / delete of a Document record      |

Every row carries: `action` (`INSERT` / `UPDATE` / `DELETE`), `actor` (the
logged-in username who made the change) and `actor_role`, `record_key` (the
changed row's key) and `student_id` (for per-student lookups), full
`data_before` / `data_after` JSON snapshots, and `changed_at`. The log write
runs **in the same transaction** as the change, so there are no silent gaps,
and the tables are never updated or deleted by the app.

`server.js` runs `schema.sql` on startup (`store.ensureSchema()`), so these
tables are created automatically on first deploy — no manual migration.

`ensureSchema()` also applies column migrations. `CREATE TABLE IF NOT
EXISTS` leaves an existing table untouched, so a column added after that
table's first deploy (currently `payments.payment_type`) is listed in
`store.js`'s `ADDED_COLUMNS` and `ALTER`ed in only when it is genuinely
missing — a redeploy migrates an existing database on its own.

Read them back with the `getAuditLog` action (admin only):

```jsonc
// POST /exec
{ "action": "getAuditLog", "token": "…",
  "entity": "students",        // "students" | "jobs" | "payments" | "documents"
  "studentId": "NDR20260007",  // optional filter
  "recordKey": "PMT000012",    // optional filter (the changed row's own key)
  "page": 1, "pageSize": 50 }
```

or query the tables directly, e.g.
`SELECT * FROM payments_log WHERE student_id = 'NDR20260007' ORDER BY id DESC;`

## 3. Deploy the API (Render)

A `render.yaml` at the repo root is already set up for this (Render calls
it a "Blueprint"):

1. Push this repo to GitHub if you haven't already.
2. On https://render.com, **New** → **Blueprint**, pick this repo. Render
   reads `render.yaml` and proposes a `ndr-tidb-api` web service rooted at
   `tidb-server/`.
3. Fill in the environment variables it asks for (`TIDB_HOST`, `TIDB_PORT`,
   `TIDB_USER`, `TIDB_PASSWORD`, `TIDB_DATABASE`) with your TiDB Cloud
   values from step 1.
4. Deploy. Once live, note the service URL, e.g.
   `https://ndr-tidb-api.onrender.com`.
5. Run `npm run setup` once against that same database — either locally
   with `.env` pointed at the same TiDB cluster, or via Render's shell —
   before logging in for the first time.

Free-tier Render services spin down after inactivity; the first request
after a idle period takes a few extra seconds to wake back up. Sessions are
stored in TiDB (not in server memory), so a cold start never logs anyone out.

## 4. Point the frontend at it

In [js/api.js](../js/api.js), set:

```js
const PRODUCTION_API_URL = 'https://ndr-tidb-api.onrender.com/exec';
```

Commit and push — GitHub Pages picks it up automatically. Everything else
(login flow, CRUD, dashboard, reports, exports) works unchanged.

## Project structure

```
tidb-server/
├── schema.sql     # CREATE TABLE statements — run by setup.js
├── db.js          # mysql2 connection pool + withTransaction() helper
├── logic.js       # pure business rules (validation, pagination, dashboard
│                  #  math) — copied close to verbatim from mock-server so
│                  #  behavior stays identical across all three backends
├── store.js       # all SQL — students/jobs/payments/documents/counters/users/
│                  #  sessions + the students_log/jobs_log/payments_log/documents_log
│                  #  audit tables (logChange / loadAuditLog)
├── server.js      # Express app: the same action-based /exec endpoint
├── setup.js       # one-time: creates tables, seeds the admin (+ optional
│                  #  employee) login — the TiDB equivalent of apps-script/Setup.gs
├── .env.example   # template — copy to .env, never commit the real one
└── render.yaml    # at the repo root — Render Blueprint for deploying this
```

## Notes / trade-offs

- List endpoints (`getStudents`, `getJobStatus`, `getPayments`) fetch the
  whole table and paginate/sort/search in Node, the same approach
  `mock-server/server.js` uses. Fine for this app's scale (a training
  company's enrollments — hundreds to low thousands of rows); if a table
  ever grows very large, push the filtering into SQL instead.
- Dates and timestamps are stored as plain ISO strings (`VARCHAR`), not
  native `DATE`/`DATETIME` columns — see the comment at the top of
  `schema.sql` for why (keeps every comparison byte-for-byte identical to
  the string comparisons the frontend and other backends already do).
