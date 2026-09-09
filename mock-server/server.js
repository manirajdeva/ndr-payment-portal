/**
 * mock-server/server.js
 * Zero-dependency local stand-in for the Google Apps Script backend.
 * Same action names, same request/response envelope, same validation
 * rules as apps-script/*.gs — but backed by an in-memory store instead
 * of Google Sheets, so you can click through the whole portal on
 * localhost without deploying anything to Google.
 *
 * Run:  node mock-server/server.js
 * Then open dashboard.html via mock-server's static server (see README)
 * or any static file server — js/api.js auto-points at this server
 * whenever the page is served from localhost/127.0.0.1.
 *
 * This file is for local development only. It is NOT part of the
 * production deployment (that's apps-script/*.gs, deployed to Google).
 */

const http = require('http');
const crypto = require('crypto');

const PORT = 3001;
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'Admin@123';

// Non-admin roles with full add/edit/delete on Students and Job Status, but
// no Payments access and no user management. 'hr' is a legacy alias for
// 'employee'.
const EMPLOYEE_ROLES = ['employee', 'hr'];
// Roles a user account may be assigned from Settings > User Management.
const USER_ROLES = ['admin', 'employee'];

const JOB_STATUS_OPTIONS = [
  'Pending', 'Training', 'Interview Scheduled', 'Interview Cleared',
  'Selected', 'Offer Received', 'Joined', 'Rejected'
];
const PAYMENT_METHODS = ['Cash', 'UPI', 'Google Pay', 'PhonePe', 'Bank Transfer', 'Credit Card', 'Debit Card'];
// What the payment was for. Records created before this field existed have
// an empty value; it is required on every new or edited payment.
const PAYMENT_TYPES = ['Training', 'Process', 'Documents'];
const QUALIFICATION_OPTIONS = ['10th', '12th', 'Diploma', 'Graduate', 'Post Graduate', 'Other'];
const COURSE_OPTIONS = [
  'Snowflake', 'Snowflake +DBT', 'Azure', 'Aws', 'Sap-Modules',
  'Bussiness Analyst', 'GenarativeAI', 'Python'
];

/* ---------------- In-memory store ---------------- */

const db = { students: [], jobs: [], payments: [], documents: [] };
// Append-only audit trail, mirroring tidb-server's *_log tables. One entry
// per INSERT/UPDATE/DELETE on students/jobs/payments/documents, recording who did it.
// In-memory only (like the rest of this mock) — cleared on restart.
const logs = { students: [], jobs: [], payments: [], documents: [] };
const counters = { year: {}, paymentSeq: 0, jobRow: 1000, paymentRow: 2000, documentRow: 3000, logSeq: 0 };
const sessions = new Map(); // token -> { username, role, expiresAt }

/** Records one audit-log entry. `session` is the { username, role } of the caller. */
function logChange(entity, { recordKey, studentId, action, session, before, after }) {
  logs[entity].push({
    id: ++counters.logSeq,
    record_key: String(recordKey),
    student_id: studentId != null ? String(studentId) : '',
    action,
    actor: (session && session.username) || 'unknown',
    actor_role: (session && session.role) || '',
    data_before: before != null ? JSON.parse(JSON.stringify(before)) : null,
    data_after: after != null ? JSON.parse(JSON.stringify(after)) : null,
    changed_at: nowIso()
  });
}

class AppError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/* ---------------- Helpers (mirrors apps-script/Utils.gs) ---------------- */

function todayISO() { return new Date().toISOString().slice(0, 10); }
function nowIso() { return new Date().toISOString(); }
function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function monthKey(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function isBlank(v) { return v === undefined || v === null || String(v).trim() === ''; }
function requireFields(data, fields) {
  const missing = fields.filter(f => isBlank(data[f]));
  if (missing.length) throw new AppError('VALIDATION_ERROR', 'Missing required field(s): ' + missing.join(', '));
}
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim()); }
function isValidMobile(mobile) { return /^[6-9]\d{9}$/.test(String(mobile).trim()); }

/** Accepts what the frontend might send over JSON (true, 'true', 1, 'on') and normalises it to a real boolean. */
function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === undefined || v === null) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

/** Years of experience on a Documents record: optional, but must be a number between 0 and 60 when given. */
function parseYears(value) {
  if (isBlank(value)) return 0;
  const n = Number(value);
  if (!isFinite(n) || n < 0) throw new AppError('VALIDATION_ERROR', 'No of years must be a positive number.');
  if (n > 60) throw new AppError('VALIDATION_ERROR', 'No of years looks too large — please check the value.');
  return Math.round(n * 10) / 10;
}

/** A document's end date may not fall before its start date (both are optional). */
function validateDocumentDates(startDate, endDate) {
  if (!isBlank(startDate) && !isBlank(endDate) && String(endDate) < String(startDate)) {
    throw new AppError('VALIDATION_ERROR', 'Doc end date cannot be before the doc start date.');
  }
}

function buildDateCourseFilter(params, dateField) {
  const { dateFrom, dateTo, course } = params;
  if (!dateFrom && !dateTo && !course) return null;
  return (row) => {
    if (dateFrom && String(row[dateField] || '') < dateFrom) return false;
    if (dateTo && String(row[dateField] || '') > dateTo) return false;
    if (course && row['Course'] !== course) return false;
    return true;
  };
}

