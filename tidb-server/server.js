/**
 * tidb-server/server.js
 * Production REST API for the NDR EDTECH Student Portal, backed by TiDB.
 * Same action names, same request/response envelope, same validation
 * rules as apps-script/*.gs and mock-server/server.js — this is the drop-in
 * replacement for the Google Apps Script Web App once you point js/api.js
 * at its deployed URL. See tidb-server/README.md for setup + deploy.
 *
 * Run:        npm start          (needs a reachable TiDB — see .env.example)
 * One-time:   npm run setup      (creates tables + the admin login)
 */

const crypto = require('crypto');
const express = require('express');

const store = require('./store');
const {
  AppError, JOB_STATUS_OPTIONS, PAYMENT_METHODS, COURSE_OPTIONS,
  todayISO, nowIso, round2, monthKey, requireFields, isValidEmail, isValidMobile,
  validateCourseValue, validateQualificationValue, validateJobStatusValue, validatePaymentMethod,
  buildDateCourseFilter, paginateAndSort, monthlySeries, latestPerStudent, hashPassword, isBlank
} = require('./logic');

const PORT = Number(process.env.PORT || 4001);
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

/* ---------------- Auth ---------------- */

async function action_login(params) {
  requireFields(params, ['username', 'password']);
  const username = String(params.username).trim();
  const password = String(params.password);

  const user = await store.findUserByUsername(username);
  if (!user || hashPassword(password, user.salt) !== user.password_hash) {
    throw new AppError('INVALID_CREDENTIALS', 'Invalid username or password.');
  }

  const token = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await store.createSession(token, username, user.role, expiresAt);
  return { token, username, role: user.role, expiresAt };
}

async function action_logout(params) {
  if (params.token) await store.deleteSession(params.token);
  return { loggedOut: true };
}

async function requireSession(params) {
  const session = params.token && await store.getSession(params.token);
  if (!session || Number(session.expires_at) < Date.now()) {
    if (session) await store.deleteSession(params.token);
    throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please log in again.');
  }
  return session;
}

async function requireAdmin(params) {
  const session = await requireSession(params);
  if (session.role !== 'admin') throw new AppError('FORBIDDEN', 'Your account does not have permission to make changes.');
  return session;
}

/** Like requireAdmin, but also allows the given extra role(s) through (e.g. 'hr' for create-only actions). */
async function requireRole(params, allowedRoles) {
  const session = await requireSession(params);
  if (session.role === 'admin' || allowedRoles.includes(session.role)) return session;
  throw new AppError('FORBIDDEN', 'Your account does not have permission to make changes.');
}

/* ---------------- Students (Module 1) ---------------- */

async function action_generateStudentID() {
  const studentId = await store.withTransaction(conn => store.generateStudentId(conn));
  return { studentId };
}

async function action_getStudents(params) {
  await requireSession(params);
  const rows = await store.loadStudents();
  return paginateAndSort(rows, {
    search: params.search, searchFields: ['Student ID', 'Student Name', 'Mobile Number', 'Gmail'],
    filterFn: buildDateCourseFilter(params, 'Enquiry Date'),
    sortBy: params.sortBy || 'CreatedAt', sortDir: params.sortDir || 'desc', page: params.page, pageSize: params.pageSize
  });
}

async function action_searchStudent(params) {
  await requireSession(params);
  const rows = await store.loadStudents();
  const query = String(params.query || '').trim().toLowerCase();
  if (!query) return { rows: rows.slice(0, 20) };
  const matches = rows.filter(row =>
    ['Student ID', 'Student Name', 'Mobile Number', 'Gmail'].some(f => String(row[f] || '').toLowerCase().includes(query))
  );
  return { rows: matches.slice(0, 20) };
}

