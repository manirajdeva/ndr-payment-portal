# NDR EDTECH — Student Management Portal

A production-ready Student Management Portal for NDR EDTECH.

- **Frontend:** HTML5, CSS3, vanilla JavaScript (ES6+), Bootstrap 5, Font Awesome, Chart.js, SweetAlert2 — deployed on **GitHub Pages**.
- **Backend:** Google Apps Script REST API — deployed as a **Web App**.
- **Database:** Google Sheets.

---

## 1. Project structure

```
student-portal/
├── index.html          # entry point, redirects to login or dashboard
├── login.html           # admin login
├── dashboard.html        # app shell: dashboard, enquiries, jobs, payments, reports, settings
├── css/
│   └── style.css
├── js/
│   ├── api.js            # fetch wrapper for the Apps Script Web App
│   ├── auth.js            # session storage, login guard, logout
│   ├── utils.js            # toasts, formatting, validation, export helpers
│   ├── dashboard.js         # app shell (sidebar/theme/logout) + dashboard charts
│   ├── enquiries.js          # Module 1 — Student Enquiries CRUD
│   ├── jobs.js                # Module 2 — Job Status CRUD
│   ├── payments.js             # Module 3 — Student Payments CRUD
│   └── reports.js               # Reports + export
├── assets/ images/ icons/
├── apps-script/            # Google Apps Script backend source (copy into the Apps Script editor)
│   ├── appsscript.json
│   ├── Code.gs              # doGet/doPost router
│   ├── Auth.gs                # login + session validation
│   ├── Students.gs             # Module 1 backend
│   ├── Jobs.gs                  # Module 2 backend
│   ├── Payments.gs               # Module 3 backend
│   ├── Dashboard.gs               # dashboard stats aggregation
│   ├── Reports.gs                  # report filtering
│   ├── Setup.gs                     # one-time sheet + admin bootstrap
│   └── Utils.gs                      # shared helpers
└── README.md
```

---

## 2. Backend setup — Google Apps Script + Google Sheets

### 2.1 Create the spreadsheet & script project

1. Create a new Google Sheet (this is your database) — e.g. **"NDR EDTECH — Student Portal DB"**.
2. In the sheet, open **Extensions → Apps Script**. This creates a bound script project.
3. Delete the default `Code.gs` content, then create the following script files (use **File → New → Script file**, matching these exact names) and paste in the matching contents from `apps-script/` in this repo:
   - `Code.gs`
   - `Utils.gs`
   - `Auth.gs`
   - `Setup.gs`
   - `Students.gs`
   - `Jobs.gs`
   - `Payments.gs`
   - `Dashboard.gs`
   - `Reports.gs`