function paginateAndSort(rows, params) {
  let result = params.filterFn ? rows.filter(params.filterFn) : rows;
  const search = (params.search || '').toString().trim().toLowerCase();
  const searchFields = params.searchFields || [];
  if (search && searchFields.length) {
    result = result.filter(row => searchFields.some(f => String(row[f] || '').toLowerCase().includes(search)));
  }
  const sortBy = params.sortBy;
  const sortDir = (params.sortDir || 'asc').toLowerCase();
  if (sortBy) {
    result = [...result].sort((a, b) => {
      const av = a[sortBy], bv = b[sortBy];
      if (av === bv) return 0;
      const cmp = av > bv ? 1 : -1;
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }
  const total = result.length;
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const pageSize = Math.max(1, parseInt(params.pageSize, 10) || 10);
  const start = (page - 1) * pageSize;
  return {
    rows: result.slice(start, start + pageSize),
    total, page, pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  };
}

function last6Months() {
  const months = [];
  const d = new Date();
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
    months.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

function monthlySeries(rows, dateField, sumField) {
  const months = last6Months();
  const buckets = {};
  months.forEach(m => (buckets[m] = 0));
  rows.forEach(row => {
    const key = monthKey(row[dateField]);
    if (key === null || !(key in buckets)) return;
    buckets[key] += sumField ? (Number(row[sumField]) || 0) : 1;
  });
  return months.map(m => ({ month: m, value: round2(buckets[m]) }));
}

function latestPerStudent(jobRows) {
  const map = {};
  jobRows.forEach(row => {
    const id = row['Student ID'];
    const existing = map[id];
    if (!existing || String(row['UpdatedAt'] || row['CreatedAt']) >= String(existing['UpdatedAt'] || existing['CreatedAt'])) {
      map[id] = row;
    }
  });
  return map;
}

/* ---------------- Auth ---------------- */

// In-memory login list. Passwords are plaintext here on purpose — this mock
// is localhost-only dev scaffolding and never touches a real datastore.
// Users added via action_addUser live only for the life of this process.
let nextUserId = 1;
const users = [
  { id: nextUserId++, username: ADMIN_USERNAME, password: ADMIN_PASSWORD, role: 'admin', createdAt: nowIso() },
  { id: nextUserId++, username: 'hrndr@admin', password: 'Hr@2026@', role: 'employee', createdAt: nowIso() }
];

function action_login(params) {
  requireFields(params, ['username', 'password']);
  const username = String(params.username).trim();
  const password = String(params.password);

  const user = users.find(u => u.username === username && u.password === password);
  if (!user) throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password.');

  const token = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { username, role: user.role, expiresAt });
  return { token, username, role: user.role, expiresAt };
}

function action_logout(params) {
  if (params.token) sessions.delete(params.token);
  return { loggedOut: true };
}

function requireSession(params) {
  const session = sessions.get(params.token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(params.token);
    throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please log in again.');
  }
  return session;
}

function requireAdmin(params) {
  const session = requireSession(params);
  if (session.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Your account does not have permission to make changes.');
  }
  return session;
}

/** Like requireAdmin, but also allows the given extra role(s) through (e.g. 'employee' for create-only actions). */
function requireRole(params, allowedRoles) {
  const session = requireSession(params);
  if (session.role === 'admin' || allowedRoles.includes(session.role)) return session;
  throw new AppError('FORBIDDEN', 'Your account does not have permission to make changes.');
}

/* ---------------- Audit log (admin only) ---------------- */

const AUDIT_ENTITIES = ['students', 'jobs', 'payments', 'documents'];

function action_getAuditLog(params) {
  requireAdmin(params);
  const entity = String(params.entity || '').trim();
  if (!AUDIT_ENTITIES.includes(entity)) {
    throw new AppError('VALIDATION_ERROR', 'entity must be one of: students, jobs, payments, documents.');
  }
  let rows = logs[entity].slice();
  if (params.studentId) rows = rows.filter(r => r.student_id === String(params.studentId));
  if (params.recordKey) rows = rows.filter(r => r.record_key === String(params.recordKey));
  rows = rows.map(r => ({
    id: r.id, recordKey: r.record_key, studentId: r.student_id, action: r.action,
    actor: r.actor, actorRole: r.actor_role, dataBefore: r.data_before, dataAfter: r.data_after, changedAt: r.changed_at
  }));
  return paginateAndSort(rows, {
    search: params.search, searchFields: ['actor', 'action', 'recordKey', 'studentId'],
    sortBy: params.sortBy || 'id', sortDir: params.sortDir || 'desc',
    page: params.page, pageSize: params.pageSize
  });
}

/* ---------------- Users (admin only) ---------------- */

function action_listUsers(params) {
  requireAdmin(params);
  return { rows: users.map(u => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt })) };
}

function action_addUser(params) {
  requireAdmin(params);
  const data = params.data || {};
  requireFields(data, ['username', 'password', 'role']);
  const username = String(data.username).trim();
  const role = String(data.role).trim();
  const password = String(data.password);
  if (username.length < 3) throw new AppError('VALIDATION_ERROR', 'Username must be at least 3 characters.');
  if (!USER_ROLES.includes(role)) throw new AppError('VALIDATION_ERROR', 'Role must be "admin" or "employee".');
  if (password.length < 6) throw new AppError('VALIDATION_ERROR', 'Password must be at least 6 characters.');
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    throw new AppError('DUPLICATE_USER', 'A user with this username already exists.');
  }
  const user = { id: nextUserId++, username, password, role, createdAt: nowIso() };
  users.push(user);
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