async function action_addStudent(params) {
  await requireRole(params, ['hr']);
  const data = params.data || {};
  requireFields(data, ['Student Name', 'Course', 'Gmail', 'Mobile Number']);
  if (!isValidEmail(data['Gmail'])) throw new AppError('VALIDATION_ERROR', 'Please enter a valid email address.');
  if (!isValidMobile(data['Mobile Number'])) throw new AppError('VALIDATION_ERROR', 'Please enter a valid 10-digit mobile number.');
  validateCourseValue(data['Course']);
  validateQualificationValue(data['Qualification']);

  return store.withTransaction(async conn => {
    await store.assertNoDuplicateStudent(conn, data, null);
    const now = nowIso();
    const row = {
      'Student ID': await store.generateStudentId(conn),
      'Student Name': String(data['Student Name']).trim(),
      'Enquiry Date': data['Enquiry Date'] || todayISO(),
      'Course': data['Course'],
      'Qualification': data['Qualification'] || '',
      'Referred By': data['Referred By'] || '',
      'Gmail': String(data['Gmail']).trim().toLowerCase(),
      'Mobile Number': String(data['Mobile Number']).trim(),
      'CreatedAt': now, 'UpdatedAt': now
    };
    return store.insertStudent(conn, row);
  }).catch(rethrowDuplicateKey);
}

async function action_updateStudent(params) {
  await requireAdmin(params);
  const data = params.data || {};
  requireFields(data, ['Student ID', 'Student Name', 'Course', 'Gmail', 'Mobile Number']);
  if (!isValidEmail(data['Gmail'])) throw new AppError('VALIDATION_ERROR', 'Please enter a valid email address.');
  if (!isValidMobile(data['Mobile Number'])) throw new AppError('VALIDATION_ERROR', 'Please enter a valid 10-digit mobile number.');
  validateCourseValue(data['Course']);
  validateQualificationValue(data['Qualification']);

  return store.withTransaction(async conn => {
    const existing = await store.findStudentById(data['Student ID'], conn);
    if (!existing) throw new AppError('NOT_FOUND', 'Student not found.');
    await store.assertNoDuplicateStudent(conn, data, data['Student ID']);

    const update = {
      'Student Name': String(data['Student Name']).trim(),
      'Enquiry Date': data['Enquiry Date'],
      'Course': data['Course'],
      'Qualification': data['Qualification'] || '',
      'Referred By': data['Referred By'] || '',
      'Gmail': String(data['Gmail']).trim().toLowerCase(),
      'Mobile Number': String(data['Mobile Number']).trim(),
      'UpdatedAt': nowIso()
    };
    await store.updateStudentRow(conn, data['Student ID'], update);
    await store.syncStudentNameEverywhere(conn, data['Student ID'], update['Student Name'], update['Course']);
    return Object.assign({ 'Student ID': data['Student ID'] }, update);
  }).catch(rethrowDuplicateKey);
}

async function action_deleteStudent(params) {
  await requireAdmin(params);
  const studentId = params.data && params.data['Student ID'];
  if (isBlank(studentId)) throw new AppError('VALIDATION_ERROR', 'Student ID is required.');
  const affected = await store.deleteStudentRow(studentId);
  if (!affected) throw new AppError('NOT_FOUND', 'Student not found.');
  return { deleted: true, studentId };
}

/* ---------------- Job Status (Module 2) ---------------- */

async function action_getJobStatus(params) {
  await requireSession(params);
  const rows = await store.loadJobs();
  return paginateAndSort(rows, {
    search: params.search, searchFields: ['Student ID', 'Student Name', 'Organization', 'Job Status'],
    filterFn: buildDateCourseFilter(params, 'Office Joining Date'),
    sortBy: params.sortBy || 'CreatedAt', sortDir: params.sortDir || 'desc', page: params.page, pageSize: params.pageSize
  });
}

async function action_saveJobStatus(params) {
  await requireRole(params, ['hr']);
  const data = params.data || {};
  requireFields(data, ['Student ID', 'Job Status']);
  validateJobStatusValue(data['Job Status']);

  return store.withTransaction(async conn => {
    const student = await store.findStudentById(data['Student ID'], conn);
    if (!student) throw new AppError('NOT_FOUND', `No student found with ID ${data['Student ID']}.`);

    const now = nowIso();
    const row = {
      'Student ID': student['Student ID'], 'Student Name': student['Student Name'],
      'Office Joining Date': data['Office Joining Date'] || '', 'Job Status': data['Job Status'],
      'Course': student['Course'], 'Organization': data['Organization'] || '',
      'Job Joining Date': data['Job Joining Date'] || '', 'CreatedAt': now, 'UpdatedAt': now
    };
    return store.insertJob(conn, row);
  });
}

