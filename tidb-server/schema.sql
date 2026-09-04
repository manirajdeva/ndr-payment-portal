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