function action_updateUser(params) {
  requireAdmin(params);
  const data = params.data || {};
  requireFields(data, ['id']);
  const user = users.find(u => u.id === Number(data.id));
  if (!user) throw new AppError('NOT_FOUND', 'User not found.');

  const changes = {};
  if (!isBlank(data.role)) {
    const role = String(data.role).trim();
    if (!USER_ROLES.includes(role)) throw new AppError('VALIDATION_ERROR', 'Role must be "admin" or "employee".');
    if (user.role === 'admin' && role !== 'admin' && users.filter(u => u.role === 'admin' && u.id !== user.id).length === 0) {
      throw new AppError('LAST_ADMIN', 'At least one admin account must remain.');
    }
    changes.role = role;
  }
  if (!isBlank(data.password)) {
    const password = String(data.password);
    if (password.length < 6) throw new AppError('VALIDATION_ERROR', 'Password must be at least 6 characters.');
    changes.password = password;
  }
  if (!Object.keys(changes).length) throw new AppError('VALIDATION_ERROR', 'Nothing to update — change the role or set a new password.');

  Object.assign(user, changes);
  return { id: user.id, username: user.username, role: user.role };
}

function action_deleteUser(params) {
  const session = requireAdmin(params);
  const id = Number(params.data && params.data.id);
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) throw new AppError('NOT_FOUND', 'User not found.');
  const user = users[idx];
  if (user.username === session.username) throw new AppError('SELF_DELETE', 'You cannot delete your own account.');
  if (user.role === 'admin' && users.filter(u => u.role === 'admin' && u.id !== id).length === 0) {
    throw new AppError('LAST_ADMIN', 'At least one admin account must remain.');
  }
  users.splice(idx, 1);
  return { deleted: true, id };
}

/* ---------------- Students (Module 1) ---------------- */

function generateStudentId() {
  const year = new Date().getFullYear();
  counters.year[year] = (counters.year[year] || 0) + 1;
  return 'NDR' + year + String(counters.year[year]).padStart(4, '0');
}

function action_generateStudentID() {
  return { studentId: generateStudentId() };
}

function getStudentById(studentId) {
  return db.students.find(s => s['Student ID'] === studentId) || null;
}

function validateQualificationValue(qualification) {
  if (!isBlank(qualification) && !QUALIFICATION_OPTIONS.includes(qualification)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid qualification value.');
  }
}

function validateCourseValue(course) {
  if (!COURSE_OPTIONS.includes(course)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid course value.');
  }
}

function assertNoDuplicateStudent(data, excludeStudentId) {
  const mobile = String(data['Mobile Number']).trim();
  const email = String(data['Gmail']).trim().toLowerCase();

  let dupe = db.students.find(s => (!excludeStudentId || s['Student ID'] !== excludeStudentId) && String(s['Mobile Number']).trim() === mobile);
  if (dupe) throw new AppError('DUPLICATE_MOBILE', `A student with this mobile number already exists (${dupe['Student ID']}).`);

  dupe = db.students.find(s => (!excludeStudentId || s['Student ID'] !== excludeStudentId) && String(s['Gmail']).trim().toLowerCase() === email);
  if (dupe) throw new AppError('DUPLICATE_EMAIL', `A student with this email already exists (${dupe['Student ID']}).`);
}

function syncStudentNameEverywhere(studentId, name, course) {
  db.jobs.forEach(j => { if (j['Student ID'] === studentId) { j['Student Name'] = name; if (course) j['Course'] = course; } });
  db.payments.forEach(p => { if (p['Student ID'] === studentId) { p['Student Name'] = name; } });
  db.documents.forEach(d => { if (d['Student ID'] === studentId) { d['Student Name'] = name; } });
}

function action_getStudents(params) {
  requireSession(params);
  return paginateAndSort(db.students, {
    search: params.search, searchFields: ['Student ID', 'Student Name', 'Mobile Number', 'Gmail'],
    filterFn: buildDateCourseFilter(params, 'Enquiry Date'),
    sortBy: params.sortBy || 'CreatedAt', sortDir: params.sortDir || 'desc', page: params.page, pageSize: params.pageSize
  });
}

function action_searchStudent(params) {
  requireSession(params);
  const query = String(params.query || '').trim().toLowerCase();
  if (!query) return { rows: db.students.slice(0, 20) };
  const matches = db.students.filter(row =>
    ['Student ID', 'Student Name', 'Mobile Number', 'Gmail'].some(f => String(row[f] || '').toLowerCase().includes(query))
  );
  return { rows: matches.slice(0, 20) };
}

function action_addStudent(params) {
  const session = requireRole(params, EMPLOYEE_ROLES);
  const data = params.data || {};
  requireFields(data, ['Student Name', 'Course', 'Gmail', 'Mobile Number']);
  if (!isValidEmail(data['Gmail'])) throw new AppError('VALIDATION_ERROR', 'Please enter a valid email address.');
  if (!isValidMobile(data['Mobile Number'])) throw new AppError('VALIDATION_ERROR', 'Please enter a valid 10-digit mobile number.');
  validateCourseValue(data['Course']);
  validateQualificationValue(data['Qualification']);
  assertNoDuplicateStudent(data, null);

  const now = nowIso();
  const row = {
    'Student ID': generateStudentId(),
    'Student Name': String(data['Student Name']).trim(),
    'Enquiry Date': data['Enquiry Date'] || todayISO(),
    'Course': data['Course'],
    'Qualification': data['Qualification'] || '',
    'Referred By': data['Referred By'] || '',
    'Gmail': String(data['Gmail']).trim().toLowerCase(),
    'Mobile Number': String(data['Mobile Number']).trim(),
    'CreatedAt': now, 'UpdatedAt': now
  };
  db.students.push(row);
  logChange('students', { recordKey: row['Student ID'], studentId: row['Student ID'], action: 'INSERT', session, after: row });
  return row;
}