async function action_updateJobStatus(params) {
  await requireAdmin(params);
  const data = params.data || {};
  requireFields(data, ['_row', 'Job Status']);
  validateJobStatusValue(data['Job Status']);

  const update = {
    'Office Joining Date': data['Office Joining Date'] || '', 'Job Status': data['Job Status'],
    'Organization': data['Organization'] || '', 'Job Joining Date': data['Job Joining Date'] || '',
    'UpdatedAt': nowIso()
  };
  const affected = await store.withTransaction(conn => store.updateJobRow(conn, Number(data['_row']), update));
  if (!affected) throw new AppError('NOT_FOUND', 'Job status record not found.');
  return update;
}

async function action_deleteJobStatus(params) {
  await requireAdmin(params);
  const rowId = Number(params.data && params.data['_row']);
  const affected = await store.deleteJobRow(rowId);
  if (!affected) throw new AppError('NOT_FOUND', 'Job status record not found.');
  return { deleted: true };
}

/* ---------------- Payments (Module 3) ---------------- */

async function action_getPayments(params) {
  await requireSession(params);
  let rows = await store.loadPayments();
  if (params.latestOnly) rows = Object.values(latestPerStudent(rows));
  return paginateAndSort(rows, {
    search: params.search, searchFields: ['Payment ID', 'Student ID', 'Student Name', 'Payment Method'],
    filterFn: buildDateCourseFilter(params, 'Payment Date'),
    sortBy: params.sortBy || 'CreatedAt', sortDir: params.sortDir || 'desc', page: params.page, pageSize: params.pageSize
  });
}

async function action_savePayment(params) {
  await requireAdmin(params);
  const data = params.data || {};
  requireFields(data, ['Student ID', 'Total Course Fee', 'Payment Received', 'Payment Method']);
  validatePaymentMethod(data['Payment Method']);

  const totalFee = Number(data['Total Course Fee']);
  const received = Number(data['Payment Received']);
  if (isNaN(totalFee) || totalFee < 0) throw new AppError('VALIDATION_ERROR', 'Total Course Fee must be a positive number.');
  if (isNaN(received) || received <= 0) throw new AppError('VALIDATION_ERROR', 'Payment Received must be greater than zero.');

  return store.withTransaction(async conn => {
    const student = await store.findStudentById(data['Student ID'], conn);
    if (!student) throw new AppError('NOT_FOUND', `No student found with ID ${data['Student ID']}.`);

    const { sum: existingSum, count: existingCount } = await store.sumPaymentsForStudent(conn, data['Student ID'], null);
    const pending = round2(totalFee - (existingSum + received));
    if (pending < 0) throw new AppError('OVERPAYMENT', `This payment exceeds the pending amount. Maximum allowed right now: ${round2(totalFee - existingSum)}.`);

    const row = {
      'Payment ID': await store.nextPaymentId(conn),
      'Student ID': student['Student ID'], 'Student Name': student['Student Name'], 'Course': student['Course'],
      'Installment No': existingCount + 1,
      'Job Offer Date': data['Job Offer Date'] || '', 'Total Course Fee': totalFee,
      'Payment Received': received, 'Payment Method': data['Payment Method'],
      'Pending Amount': pending, 'Payment Date': data['Payment Date'] || todayISO(),
      'CreatedAt': nowIso()
    };
    return store.insertPayment(conn, row);
  });
}

async function action_updatePayment(params) {
  await requireAdmin(params);
  const data = params.data || {};
  requireFields(data, ['_row', 'Total Course Fee', 'Payment Received', 'Payment Method']);
  validatePaymentMethod(data['Payment Method']);

  const totalFee = Number(data['Total Course Fee']);
  const received = Number(data['Payment Received']);
  if (isNaN(totalFee) || totalFee < 0) throw new AppError('VALIDATION_ERROR', 'Total Course Fee must be a positive number.');
  if (isNaN(received) || received <= 0) throw new AppError('VALIDATION_ERROR', 'Payment Received must be greater than zero.');

  const rowId = Number(data['_row']);
  return store.withTransaction(async conn => {
    const studentId = await store.getStudentIdForPaymentRow(conn, rowId);
    if (!studentId) throw new AppError('NOT_FOUND', 'Payment record not found.');

    const { sum: otherSum } = await store.sumPaymentsForStudent(conn, studentId, rowId);
    const pending = round2(totalFee - (otherSum + received));
    if (pending < 0) throw new AppError('OVERPAYMENT', `This payment exceeds the pending amount. Maximum allowed right now: ${round2(totalFee - otherSum)}.`);

    const update = {
      'Job Offer Date': data['Job Offer Date'] || '', 'Total Course Fee': totalFee,
      'Payment Received': received, 'Payment Method': data['Payment Method'],
      'Pending Amount': pending, 'Payment Date': data['Payment Date'] || todayISO()
    };
    await store.updatePaymentRow(conn, rowId, update);
    return update;
  });
}

