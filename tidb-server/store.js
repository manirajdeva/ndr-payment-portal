/**
 * store.js
 * All SQL lives here. Every function returns/accepts the same display-key
 * object shape the frontend already speaks (e.g. "Student ID", "CreatedAt")
 * — see schema.sql's header comment for why. Tables are small (a training
 * company's enrollments, not a mass consumer app), so list endpoints fetch
 * the whole table and reuse logic.paginateAndSort in Node, exactly like
 * mock-server/server.js — simplest possible code path that still keeps
 * every backend byte-for-byte compatible. If a table ever grows past tens
 * of thousands of rows, push the WHERE/ORDER BY/LIMIT down into SQL instead.
 */

const { pool, withTransaction } = require('./db');
const { round2, nowIso } = require('./logic');

const STUDENT_COLS = {
  'Student ID': 'student_id', 'Student Name': 'student_name', 'Enquiry Date': 'enquiry_date',
  'Course': 'course', 'Qualification': 'qualification', 'Referred By': 'referred_by',
  'Gmail': 'gmail', 'Mobile Number': 'mobile_number', 'CreatedAt': 'created_at', 'UpdatedAt': 'updated_at'
};
const JOB_COLS = {
  'Student ID': 'student_id', 'Student Name': 'student_name', 'Office Joining Date': 'office_joining_date',
  'Job Status': 'job_status', 'Course': 'course', 'Organization': 'organization',
  'Job Joining Date': 'job_joining_date', 'CreatedAt': 'created_at', 'UpdatedAt': 'updated_at'
};
const PAYMENT_COLS = {
  'Payment ID': 'payment_id', 'Student ID': 'student_id', 'Student Name': 'student_name', 'Course': 'course',
  'Job Offer Date': 'job_offer_date', 'Total Course Fee': 'total_course_fee', 'Payment Received': 'payment_received',
  'Payment Method': 'payment_method', 'Pending Amount': 'pending_amount', 'Payment Date': 'payment_date',
  'CreatedAt': 'created_at'
};

function toDisplay(dbRow, colMap, withRowId) {
  const obj = {};
  for (const [display, col] of Object.entries(colMap)) obj[display] = dbRow[col];
  if (withRowId) obj._row = dbRow.id;
  return obj;
}