function action_updateStudent(params) {
  const session = requireRole(params, EMPLOYEE_ROLES);
  const data = params.data || {};
  requireFields(data, ['Student ID', 'Student Name', 'Course', 'Gmail', 'Mobile Number']);
  if (!isValidEmail(data['Gmail'])) throw new AppError('VALIDATION_ERROR', 'Please enter a valid email address.');
  if (!isValidMobile(data['Mobile Number'])) throw new AppError('VALIDATION_ERROR', 'Please enter a valid 10-digit mobile number.');
  validateCourseValue(data['Course']);
  validateQualificationValue(data['Qualification']);

  const student = getStudentById(data['Student ID']);
  if (!student) throw new AppError('NOT_FOUND', 'Student not found.');
  assertNoDuplicateStudent(data, data['Student ID']);

  const before = JSON.parse(JSON.stringify(student));
  Object.assign(student, {
    'Student Name': String(data['Student Name']).trim(),
    'Enquiry Date': data['Enquiry Date'],
    'Course': data['Course'],
    'Qualification': data['Qualification'] || '',
    'Referred By': data['Referred By'] || '',
    'Gmail': String(data['Gmail']).trim().toLowerCase(),
    'Mobile Number': String(data['Mobile Number']).trim(),
    'UpdatedAt': nowIso()
  });
  syncStudentNameEverywhere(data['Student ID'], student['Student Name'], student['Course']);
  logChange('students', { recordKey: student['Student ID'], studentId: student['Student ID'], action: 'UPDATE', session, before, after: student });
  return student;
}

function action_deleteStudent(params) {
  const session = requireRole(params, EMPLOYEE_ROLES);
  const studentId = params.data && params.data['Student ID'];
  if (isBlank(studentId)) throw new AppError('VALIDATION_ERROR', 'Student ID is required.');
  const idx = db.students.findIndex(s => s['Student ID'] === studentId);
  if (idx === -1) throw new AppError('NOT_FOUND', 'Student not found.');
  const before = db.students[idx];
  db.students.splice(idx, 1);
  logChange('students', { recordKey: studentId, studentId, action: 'DELETE', session, before });
  return { deleted: true, studentId };
}

/* ---------------- Job Status (Module 2) ---------------- */

function validateJobStatusValue(status) {
  if (!JOB_STATUS_OPTIONS.includes(status)) throw new AppError('VALIDATION_ERROR', 'Invalid job status value.');
}

function action_getJobStatus(params) {
  requireSession(params);
  return paginateAndSort(db.jobs, {
    search: params.search, searchFields: ['Student ID', 'Student Name', 'Organization', 'Job Status'],
    filterFn: buildDateCourseFilter(params, 'Office Joining Date'),
    sortBy: params.sortBy || 'CreatedAt', sortDir: params.sortDir || 'desc', page: params.page, pageSize: params.pageSize
  });
}

function action_saveJobStatus(params) {
  const session = requireRole(params, EMPLOYEE_ROLES);
  const data = params.data || {};
  requireFields(data, ['Student ID', 'Job Status']);
  validateJobStatusValue(data['Job Status']);

  const student = getStudentById(data['Student ID']);
  if (!student) throw new AppError('NOT_FOUND', `No student found with ID ${data['Student ID']}.`);

  const now = nowIso();
  const row = {
    _row: counters.jobRow++,
    'Student ID': student['Student ID'], 'Student Name': student['Student Name'],
    'Office Joining Date': data['Office Joining Date'] || '', 'Job Status': data['Job Status'],
    'Course': student['Course'], 'Organization': data['Organization'] || '',
    'Job Joining Date': data['Job Joining Date'] || '', 'CreatedAt': now, 'UpdatedAt': now
  };
  db.jobs.push(row);
  logChange('jobs', { recordKey: row._row, studentId: row['Student ID'], action: 'INSERT', session, after: row });
  return row;
}

function action_updateJobStatus(params) {
  const session = requireRole(params, EMPLOYEE_ROLES);
  const data = params.data || {};
  requireFields(data, ['_row', 'Job Status']);
  validateJobStatusValue(data['Job Status']);

  const job = db.jobs.find(j => j._row === Number(data['_row']));
  if (!job) throw new AppError('NOT_FOUND', 'Job status record not found.');

  const before = JSON.parse(JSON.stringify(job));
  Object.assign(job, {
    'Office Joining Date': data['Office Joining Date'] || '', 'Job Status': data['Job Status'],
    'Organization': data['Organization'] || '', 'Job Joining Date': data['Job Joining Date'] || '',
    'UpdatedAt': nowIso()
  });
  logChange('jobs', { recordKey: job._row, studentId: job['Student ID'], action: 'UPDATE', session, before, after: job });
  return job;
}

function action_deleteJobStatus(params) {
  const session = requireRole(params, EMPLOYEE_ROLES);
  const rowIndex = Number(params.data && params.data['_row']);
  const idx = db.jobs.findIndex(j => j._row === rowIndex);
  if (idx === -1) throw new AppError('NOT_FOUND', 'Job status record not found.');
  const before = db.jobs[idx];
  db.jobs.splice(idx, 1);
  logChange('jobs', { recordKey: before._row, studentId: before['Student ID'], action: 'DELETE', session, before });
  return { deleted: true };
}

/* ---------------- Documents (Module 4) ---------------- */

function action_getDocuments(params) {
  requireSession(params);
  return paginateAndSort(db.documents, {
    search: params.search, searchFields: ['Student ID', 'Student Name', 'Organization Name', 'Employee Role', 'Given By'],
    filterFn: buildDateCourseFilter(params, 'Processed Date'),
    sortBy: params.sortBy || 'CreatedAt', sortDir: params.sortDir || 'desc', page: params.page, pageSize: params.pageSize
  });
}

