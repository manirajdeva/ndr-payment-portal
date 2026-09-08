-- schema.sql
-- Table layout for the TiDB-backed NDR EDTECH Student Portal API.
-- Mirrors the Google Sheets in apps-script/Setup.gs 1:1 (same fields), so
-- the row shape the frontend already expects (js/api.js, js/*.js) needs no
-- changes — server.js maps these columns back to the same display-key
-- object shape (e.g. "Student ID", "CreatedAt") that apps-script/*.gs and
-- mock-server/server.js already return.
--
-- Dates/timestamps are stored as VARCHAR holding ISO strings (YYYY-MM-DD
-- or the full new Date().toISOString()) rather than native DATE/DATETIME
-- columns. This keeps every comparison (range filters, "latest wins"
-- lookups, monthly bucketing) byte-for-byte identical to the string
-- comparisons the existing frontend and mock-server already rely on, and
-- sidesteps mysql2's Date-object/timezone conversion entirely. ISO-8601
-- strings still sort and range-compare correctly as plain strings.
--
-- Run with: npm run setup  (executes this file, then seeds the admin user)

-- Portal logins. `role` is 'admin' (full access, incl. managing users) or
-- 'employee' (add Students/Job Status only, no Payments section at all,
-- never edit/delete). 'hr' may still appear on older rows and behaves
-- exactly like 'employee'.
-- Rows are seeded by npm run setup and managed at runtime from the app
-- (Settings > User Management, admin only).
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(100) NOT NULL,
  salt          VARCHAR(64) NOT NULL,
  password_hash CHAR(64) NOT NULL,
  role          VARCHAR(20) NOT NULL,
  created_at    VARCHAR(40) NOT NULL,
  UNIQUE KEY uq_users_username (username)
);

CREATE TABLE IF NOT EXISTS sessions (
  token      VARCHAR(64) PRIMARY KEY,
  username   VARCHAR(100) NOT NULL,
  role       VARCHAR(20) NOT NULL,
  expires_at BIGINT NOT NULL
);

-- Named counters: one row per enquiry year ("YEAR_2026" -> last sequence
-- used for that year's Student IDs) plus one row for the payment sequence
-- ("PAYMENT_SEQ"). Incremented inside a transaction with SELECT ... FOR
-- UPDATE, the SQL equivalent of apps-script's LockService.
CREATE TABLE IF NOT EXISTS counters (
  name  VARCHAR(50) PRIMARY KEY,
  value BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS students (
  student_id     VARCHAR(20) PRIMARY KEY,
  student_name   VARCHAR(150) NOT NULL,
  enquiry_date   VARCHAR(20) NOT NULL,
  course         VARCHAR(100) NOT NULL,
  qualification  VARCHAR(50) NOT NULL DEFAULT '',
  referred_by    VARCHAR(150) NOT NULL DEFAULT '',
  gmail          VARCHAR(150) NOT NULL,
  mobile_number  VARCHAR(15) NOT NULL,
  created_at     VARCHAR(40) NOT NULL,
  updated_at     VARCHAR(40) NOT NULL,
  UNIQUE KEY uq_students_mobile (mobile_number),
  UNIQUE KEY uq_students_gmail (gmail)
);

CREATE TABLE IF NOT EXISTS jobs (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  student_id           VARCHAR(20) NOT NULL,
  student_name         VARCHAR(150) NOT NULL,
  office_joining_date  VARCHAR(20) NOT NULL DEFAULT '',
  job_status           VARCHAR(50) NOT NULL,
  course               VARCHAR(100) NOT NULL DEFAULT '',
  organization         VARCHAR(150) NOT NULL DEFAULT '',
  job_joining_date     VARCHAR(20) NOT NULL DEFAULT '',
  created_at           VARCHAR(40) NOT NULL,
  updated_at           VARCHAR(40) NOT NULL,
  KEY idx_jobs_student (student_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  payment_id         VARCHAR(20) NOT NULL,
  student_id         VARCHAR(20) NOT NULL,
  student_name       VARCHAR(150) NOT NULL,
  course             VARCHAR(100) NOT NULL DEFAULT '',
  installment_no     INT NOT NULL DEFAULT 1,
  job_offer_date     VARCHAR(20) NOT NULL DEFAULT '',
  total_course_fee   DECIMAL(12,2) NOT NULL,
  payment_received   DECIMAL(12,2) NOT NULL,
  payment_method     VARCHAR(50) NOT NULL,
  pending_amount     DECIMAL(12,2) NOT NULL,
  payment_date       VARCHAR(20) NOT NULL,
  created_at         VARCHAR(40) NOT NULL,
  UNIQUE KEY uq_payments_payment_id (payment_id),
  KEY idx_payments_student (student_id)
);

-- ---------------------------------------------------------------------------
-- Audit / history log tables. One row is appended for every INSERT, UPDATE
-- and DELETE on students / jobs / payments, inside the SAME transaction as
-- the change, so a modification and its log entry commit or roll back
-- together (store.js: logChange()). All three share one shape:
--   record_key   the changed row's own key
--                (students: student_id, jobs: jobs.id, payments: payment_id)
--   student_id   the related student, for easy per-student history lookups
--   action       'INSERT' | 'UPDATE' | 'DELETE'
--   actor        username of the logged-in user who made the change
--   actor_role   that user's role at the time ('admin' / 'employee' / ...)
--   data_before  full row snapshot before the change (NULL for INSERT)
--   data_after   full row snapshot after the change  (NULL for DELETE)
--   changed_at   ISO timestamp string, same convention as created_at above
-- These are never edited or deleted by the app; they are an append-only
-- trail. server.js ensures they exist on startup, so a deploy needs no
-- manual migration step.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS students_log (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  record_key   VARCHAR(40) NOT NULL,
  student_id   VARCHAR(20) NOT NULL DEFAULT '',
  action       VARCHAR(10) NOT NULL,
  actor        VARCHAR(100) NOT NULL DEFAULT 'unknown',
  actor_role   VARCHAR(20) NOT NULL DEFAULT '',
  data_before  JSON NULL,
  data_after   JSON NULL,
  changed_at   VARCHAR(40) NOT NULL,
  KEY idx_students_log_key (record_key),
  KEY idx_students_log_student (student_id),
  KEY idx_students_log_time (changed_at)
);

CREATE TABLE IF NOT EXISTS jobs_log (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  record_key   VARCHAR(40) NOT NULL,
  student_id   VARCHAR(20) NOT NULL DEFAULT '',
  action       VARCHAR(10) NOT NULL,
  actor        VARCHAR(100) NOT NULL DEFAULT 'unknown',
  actor_role   VARCHAR(20) NOT NULL DEFAULT '',
  data_before  JSON NULL,
  data_after   JSON NULL,
  changed_at   VARCHAR(40) NOT NULL,
  KEY idx_jobs_log_key (record_key),
  KEY idx_jobs_log_student (student_id),
  KEY idx_jobs_log_time (changed_at)
);

CREATE TABLE IF NOT EXISTS payments_log (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  record_key   VARCHAR(40) NOT NULL,
  student_id   VARCHAR(20) NOT NULL DEFAULT '',
  action       VARCHAR(10) NOT NULL,
  actor        VARCHAR(100) NOT NULL DEFAULT 'unknown',
  actor_role   VARCHAR(20) NOT NULL DEFAULT '',
  data_before  JSON NULL,
  data_after   JSON NULL,
  changed_at   VARCHAR(40) NOT NULL,
  KEY idx_payments_log_key (record_key),
  KEY idx_payments_log_student (student_id),
  KEY idx_payments_log_time (changed_at)
);