function insertStatement(table, colMap, row, extra = {}) {
  const columns = Object.values(colMap).concat(Object.keys(extra));
  const placeholders = columns.map(() => '?').join(', ');
  const values = Object.keys(colMap).map(display => row[display]).concat(Object.values(extra));
  return { sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`, values };
}

/* ---------------- Students ---------------- */

async function loadStudents() {
  const [rows] = await pool.query('SELECT * FROM students');
  return rows.map(r => toDisplay(r, STUDENT_COLS));
}

async function findStudentById(studentId, conn = pool) {
  const [rows] = await conn.query('SELECT * FROM students WHERE student_id = ?', [studentId]);
  return rows.length ? toDisplay(rows[0], STUDENT_COLS) : null;
}

/** Throws DUPLICATE_MOBILE/DUPLICATE_EMAIL (mirrors apps-script's assertNoDuplicateStudent_). */
async function assertNoDuplicateStudent(conn, data, excludeStudentId) {
  const { AppError } = require('./logic');
  const mobile = String(data['Mobile Number']).trim();
  const email = String(data['Gmail']).trim().toLowerCase();
  const exclude = excludeStudentId || '';

  let [rows] = await conn.query(
    'SELECT student_id FROM students WHERE mobile_number = ? AND student_id <> ?', [mobile, exclude]
  );
  if (rows.length) throw new AppError('DUPLICATE_MOBILE', `A student with this mobile number already exists (${rows[0].student_id}).`);

  [rows] = await conn.query(
    'SELECT student_id FROM students WHERE gmail = ? AND student_id <> ?', [email, exclude]
  );
  if (rows.length) throw new AppError('DUPLICATE_EMAIL', `A student with this email already exists (${rows[0].student_id}).`);
}

async function insertStudent(conn, row) {
  const { sql, values } = insertStatement('students', STUDENT_COLS, row);
  await conn.query(sql, values);
  return row;
}

async function updateStudentRow(conn, studentId, update) {
  const sets = Object.entries(STUDENT_COLS).filter(([k]) => k in update);
  const sql = `UPDATE students SET ${sets.map(([, col]) => `${col} = ?`).join(', ')} WHERE student_id = ?`;
  const values = sets.map(([k]) => update[k]).concat([studentId]);
  const [result] = await conn.query(sql, values);
  return result.affectedRows;
}

async function deleteStudentRow(studentId) {
  const [result] = await pool.query('DELETE FROM students WHERE student_id = ?', [studentId]);
  return result.affectedRows;
}

/** Keeps Student Name/Course consistent in Job Status + Payments if edited later (mirrors apps-script). */
async function syncStudentNameEverywhere(conn, studentId, name, course) {
  await conn.query('UPDATE jobs SET student_name = ? WHERE student_id = ?', [name, studentId]);
  await conn.query('UPDATE payments SET student_name = ? WHERE student_id = ?', [name, studentId]);
  if (course) {
    await conn.query('UPDATE jobs SET course = ? WHERE student_id = ?', [course, studentId]);
    await conn.query('UPDATE payments SET course = ? WHERE student_id = ?', [course, studentId]);
  }
}

/* ---------------- Jobs ---------------- */

async function loadJobs() {
  const [rows] = await pool.query('SELECT * FROM jobs');
  return rows.map(r => toDisplay(r, JOB_COLS, true));
}

async function insertJob(conn, row) {
  const { sql, values } = insertStatement('jobs', JOB_COLS, row);
  const [result] = await conn.query(sql, values);
  return { ...row, _row: result.insertId };
}

async function updateJobRow(conn, rowId, update) {
  const fields = ['Office Joining Date', 'Job Status', 'Organization', 'Job Joining Date', 'UpdatedAt'];
  const sets = fields.filter(k => k in update);
  const sql = `UPDATE jobs SET ${sets.map(k => `${JOB_COLS[k]} = ?`).join(', ')} WHERE id = ?`;
  const values = sets.map(k => update[k]).concat([rowId]);
  const [result] = await conn.query(sql, values);
  return result.affectedRows;
}

async function deleteJobRow(rowId) {
  const [result] = await pool.query('DELETE FROM jobs WHERE id = ?', [rowId]);
  return result.affectedRows;
}

/* ---------------- Payments ---------------- */

async function loadPayments() {
  const [rows] = await pool.query('SELECT * FROM payments');
  return rows.map(r => toDisplay(r, PAYMENT_COLS, true));
}

async function insertPayment(conn, row) {
  const { sql, values } = insertStatement('payments', PAYMENT_COLS, row);
  const [result] = await conn.query(sql, values);
  return { ...row, _row: result.insertId };
}

async function updatePaymentRow(conn, rowId, update) {
  const fields = ['Job Offer Date', 'Total Course Fee', 'Payment Received', 'Payment Method', 'Pending Amount', 'Payment Date'];
  const sets = fields.filter(k => k in update);
  const sql = `UPDATE payments SET ${sets.map(k => `${PAYMENT_COLS[k]} = ?`).join(', ')} WHERE id = ?`;
  const values = sets.map(k => update[k]).concat([rowId]);
  const [result] = await conn.query(sql, values);
  return result.affectedRows;
}

async function deletePaymentRow(rowId) {
  const [result] = await pool.query('DELETE FROM payments WHERE id = ?', [rowId]);
  return result.affectedRows;
}

/** Locks every payment row for the student (SELECT ... FOR UPDATE) so a concurrent insert can't race past the overpayment check — the SQL equivalent of apps-script's LockService. Caller must be inside a transaction. */
async function sumPaymentsForStudent(conn, studentId, excludeRowId) {
  const [rows] = await conn.query(
    'SELECT id, payment_received FROM payments WHERE student_id = ? FOR UPDATE', [studentId]
  );
  const sum = rows
    .filter(r => r.id !== excludeRowId)
    .reduce((acc, r) => acc + (Number(r.payment_received) || 0), 0);
  return round2(sum);
}

async function getStudentIdForPaymentRow(conn, rowId) {
  const [rows] = await conn.query('SELECT student_id FROM payments WHERE id = ? FOR UPDATE', [rowId]);
  return rows.length ? rows[0].student_id : null;
}

/* ---------------- Counters (student IDs, payment IDs) ---------------- */

/** Atomically returns the next sequence value for `name`, starting at 1. Caller must be inside a transaction. */
async function nextCounterValue(conn, name) {
  const [rows] = await conn.query('SELECT value FROM counters WHERE name = ? FOR UPDATE', [name]);
  let next;
  if (rows.length === 0) {
    next = 1;
    await conn.query('INSERT INTO counters (name, value) VALUES (?, ?)', [name, next]);
  } else {
    next = Number(rows[0].value) + 1;
    await conn.query('UPDATE counters SET value = ? WHERE name = ?', [next, name]);
  }
  return next;
}

async function generateStudentId(conn) {
  const year = new Date().getFullYear();
  const seq = await nextCounterValue(conn, 'YEAR_' + year);
  return 'NDR' + year + String(seq).padStart(4, '0');
}

async function nextPaymentId(conn) {
  const seq = await nextCounterValue(conn, 'PAYMENT_SEQ');
  return 'PMT' + String(seq).padStart(6, '0');
}

/* ---------------- Users / sessions ---------------- */

async function findUserByUsername(username) {
  const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
  return rows[0] || null;
}

async function createSession(token, username, role, expiresAt) {
  await pool.query('INSERT INTO sessions (token, username, role, expires_at) VALUES (?, ?, ?, ?)', [token, username, role, expiresAt]);
}

async function getSession(token) {
  const [rows] = await pool.query('SELECT * FROM sessions WHERE token = ?', [token]);
  return rows[0] || null;
}

async function deleteSession(token) {
  await pool.query('DELETE FROM sessions WHERE token = ?', [token]);
}

module.exports = {
  withTransaction,
  loadStudents, findStudentById, assertNoDuplicateStudent, insertStudent, updateStudentRow, deleteStudentRow, syncStudentNameEverywhere,
  loadJobs, insertJob, updateJobRow, deleteJobRow,
  loadPayments, insertPayment, updatePaymentRow, deletePaymentRow, sumPaymentsForStudent, getStudentIdForPaymentRow,
  generateStudentId, nextPaymentId,
  findUserByUsername, createSession, getSession, deleteSession
};