function action_saveDocument(params) {
  const session = requireRole(params, EMPLOYEE_ROLES);
  const data = params.data || {};
  requireFields(data, ['Student ID', 'Organization Name']);
  const years = parseYears(data['No of Years']);
  validateDocumentDates(data['Doc Start Date'], data['Doc End Date']);

  const student = getStudentById(data['Student ID']);
  if (!student) throw new AppError('NOT_FOUND', `No student found with ID ${data['Student ID']}.`);

  const now = nowIso();
  const row = {
    _row: counters.documentRow++,
    'Student ID': student['Student ID'], 'Student Name': student['Student Name'],
    'Organization Name': data['Organization Name'], 'No of Years': years,
    'Employee Role': data['Employee Role'] || '',
    'Doc Start Date': data['Doc Start Date'] || '', 'Doc End Date': data['Doc End Date'] || '',
    'Form 16': toBool(data['Form 16']), 'PF': toBool(data['PF']),
    'Processed Date': todayISO(), // stamped server-side, never taken from the client
    'Given By': data['Given By'] || '', 'CreatedAt': now, 'UpdatedAt': now
  };
  db.documents.push(row);
  logChange('documents', { recordKey: row._row, studentId: row['Student ID'], action: 'INSERT', session, after: row });
  return row;
}

function action_updateDocument(params) {
  const session = requireRole(params, EMPLOYEE_ROLES);
  const data = params.data || {};
  requireFields(data, ['_row', 'Organization Name']);
  const years = parseYears(data['No of Years']);
  validateDocumentDates(data['Doc Start Date'], data['Doc End Date']);

  const doc = db.documents.find(d => d._row === Number(data['_row']));
  if (!doc) throw new AppError('NOT_FOUND', 'Document record not found.');

  const before = JSON.parse(JSON.stringify(doc));
  // 'Processed Date' is deliberately left alone — it records when the
  // documents were first processed, not when the row was last edited.
  Object.assign(doc, {
    'Organization Name': data['Organization Name'], 'No of Years': years,
    'Employee Role': data['Employee Role'] || '',
    'Doc Start Date': data['Doc Start Date'] || '', 'Doc End Date': data['Doc End Date'] || '',
    'Form 16': toBool(data['Form 16']), 'PF': toBool(data['PF']),
    'Given By': data['Given By'] || '', 'UpdatedAt': nowIso()
  });
  logChange('documents', { recordKey: doc._row, studentId: doc['Student ID'], action: 'UPDATE', session, before, after: doc });
  return doc;
}

function action_deleteDocument(params) {
  const session = requireRole(params, EMPLOYEE_ROLES);
  const rowIndex = Number(params.data && params.data['_row']);
  const idx = db.documents.findIndex(d => d._row === rowIndex);
  if (idx === -1) throw new AppError('NOT_FOUND', 'Document record not found.');
  const before = db.documents[idx];
  db.documents.splice(idx, 1);
  logChange('documents', { recordKey: before._row, studentId: before['Student ID'], action: 'DELETE', session, before });
  return { deleted: true };
}

/* ---------------- Payments (Module 3) ---------------- */

function validatePaymentMethod(method) {
  if (!PAYMENT_METHODS.includes(method)) throw new AppError('VALIDATION_ERROR', 'Invalid payment method.');
}

function validatePaymentType(type) {
  if (!PAYMENT_TYPES.includes(type)) throw new AppError('VALIDATION_ERROR', 'Invalid payment type.');
}

/**
 * Returns the paid-so-far sum (excluding excludeRow, for edits), the row
 * count (for the next installment number), the student's first installment
 * — the one whose Payment Type governs the rest — and that governing type,
 * skipping rows saved before the field existed (blank ones).
 */
function sumPaymentsForStudent(studentId, excludeRow) {
  const matches = db.payments.filter(p => p['Student ID'] === studentId);
  const sum = matches
    .filter(p => p._row !== excludeRow)
    .reduce((total, p) => total + (Number(p['Payment Received']) || 0), 0);

  const inOrder = matches.slice().sort((a, b) =>
    (Number(a['Installment No']) || 0) - (Number(b['Installment No']) || 0) || a._row - b._row);
  const governing = inOrder.find(p => !isBlank(p['Payment Type']));

  return {
    sum: round2(sum),
    count: matches.length,
    firstRow: inOrder.length ? inOrder[0]._row : null,
    inheritedType: governing ? governing['Payment Type'] : ''
  };
}

/**
 * Payment Type is a property of the student, not of the individual payment:
 * it is chosen on their first installment and every later one inherits it.
 * So the client's value is honoured only when there is nothing to inherit —
 * a brand-new student, or one whose payments all predate the field.
 */
function resolvePaymentType(inheritedType, requestedType) {
  if (!isBlank(inheritedType)) return inheritedType;
  requireFields({ 'Payment Type': requestedType }, ['Payment Type']);
  validatePaymentType(requestedType);
  return requestedType;
}

/** Applies one Payment Type to every payment a student has, so later installments never drift from the first one. */
function syncPaymentTypeForStudent(studentId, paymentType) {
  db.payments.forEach(p => { if (p['Student ID'] === studentId) p['Payment Type'] = paymentType; });
}

function action_getPayments(params) {
  requireAdmin(params); // Payments is an admin-only section — employees have no access at all
  const rows = params.latestOnly ? Object.values(latestPerStudent(db.payments)) : db.payments;
  return paginateAndSort(rows, {
    search: params.search, searchFields: ['Payment ID', 'Student ID', 'Student Name', 'Payment Method', 'Payment Type'],
    filterFn: buildDateCourseFilter(params, 'Payment Date'),
    sortBy: params.sortBy || 'CreatedAt', sortDir: params.sortDir || 'desc', page: params.page, pageSize: params.pageSize
  });
}