4. Open **Project Settings** (gear icon) and paste the contents of `apps-script/appsscript.json` into the manifest (enable "Show appsscript.json manifest file in editor" first).

   > If you prefer, install [`clasp`](https://github.com/google/clasp) and run `clasp push` from the `apps-script/` folder against a script bound to your sheet — it will upload all files in one shot.

### 2.2 Run the one-time setup

1. In the Apps Script editor, select the function `setup` from the function dropdown (top toolbar) and click **Run**.
2. Authorize the script when prompted (it needs access to the spreadsheet).
3. This creates all sheets with headers (`Config`, `Counters`, `Student Enquiries`, `Job Status`, `Student Payments`) and seeds a default admin login:
   - **Username:** `admin`
   - **Password:** `Admin@123`
4. Open the **View → Logs** (or Executions) to confirm `Setup complete.` was logged.
5. **Change the default password immediately.** Open `Auth.gs`, edit the `newPassword` value inside `changeAdminPassword()`, select that function in the dropdown, and click **Run** once. The password is stored only as a salted SHA-256 hash in the `Config` sheet — never in plaintext, never in the frontend.

### 2.3 Deploy as a Web App

1. Click **Deploy → New deployment**.
2. Select type **Web app**.
3. Set:
   - **Execute as:** Me (your account)
   - **Who has access:** Anyone
4. Click **Deploy**, authorize again if prompted, and copy the **Web app URL** (ends in `/exec`).
5. Whenever you change the backend code, use **Deploy → Manage deployments → Edit (pencil icon) → New version** to publish the update — editing the files alone does not update a live deployment.

### 2.4 API contract (for reference)

All requests are `POST` to the Web App URL with a `text/plain` body containing JSON — this keeps requests CORS-"simple" so the browser never sends an OPTIONS preflight (which Apps Script cannot answer). The JSON body always has an `action` field, a `token` field (blank for `login`), and either flat fields (list endpoints) or a nested `data` object (write endpoints). Every response is:

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": { "code": "SESSION_EXPIRED", "message": "..." } }
```

Endpoints: `login`, `logout`, `generateStudentID`, `getStudents`, `addStudent`, `updateStudent`, `deleteStudent`, `searchStudent`, `getJobStatus`, `saveJobStatus`, `updateJobStatus`, `deleteJobStatus`, `getPayments`, `savePayment`, `updatePayment`, `deletePayment`, `dashboardStats`, `reports`.

---

## 3. Frontend setup — GitHub Pages

### 3.1 Point the frontend at your backend

Open [js/api.js](js/api.js) and replace the placeholder with your deployed Web App URL:

```js
const APP_SCRIPT_URL = 'https://script.google.com/macros/s/XXXXXXXXXXXXXXXXXXXXXXXX/exec';
```

### 3.2 Deploy to GitHub Pages

1. Push this project to a GitHub repository.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to "Deploy from a branch", pick your branch (e.g. `main`) and folder `/ (root)`.
4. Save — GitHub will publish the site at `https://<your-username>.github.io/<repo-name>/`.
5. Visit that URL — it loads `index.html`, which redirects to `login.html` (or straight to `dashboard.html` if you already have a session).

Because everything is static HTML/CSS/JS with no build step, no further configuration is required — all pages and assets work as-is on GitHub Pages.

---

## 4. Using the portal

- **Login** with the admin credentials from step 2.2 (or whatever you changed them to).
- The session token is kept in `sessionStorage` for 4 hours; the app polls every 30 seconds and auto-redirects to the login page once it expires.
- **Dashboard** — live stat cards, monthly admissions/revenue charts, and a placement breakdown, all computed server-side from the three sheets.
- **Student Enquiries** — add/edit/delete students; Student ID is generated automatically in the format `NDR20260001`; duplicate mobile numbers and emails are rejected.
- **Job Status** — pick an existing student (search by name/ID/mobile), which auto-fills their name and course; track status through the fixed dropdown (`Pending` → … → `Joined`/`Rejected`).
- **Payments** — pick a student, see what they've already paid, and record a new payment; the backend recomputes the pending balance and blocks any payment that would exceed the total course fee.
- **Reports** — filter by date range, course, job status, payment status, or organization, then export the results to CSV, Excel, or PDF. The same export options are available directly on each module's table.
- **Settings** — light/dark theme toggle and account info. Password changes are done from the Apps Script editor (see 2.2) rather than the UI, so credentials never pass through the frontend.

## 5. Local testing (no Google account needed)

`mock-server/` contains a zero-dependency Node stand-in for the Apps Script
backend — same action names, same request/response envelope, same
validation rules (duplicate mobile/email, 10-digit mobile, overpayment,
negative-pending guard, etc.) as `apps-script/*.gs`, but backed by an
in-memory store instead of Google Sheets. `js/api.js` automatically points
at it whenever the page is served from `localhost`/`127.0.0.1`, so no code
changes are needed to switch between local testing and production.

Run two terminals from the project root:

```
node mock-server/server.js          # API on http://localhost:3001, pre-seeded with sample data
node mock-server/static-server.js   # frontend on http://localhost:5500
```

Open **http://localhost:5500** and log in with:

- **Username:** `admin`
- **Password:** `Admin@123`

Everything works end-to-end — dashboard charts, CRUD on all three modules,
search/sort/pagination, reports, and CSV/Excel/PDF export — against 12
seeded students with realistic enquiries, job statuses, and payments spread
across the last 6 months. Data resets whenever you restart
`mock-server/server.js` (it's in-memory only).

When you're ready for production: set `PRODUCTION_APP_SCRIPT_URL` in
`js/api.js` to your real deployed Web App URL (section 3.1) and deploy to
GitHub Pages — the mock server is never used outside of `localhost`.