async function action_deletePayment(params) {
  await requireAdmin(params);
  const rowId = Number(params.data && params.data['_row']);
  const affected = await store.deletePaymentRow(rowId);
  if (!affected) throw new AppError('NOT_FOUND', 'Payment record not found.');
  return { deleted: true };
}

/* ---------------- Dashboard ---------------- */

async function action_dashboardStats(params) {
  await requireSession(params);
  const [students, jobs, payments] = await Promise.all([store.loadStudents(), store.loadJobs(), store.loadPayments()]);
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

async function action_reports(params) {
  await requireSession(params);
  const filters = params.data || {};
  const [students, jobs, payments] = await Promise.all([store.loadStudents(), store.loadJobs(), store.loadPayments()]);

  const latestJob = latestPerStudent(jobs);
  const paymentAgg = {};
  payments.forEach(p => {
    const id = p['Student ID'];
    if (!paymentAgg[id]) paymentAgg[id] = { received: 0, fee: 0, lastDate: '', lastCreated: '' };
    paymentAgg[id].received += Number(p['Payment Received']) || 0;
    if (String(p['CreatedAt']) >= String(paymentAgg[id].lastCreated)) {
      paymentAgg[id].fee = Number(p['Total Course Fee']) || 0;
      paymentAgg[id].lastCreated = p['CreatedAt'];
    }
    if (String(p['Payment Date']) >= String(paymentAgg[id].lastDate)) paymentAgg[id].lastDate = p['Payment Date'];
  });

  let rows = students.map(s => {
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

/** A unique-key violation slipping past the app-level dupe check (a genuine race) surfaces as the same DUPLICATE_MOBILE/DUPLICATE_EMAIL error instead of a raw SQL error. */
function rethrowDuplicateKey(err) {
  if (err && err.code === 'ER_DUP_ENTRY') {
    if (String(err.sqlMessage || '').includes('uq_students_mobile')) throw new AppError('DUPLICATE_MOBILE', 'A student with this mobile number already exists.');
    if (String(err.sqlMessage || '').includes('uq_students_gmail')) throw new AppError('DUPLICATE_EMAIL', 'A student with this email already exists.');
  }
  throw err;
}

/* ---------------- HTTP server ---------------- */

const ACTIONS = {
  login: action_login, logout: action_logout,
  generateStudentID: action_generateStudentID,
  getStudents: action_getStudents, addStudent: action_addStudent, updateStudent: action_updateStudent,
  deleteStudent: action_deleteStudent, searchStudent: action_searchStudent,
  getJobStatus: action_getJobStatus, saveJobStatus: action_saveJobStatus, updateJobStatus: action_updateJobStatus, deleteJobStatus: action_deleteJobStatus,
  getPayments: action_getPayments, savePayment: action_savePayment, updatePayment: action_updatePayment, deletePayment: action_deletePayment,
  dashboardStats: action_dashboardStats, reports: action_reports
};

const app = express();
app.use(express.text({ type: '*/*', limit: '2mb' })); // frontend sends text/plain JSON to keep requests CORS-"simple"

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.get('/', (req, res) => res.json({ success: true, message: 'NDR EDTECH Student Portal API (TiDB) is running.' }));
app.get('/exec', (req, res) => res.json({ success: true, message: 'NDR EDTECH Student Portal API (TiDB) is running.' }));

app.post('/exec', async (req, res) => {
  let params = {};
  try { params = req.body ? JSON.parse(req.body) : {}; } catch { params = {}; }

  const action = params.action;
  if (!action || !ACTIONS[action]) {
    return res.json({ success: false, error: { code: 'UNKNOWN_ACTION', message: 'Unknown action: ' + action } });
  }
  try {
    const data = await ACTIONS[action](params);
    res.json({ success: true, data: data === undefined ? null : data });
  } catch (err) {
    if (!err.code) console.error(err); // unexpected errors are logged server-side for debugging
    res.json({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Something went wrong.' } });
  }
});

app.listen(PORT, () => {
  console.log(`NDR EDTECH TiDB API running on port ${PORT}`);
});