function action_savePayment(params) {
  const session = requireAdmin(params);
  const data = params.data || {};
  requireFields(data, ['Student ID', 'Total Course Fee', 'Payment Received', 'Payment Method']);
  validatePaymentMethod(data['Payment Method']);
  // Payment Type is only read from the client for a student's first payment;
  // later installments inherit it — see resolvePaymentType above.

  const totalFee = Number(data['Total Course Fee']);
  const received = Number(data['Payment Received']);
  if (isNaN(totalFee) || totalFee < 0) throw new AppError('VALIDATION_ERROR', 'Total Course Fee must be a positive number.');
  if (isNaN(received) || received <= 0) throw new AppError('VALIDATION_ERROR', 'Payment Received must be greater than zero.');

  const student = getStudentById(data['Student ID']);
  if (!student) throw new AppError('NOT_FOUND', `No student found with ID ${data['Student ID']}.`);

  const { sum: existingSum, count: existingCount, inheritedType } = sumPaymentsForStudent(data['Student ID'], null);
  const paymentType = resolvePaymentType(inheritedType, data['Payment Type']);
  const pending = round2(totalFee - (existingSum + received));
  if (pending < 0) throw new AppError('OVERPAYMENT', `This payment exceeds the pending amount. Maximum allowed right now: ${round2(totalFee - existingSum)}.`);

  const row = {
    _row: counters.paymentRow++,
    'Payment ID': 'PMT' + String(++counters.paymentSeq).padStart(6, '0'),
    'Student ID': student['Student ID'], 'Student Name': student['Student Name'], 'Course': student['Course'],
    'Installment No': existingCount + 1,
    'Job Offer Date': data['Job Offer Date'] || '', 'Total Course Fee': totalFee,
    'Payment Received': received, 'Payment Method': data['Payment Method'],
    'Payment Type': paymentType,
    'Pending Amount': pending, 'Payment Date': data['Payment Date'] || todayISO(),
    'CreatedAt': nowIso()
  };
  db.payments.push(row);
  logChange('payments', { recordKey: row['Payment ID'], studentId: row['Student ID'], action: 'INSERT', session, after: row });
  return row;
}

function action_updatePayment(params) {
  const session = requireAdmin(params);
  const data = params.data || {};
  requireFields(data, ['_row', 'Total Course Fee', 'Payment Received', 'Payment Method']);
  validatePaymentMethod(data['Payment Method']);
  // Payment Type is editable on the first installment only — see below.

  const totalFee = Number(data['Total Course Fee']);
  const received = Number(data['Payment Received']);
  if (isNaN(totalFee) || totalFee < 0) throw new AppError('VALIDATION_ERROR', 'Total Course Fee must be a positive number.');
  if (isNaN(received) || received <= 0) throw new AppError('VALIDATION_ERROR', 'Payment Received must be greater than zero.');

  const payment = db.payments.find(p => p._row === Number(data['_row']));
  if (!payment) throw new AppError('NOT_FOUND', 'Payment record not found.');

  const { sum: otherSum, firstRow } = sumPaymentsForStudent(payment['Student ID'], payment._row);
  const isFirstInstallment = firstRow === payment._row;
  const pending = round2(totalFee - (otherSum + received));
  if (pending < 0) throw new AppError('OVERPAYMENT', `This payment exceeds the pending amount. Maximum allowed right now: ${round2(totalFee - otherSum)}.`);

  const before = JSON.parse(JSON.stringify(payment));
  Object.assign(payment, {
    'Job Offer Date': data['Job Offer Date'] || '', 'Total Course Fee': totalFee,
    'Payment Received': received, 'Payment Method': data['Payment Method'],
    'Pending Amount': pending, 'Payment Date': data['Payment Date'] || todayISO()
  });
  // Editing a later installment leaves its type alone (it is inherited);
  // editing the first one re-types every installment so they stay in step.
  if (isFirstInstallment) {
    requireFields(data, ['Payment Type']);
    validatePaymentType(data['Payment Type']);
    syncPaymentTypeForStudent(payment['Student ID'], data['Payment Type']);
  }
  logChange('payments', { recordKey: payment['Payment ID'], studentId: payment['Student ID'], action: 'UPDATE', session, before, after: payment });
  return payment;
}

function action_deletePayment(params) {
  const session = requireAdmin(params);
  const rowIndex = Number(params.data && params.data['_row']);
  const idx = db.payments.findIndex(p => p._row === rowIndex);
  if (idx === -1) throw new AppError('NOT_FOUND', 'Payment record not found.');
  const before = db.payments[idx];
  db.payments.splice(idx, 1);
  logChange('payments', { recordKey: before['Payment ID'], studentId: before['Student ID'], action: 'DELETE', session, before });
  return { deleted: true };
}

/* ---------------- Dashboard ---------------- */

