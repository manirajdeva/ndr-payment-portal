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

const fs = require('fs');
const path = require('path');
const { pool, withTransaction } = require('./db');
const { round2, nowIso, isBlank } = require('./logic');

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
const DOCUMENT_COLS = {
  'Student ID': 'student_id', 'Student Name': 'student_name', 'Organization Name': 'org_name',
  'No of Years': 'no_of_years', 'Employee Role': 'emp_role', 'Doc Start Date': 'doc_start_date',
  'Doc End Date': 'doc_end_date', 'Form 16': 'form_16', 'PF': 'pf',
  'Processed Date': 'processed_date', 'Given By': 'given_by',
  'CreatedAt': 'created_at', 'UpdatedAt': 'updated_at'
};
const PAYMENT_COLS = {
  'Payment ID': 'payment_id', 'Student ID': 'student_id', 'Student Name': 'student_name', 'Course': 'course',
  'Installment No': 'installment_no', 'Job Offer Date': 'job_offer_date', 'Total Course Fee': 'total_course_fee',
  'Payment Received': 'payment_received', 'Payment Method': 'payment_method', 'Payment Type': 'payment_type',
  'Pending Amount': 'pending_amount',
  'Payment Date': 'payment_date', 'CreatedAt': 'created_at'
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

/* ---------------- Audit / history log ---------------- */

// entity -> log table. The value is a fixed literal, never request input,
// so interpolating it into the INSERT below is safe.
const LOG_TABLE = { students: 'students_log', jobs: 'jobs_log', payments: 'payments_log', documents: 'documents_log' };

/**
 * Appends one audit row for a change to students / jobs / payments /
 * documents. MUST be
 * called on the same `conn` (transaction) as the change itself, so the two
 * commit or roll back together — an audit trail with silent gaps is worse
 * than none. `actor` is { username, role } from the caller's session.
 */
async function logChange(conn, entity, { recordKey, studentId, action, actor, before, after }) {
  const table = LOG_TABLE[entity];
  if (!table) throw new Error(`logChange: unknown entity "${entity}"`);
  await conn.query(
    `INSERT INTO ${table}
       (record_key, student_id, action, actor, actor_role, data_before, data_after, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(recordKey),
      studentId != null ? String(studentId) : '',
      action,
      (actor && actor.username) || 'unknown',
      (actor && actor.role) || '',
      before != null ? JSON.stringify(before) : null,
      after != null ? JSON.stringify(after) : null,
      nowIso()
    ]
  );
}

function auditToDisplay(row) {
  return {
    id: row.id, recordKey: row.record_key, studentId: row.student_id,
    action: row.action, actor: row.actor, actorRole: row.actor_role,
    dataBefore: row.data_before, dataAfter: row.data_after, changedAt: row.changed_at
  };
}

/** Reads an audit-log table, newest first, optionally filtered by student or by the changed row's own key. */
async function loadAuditLog(entity, { studentId, recordKey } = {}) {
  const table = LOG_TABLE[entity];
  if (!table) throw new Error(`loadAuditLog: unknown entity "${entity}"`);
  const where = [];
  const vals = [];
  if (studentId) { where.push('student_id = ?'); vals.push(String(studentId)); }
  if (recordKey) { where.push('record_key = ?'); vals.push(String(recordKey)); }
  const sql = `SELECT * FROM ${table}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`;
  const [rows] = await pool.query(sql, vals);
  return rows.map(auditToDisplay);
}

/**
 * Columns added to an existing table after its first deploy. CREATE TABLE
 * IF NOT EXISTS leaves an already-created table untouched, so each of these
 * needs an ALTER — applied only when the column is genuinely missing, which
 * keeps this safe to run on every startup.
 *
 * The table/column names are fixed literals, never request input, so
 * interpolating them into the ALTER below is safe.
 */
const ADDED_COLUMNS = [
  { table: 'payments', column: 'payment_type', definition: "VARCHAR(50) NOT NULL DEFAULT '' AFTER payment_method" }
];

async function applyColumnMigrations() {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const [rows] = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, column]
    );
    if (rows.length) continue;
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`Migration: added ${table}.${column}`);
  }
}

/**
 * Runs schema.sql (every statement is CREATE TABLE IF NOT EXISTS, so this
 * is idempotent), then adds any column introduced after a table was first
 * created. Called once on server startup so a deploy — new audit-log tables
 * and new columns included — needs no manual migration step.
 */
async function ensureSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = sql.split(/;\s*(?:\r?\n|$)/).map(s => s.trim()).filter(Boolean);
  for (const statement of statements) await pool.query(statement);
  await applyColumnMigrations();
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

async function insertStudent(conn, row, actor) {
  const { sql, values } = insertStatement('students', STUDENT_COLS, row);
  await conn.query(sql, values);
  await logChange(conn, 'students', {
    recordKey: row['Student ID'], studentId: row['Student ID'], action: 'INSERT', actor, after: row
  });
  return row;
}

async function updateStudentRow(conn, studentId, update, actor, before) {
  const sets = Object.entries(STUDENT_COLS).filter(([k]) => k in update);
  const sql = `UPDATE students SET ${sets.map(([, col]) => `${col} = ?`).join(', ')} WHERE student_id = ?`;
  const values = sets.map(([k]) => update[k]).concat([studentId]);
  const [result] = await conn.query(sql, values);
  if (result.affectedRows) {
    await logChange(conn, 'students', {
      recordKey: studentId, studentId, action: 'UPDATE', actor,
      before: before || null,
      after: Object.assign({}, before, update, { 'Student ID': studentId })
    });
  }
  return result.affectedRows;
}

async function deleteStudentRow(studentId, actor) {
  return withTransaction(async conn => {
    const [rows] = await conn.query('SELECT * FROM students WHERE student_id = ? FOR UPDATE', [studentId]);
    const before = rows.length ? toDisplay(rows[0], STUDENT_COLS) : null;
    const [result] = await conn.query('DELETE FROM students WHERE student_id = ?', [studentId]);
    if (result.affectedRows) {
      await logChange(conn, 'students', { recordKey: studentId, studentId, action: 'DELETE', actor, before });
    }
    return result.affectedRows;
  });
}

/** Keeps Student Name/Course consistent in Job Status + Payments + Documents if edited later (mirrors apps-script). */
async function syncStudentNameEverywhere(conn, studentId, name, course) {
  await conn.query('UPDATE jobs SET student_name = ? WHERE student_id = ?', [name, studentId]);
  await conn.query('UPDATE payments SET student_name = ? WHERE student_id = ?', [name, studentId]);
  await conn.query('UPDATE documents SET student_name = ? WHERE student_id = ?', [name, studentId]);
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

async function insertJob(conn, row, actor) {
  const { sql, values } = insertStatement('jobs', JOB_COLS, row);
  const [result] = await conn.query(sql, values);
  const saved = { ...row, _row: result.insertId };
  await logChange(conn, 'jobs', {
    recordKey: result.insertId, studentId: row['Student ID'], action: 'INSERT', actor, after: saved
  });
  return saved;
}

async function updateJobRow(conn, rowId, update, actor) {
  const [beforeRows] = await conn.query('SELECT * FROM jobs WHERE id = ? FOR UPDATE', [rowId]);
  const before = beforeRows.length ? toDisplay(beforeRows[0], JOB_COLS, true) : null;

  const fields = ['Office Joining Date', 'Job Status', 'Organization', 'Job Joining Date', 'UpdatedAt'];
  const sets = fields.filter(k => k in update);
  const sql = `UPDATE jobs SET ${sets.map(k => `${JOB_COLS[k]} = ?`).join(', ')} WHERE id = ?`;
  const values = sets.map(k => update[k]).concat([rowId]);
  const [result] = await conn.query(sql, values);
  if (result.affectedRows && before) {
    await logChange(conn, 'jobs', {
      recordKey: rowId, studentId: before['Student ID'], action: 'UPDATE', actor,
      before, after: Object.assign({}, before, update)
    });
  }
  return result.affectedRows;
}

async function deleteJobRow(rowId, actor) {
  return withTransaction(async conn => {
    const [rows] = await conn.query('SELECT * FROM jobs WHERE id = ? FOR UPDATE', [rowId]);
    const before = rows.length ? toDisplay(rows[0], JOB_COLS, true) : null;
    const [result] = await conn.query('DELETE FROM jobs WHERE id = ?', [rowId]);
    if (result.affectedRows) {
      await logChange(conn, 'jobs', {
        recordKey: rowId, studentId: before ? before['Student ID'] : '', action: 'DELETE', actor, before
      });
    }
    return result.affectedRows;
  });
}

/* ---------------- Documents ---------------- */

/**
 * form_16 / pf are stored as TINYINT(1) and no_of_years as DECIMAL, both of
 * which mysql2 hands back as 0/1 and as a string. Normalising them here
 * keeps the row shape the frontend receives identical to mock-server's
 * (real booleans, a real number), so js/documents.js needs no per-backend
 * special-casing.
 */
function documentToDisplay(dbRow) {
  const row = toDisplay(dbRow, DOCUMENT_COLS, true);
  row['Form 16'] = !!dbRow.form_16;
  row['PF'] = !!dbRow.pf;
  row['No of Years'] = Number(dbRow.no_of_years) || 0;
  return row;
}

/** The values actually written to SQL — booleans back to 1/0 for TINYINT(1). */
function documentToDb(row) {
  return Object.assign({}, row, {
    'Form 16': row['Form 16'] ? 1 : 0,
    'PF': row['PF'] ? 1 : 0
  });
}

async function loadDocuments() {
  const [rows] = await pool.query('SELECT * FROM documents');
  return rows.map(documentToDisplay);
}

async function insertDocument(conn, row, actor) {
  const { sql, values } = insertStatement('documents', DOCUMENT_COLS, documentToDb(row));
  const [result] = await conn.query(sql, values);
  const saved = { ...row, _row: result.insertId };
  await logChange(conn, 'documents', {
    recordKey: result.insertId, studentId: row['Student ID'], action: 'INSERT', actor, after: saved
  });
  return saved;
}

async function updateDocumentRow(conn, rowId, update, actor) {
  const [beforeRows] = await conn.query('SELECT * FROM documents WHERE id = ? FOR UPDATE', [rowId]);
  const before = beforeRows.length ? documentToDisplay(beforeRows[0]) : null;

  // 'Processed Date' is deliberately not updatable — it records when the
  // documents were first processed (see schema.sql).
  const fields = [
    'Organization Name', 'No of Years', 'Employee Role', 'Doc Start Date',
    'Doc End Date', 'Form 16', 'PF', 'Given By', 'UpdatedAt'
  ];
  const dbUpdate = documentToDb(update);
  const sets = fields.filter(k => k in update);
  const sql = `UPDATE documents SET ${sets.map(k => `${DOCUMENT_COLS[k]} = ?`).join(', ')} WHERE id = ?`;
  const values = sets.map(k => dbUpdate[k]).concat([rowId]);
  const [result] = await conn.query(sql, values);
  if (result.affectedRows && before) {
    await logChange(conn, 'documents', {
      recordKey: rowId, studentId: before['Student ID'], action: 'UPDATE', actor,
      before, after: Object.assign({}, before, update)
    });
  }
  return result.affectedRows;
}

async function deleteDocumentRow(rowId, actor) {
  return withTransaction(async conn => {
    const [rows] = await conn.query('SELECT * FROM documents WHERE id = ? FOR UPDATE', [rowId]);
    const before = rows.length ? documentToDisplay(rows[0]) : null;
    const [result] = await conn.query('DELETE FROM documents WHERE id = ?', [rowId]);
    if (result.affectedRows) {
      await logChange(conn, 'documents', {
        recordKey: rowId, studentId: before ? before['Student ID'] : '', action: 'DELETE', actor, before
      });
    }
    return result.affectedRows;
  });
}

/* ---------------- Payments ---------------- */

async function loadPayments() {
  const [rows] = await pool.query('SELECT * FROM payments');
  return rows.map(r => toDisplay(r, PAYMENT_COLS, true));
}

async function insertPayment(conn, row, actor) {
  const { sql, values } = insertStatement('payments', PAYMENT_COLS, row);
  const [result] = await conn.query(sql, values);
  const saved = { ...row, _row: result.insertId };
  await logChange(conn, 'payments', {
    recordKey: row['Payment ID'], studentId: row['Student ID'], action: 'INSERT', actor, after: saved
  });
  return saved;
}

async function updatePaymentRow(conn, rowId, update, actor) {
  const [beforeRows] = await conn.query('SELECT * FROM payments WHERE id = ? FOR UPDATE', [rowId]);
  const before = beforeRows.length ? toDisplay(beforeRows[0], PAYMENT_COLS, true) : null;

  const fields = ['Job Offer Date', 'Total Course Fee', 'Payment Received', 'Payment Method', 'Payment Type', 'Pending Amount', 'Payment Date'];
  const sets = fields.filter(k => k in update);
  const sql = `UPDATE payments SET ${sets.map(k => `${PAYMENT_COLS[k]} = ?`).join(', ')} WHERE id = ?`;
  const values = sets.map(k => update[k]).concat([rowId]);
  const [result] = await conn.query(sql, values);
  if (result.affectedRows && before) {
    await logChange(conn, 'payments', {
      recordKey: before['Payment ID'], studentId: before['Student ID'], action: 'UPDATE', actor,
      before, after: Object.assign({}, before, update)
    });
  }
  return result.affectedRows;
}

async function deletePaymentRow(rowId, actor) {
  return withTransaction(async conn => {
    const [rows] = await conn.query('SELECT * FROM payments WHERE id = ? FOR UPDATE', [rowId]);
    const before = rows.length ? toDisplay(rows[0], PAYMENT_COLS, true) : null;
    const [result] = await conn.query('DELETE FROM payments WHERE id = ?', [rowId]);
    if (result.affectedRows) {
      await logChange(conn, 'payments', {
        recordKey: before ? before['Payment ID'] : rowId, studentId: before ? before['Student ID'] : '',
        action: 'DELETE', actor, before
      });
    }
    return result.affectedRows;
  });
}

/**
 * Locks every payment row for the student (SELECT ... FOR UPDATE) so a
 * concurrent insert can't race past the overpayment check — the SQL
 * equivalent of apps-script's LockService. Caller must be inside a
 * transaction. Returns:
 *   sum            paid so far, excluding excludeRowId (for edits)
 *   count          total rows, for the next installment number
 *   firstRowId     the student's first installment — the one whose Payment
 *                  Type governs all the others
 *   inheritedType  that governing Payment Type: the earliest installment's,
 *                  skipping rows saved before the field existed (blank ones)
 */
async function sumPaymentsForStudent(conn, studentId, excludeRowId) {
  const [rows] = await conn.query(
    'SELECT id, payment_received, payment_type, installment_no FROM payments WHERE student_id = ? FOR UPDATE', [studentId]
  );
  const sum = rows
    .filter(r => r.id !== excludeRowId)
    .reduce((acc, r) => acc + (Number(r.payment_received) || 0), 0);

  const inOrder = rows.slice().sort((a, b) =>
    (Number(a.installment_no) || 0) - (Number(b.installment_no) || 0) || a.id - b.id);
  const governing = inOrder.find(r => !isBlank(r.payment_type));

  return {
    sum: round2(sum),
    count: rows.length,
    firstRowId: inOrder.length ? inOrder[0].id : null,
    inheritedType: governing ? governing.payment_type : ''
  };
}

/** Applies one Payment Type to every payment a student has, so later installments never drift from the first one. Caller must be inside a transaction. */
async function syncPaymentTypeForStudent(conn, studentId, paymentType) {
  await conn.query('UPDATE payments SET payment_type = ? WHERE student_id = ?', [paymentType, studentId]);
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

/** Every login, newest first, without the salt/hash columns — for the Settings > User Management table. */
async function listUsers() {
  const [rows] = await pool.query('SELECT id, username, role, created_at FROM users ORDER BY id');
  return rows.map(r => ({ id: r.id, username: r.username, role: r.role, createdAt: r.created_at }));
}

async function findUserById(id) {
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0] || null;
}

/** How many admin accounts exist other than `excludeId` — used to refuse removing the last admin. */
async function countOtherAdmins(excludeId) {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS n FROM users WHERE role = ? AND id <> ?', ['admin', excludeId || 0]
  );
  return Number(rows[0].n);
}

async function insertUser({ username, salt, passwordHash, role, createdAt }) {
  const [result] = await pool.query(
    'INSERT INTO users (username, salt, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
    [username, salt, passwordHash, role, createdAt]
  );
  return { id: result.insertId, username, role, createdAt };
}

/** Updates any of role / salt / password_hash that are present in `fields`. */
async function updateUserRow(id, fields) {
  const sets = [];
  const values = [];
  if (fields.role !== undefined) { sets.push('role = ?'); values.push(fields.role); }
  if (fields.salt !== undefined) { sets.push('salt = ?'); values.push(fields.salt); }
  if (fields.passwordHash !== undefined) { sets.push('password_hash = ?'); values.push(fields.passwordHash); }
  if (!sets.length) return 0;
  values.push(id);
  const [result] = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values);
  return result.affectedRows;
}

async function deleteUserRow(id) {
  const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);
  return result.affectedRows;
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
  withTransaction, ensureSchema, logChange, loadAuditLog,
  loadStudents, findStudentById, assertNoDuplicateStudent, insertStudent, updateStudentRow, deleteStudentRow, syncStudentNameEverywhere,
  loadJobs, insertJob, updateJobRow, deleteJobRow,
  loadDocuments, insertDocument, updateDocumentRow, deleteDocumentRow,
  loadPayments, insertPayment, updatePaymentRow, deletePaymentRow, sumPaymentsForStudent, syncPaymentTypeForStudent, getStudentIdForPaymentRow,
  generateStudentId, nextPaymentId,
  findUserByUsername, listUsers, findUserById, countOtherAdmins, insertUser, updateUserRow, deleteUserRow,
  createSession, getSession, deleteSession
};