function action_dashboardStats(params) {
  requireSession(params);
  const students = db.students, jobs = db.jobs, payments = db.payments;
  const today = todayISO();
  const thisMonth = monthKey(today);

  const todaysEnquiries = students.filter(s => s['Enquiry Date'] === today).length;
  const newEnquiries = students.filter(s => monthKey(s['Enquiry Date']) === thisMonth).length;

  const latestJobByStudent = latestPerStudent(jobs);
  const placedStatuses = ['Selected', 'Offer Received', 'Joined'];
  let studentsJoined = 0, studentsPlaced = 0, rejected = 0;
  const placementCounts = {};
  JOB_STATUS_OPTIONS.forEach(s => (placementCounts[s] = 0));
  Object.values(latestJobByStudent).forEach(job => {
    const status = job['Job Status'];
    if (status in placementCounts) placementCounts[status]++;
    if (status === 'Joined') studentsJoined++;
    if (placedStatuses.includes(status)) studentsPlaced++;
    if (status === 'Rejected') rejected++;
  });
  const pendingPlacements = Math.max(0, students.length - studentsPlaced - rejected);

  let totalPayments = 0;
  const paymentsByStudent = {};
  payments.forEach(p => {
    totalPayments += Number(p['Payment Received']) || 0;
    const id = p['Student ID'];
    if (!paymentsByStudent[id]) paymentsByStudent[id] = { received: 0, fee: 0, lastCreated: '' };
    paymentsByStudent[id].received += Number(p['Payment Received']) || 0;
    if (String(p['CreatedAt']) >= String(paymentsByStudent[id].lastCreated)) {
      paymentsByStudent[id].fee = Number(p['Total Course Fee']) || 0;
      paymentsByStudent[id].lastCreated = p['CreatedAt'];
    }
  });
  let pendingPayments = 0;
  Object.values(paymentsByStudent).forEach(rec => { pendingPayments += Math.max(0, round2(rec.fee - rec.received)); });

  const activities = [];
  students.forEach(s => activities.push({ type: 'Enquiry', icon: 'fa-user-plus', text: `New enquiry from ${s['Student Name']} (${s['Student ID']})`, at: s['CreatedAt'] || s['Enquiry Date'] }));
  jobs.forEach(j => activities.push({ type: 'Job Status', icon: 'fa-briefcase', text: `${j['Student Name']} (${j['Student ID']}) marked as ${j['Job Status']}`, at: j['UpdatedAt'] || j['CreatedAt'] }));
  payments.forEach(p => activities.push({ type: 'Payment', icon: 'fa-indian-rupee-sign', text: `${p['Student Name']} (${p['Student ID']}) paid ${p['Payment Received']} via ${p['Payment Method']}`, at: p['CreatedAt'] }));
  activities.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return {
    totalStudents: students.length, newEnquiries, studentsJoined, studentsPlaced, pendingPlacements,
    totalPayments: round2(totalPayments), pendingPayments: round2(pendingPayments), todaysEnquiries,
    recentActivities: activities.slice(0, 15),
    monthlyAdmissions: monthlySeries(students, 'Enquiry Date', null),
    monthlyRevenue: monthlySeries(payments, 'Payment Date', 'Payment Received'),
    placementStatistics: placementCounts
  };
}

/* ---------------- Reports ---------------- */

function action_reports(params) {
  requireSession(params);
  const filters = params.data || {};
  const latestJob = latestPerStudent(db.jobs);
  const paymentAgg = {};
  db.payments.forEach(p => {
    const id = p['Student ID'];
    if (!paymentAgg[id]) paymentAgg[id] = { received: 0, fee: 0, lastDate: '', lastCreated: '' };
    paymentAgg[id].received += Number(p['Payment Received']) || 0;
    if (String(p['CreatedAt']) >= String(paymentAgg[id].lastCreated)) {
      paymentAgg[id].fee = Number(p['Total Course Fee']) || 0;
      paymentAgg[id].lastCreated = p['CreatedAt'];
    }
    if (String(p['Payment Date']) >= String(paymentAgg[id].lastDate)) paymentAgg[id].lastDate = p['Payment Date'];
  });

  let rows = db.students.map(s => {
    const job = latestJob[s['Student ID']] || {};
    const pay = paymentAgg[s['Student ID']] || { received: 0, fee: 0, lastDate: '' };
    const pending = round2(Math.max(0, pay.fee - pay.received));
    let paymentStatus = 'No Payment';
    if (pay.fee > 0 || pay.received > 0) {
      if (pending <= 0 && pay.received > 0) paymentStatus = 'Paid';
      else if (pay.received > 0) paymentStatus = 'Partial';
      else paymentStatus = 'Pending';
    }
    return {
      'Student ID': s['Student ID'], 'Student Name': s['Student Name'], 'Enquiry Date': s['Enquiry Date'],
      'Course': s['Course'], 'Mobile Number': s['Mobile Number'], 'Gmail': s['Gmail'],
      'Job Status': job['Job Status'] || 'Pending', 'Organization': job['Organization'] || '',
      'Total Course Fee': pay.fee, 'Payment Received': round2(pay.received), 'Pending Amount': pending,
      'Payment Status': paymentStatus, 'Last Payment Date': pay.lastDate || ''
    };
  });

  if (filters.dateFrom) rows = rows.filter(r => r['Enquiry Date'] >= filters.dateFrom);
  if (filters.dateTo) rows = rows.filter(r => r['Enquiry Date'] <= filters.dateTo);
  if (filters.course) rows = rows.filter(r => r['Course'] === filters.course);
  if (filters.jobStatus) rows = rows.filter(r => r['Job Status'] === filters.jobStatus);
  if (filters.paymentStatus) rows = rows.filter(r => r['Payment Status'] === filters.paymentStatus);
  if (filters.organization) {
    const org = String(filters.organization).toLowerCase();
    rows = rows.filter(r => String(r['Organization']).toLowerCase().includes(org));
  }

  return { rows, total: rows.length };
}

/* ---------------- Seed data (for a populated dashboard on first run) ---------------- */

function seed() {
  const courses = COURSE_OPTIONS;
  const orgs = ['Infosys', 'TCS', 'Wipro', 'Accenture', 'Cognizant'];
  const empRoles = ['Software Engineer', 'Data Analyst', 'Support Engineer', 'Test Engineer', 'Associate Consultant'];
  const names = ['Aarav Sharma', 'Diya Patel', 'Vihaan Reddy', 'Ananya Iyer', 'Kabir Singh', 'Ishita Nair', 'Reyansh Rao', 'Myra Gupta', 'Aditya Kumar', 'Saanvi Joshi', 'Arjun Mehta', 'Kiara Verma'];

  names.forEach((name, i) => {
    const monthsAgo = i % 6;
    const d = new Date();
    d.setMonth(d.getMonth() - monthsAgo);
    d.setDate(1 + (i % 25));
    const enquiryDate = d.toISOString().slice(0, 10);
    const createdAt = d.toISOString();

    const student = {
      'Student ID': generateStudentId(),
      'Student Name': name,
      'Enquiry Date': enquiryDate,
      'Course': courses[i % courses.length],
      'Qualification': QUALIFICATION_OPTIONS[i % QUALIFICATION_OPTIONS.length],
      'Referred By': i % 3 === 0 ? 'Friend' : '',
      'Gmail': name.toLowerCase().replace(/\s+/g, '.') + '@example.com',
      'Mobile Number': '9' + String(100000000 + i * 7654321).slice(0, 9),
      'CreatedAt': createdAt, 'UpdatedAt': createdAt
    };
    db.students.push(student);

    if (i % 4 !== 3) {
      const statuses = ['Training', 'Interview Scheduled', 'Interview Cleared', 'Selected', 'Offer Received', 'Joined', 'Rejected', 'Pending'];
      db.jobs.push({
        _row: counters.jobRow++,
        'Student ID': student['Student ID'], 'Student Name': student['Student Name'],
        'Office Joining Date': '', 'Job Status': statuses[i % statuses.length],
        'Course': student['Course'], 'Organization': orgs[i % orgs.length],
        'Job Joining Date': '', 'CreatedAt': createdAt, 'UpdatedAt': createdAt
      });
    }

    // Experienced joiners (roughly every other seeded student) arrive with
    // previous-employment documents; freshers have none.
    if (i % 2 === 0) {
      const startYear = 2018 + (i % 4);
      const years = 1 + (i % 5) * 0.5;
      db.documents.push({
        _row: counters.documentRow++,
        'Student ID': student['Student ID'], 'Student Name': student['Student Name'],
        'Organization Name': orgs[(i + 2) % orgs.length], 'No of Years': years,
        'Employee Role': empRoles[i % empRoles.length],
        'Doc Start Date': `${startYear}-04-01`,
        'Doc End Date': `${startYear + Math.ceil(years)}-03-31`,
        'Form 16': i % 3 !== 1, 'PF': i % 4 !== 1,
        'Processed Date': enquiryDate,
        'Given By': i % 2 === 0 ? 'Student' : 'HR', 'CreatedAt': createdAt, 'UpdatedAt': createdAt
      });
    }

    if (i % 3 !== 2) {
      const fee = 40000 + (i % 4) * 10000;
      const received = i % 5 === 0 ? fee : Math.round(fee * (0.4 + (i % 3) * 0.2));
      db.payments.push({
        _row: counters.paymentRow++,
        'Payment ID': 'PMT' + String(++counters.paymentSeq).padStart(6, '0'),
        'Student ID': student['Student ID'], 'Student Name': student['Student Name'], 'Course': student['Course'],
        'Installment No': 1,
        'Job Offer Date': '', 'Total Course Fee': fee, 'Payment Received': received,
        'Payment Method': PAYMENT_METHODS[i % PAYMENT_METHODS.length],
        'Payment Type': PAYMENT_TYPES[i % PAYMENT_TYPES.length],
        'Pending Amount': round2(fee - received), 'Payment Date': enquiryDate, 'CreatedAt': createdAt
      });
    }
  });
}

seed();

/* ---------------- HTTP server ---------------- */

const ACTIONS = {
  login: action_login, logout: action_logout,
  generateStudentID: action_generateStudentID,
  getStudents: action_getStudents, addStudent: action_addStudent, updateStudent: action_updateStudent,
  deleteStudent: action_deleteStudent, searchStudent: action_searchStudent,
  getJobStatus: action_getJobStatus, saveJobStatus: action_saveJobStatus, updateJobStatus: action_updateJobStatus, deleteJobStatus: action_deleteJobStatus,
  getDocuments: action_getDocuments, saveDocument: action_saveDocument, updateDocument: action_updateDocument, deleteDocument: action_deleteDocument,
  getPayments: action_getPayments, savePayment: action_savePayment, updatePayment: action_updatePayment, deletePayment: action_deletePayment,
  dashboardStats: action_dashboardStats, reports: action_reports,
  listUsers: action_listUsers, addUser: action_addUser, updateUser: action_updateUser, deleteUser: action_deleteUser,
  getAuditLog: action_getAuditLog
};

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 200, {});

  if (req.method === 'GET') {
    return send(res, 200, { success: true, message: 'NDR EDTECH mock API is running.' });
  }

  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', () => {
    let params = {};
    try { params = body ? JSON.parse(body) : {}; } catch { params = {}; }

    const action = params.action;
    if (!action || !ACTIONS[action]) {
      return send(res, 200, { success: false, error: { code: 'UNKNOWN_ACTION', message: 'Unknown action: ' + action } });
    }
    try {
      const data = ACTIONS[action](params);
      send(res, 200, { success: true, data: data === undefined ? null : data });
    } catch (err) {
      send(res, 200, { success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Something went wrong.' } });
    }
  });
});

server.listen(PORT, () => {
  console.log(`NDR EDTECH mock API running at http://localhost:${PORT}`);
  console.log(`Login with username: ${ADMIN_USERNAME}  password: ${ADMIN_PASSWORD}`);
});
