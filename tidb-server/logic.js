/**
 * logic.js
 * Pure, storage-agnostic business rules — validation, pagination/search/
 * sort, dashboard aggregation, hashing. Deliberately copied close to
 * verbatim from mock-server/server.js (itself a mirror of apps-script/*.gs)
 * so behavior stays identical across all three backends; only the
 * persistence layer (SQL here, Sheets there, memory there) differs.
 */

const crypto = require('crypto');

const JOB_STATUS_OPTIONS = [
  'Pending', 'Training', 'Interview Scheduled', 'Interview Cleared',
  'Selected', 'Offer Received', 'Joined', 'Rejected'
];
const PAYMENT_METHODS = ['Cash', 'UPI', 'Google Pay', 'PhonePe', 'Bank Transfer', 'Credit Card', 'Debit Card'];
const QUALIFICATION_OPTIONS = ['10th', '12th', 'Diploma', 'Graduate', 'Post Graduate', 'Other'];
const COURSE_OPTIONS = [
  'Snowflake', 'Snowflake +DBT', 'Azure', 'Aws', 'Sap-Modules',
  'Bussiness Analyst', 'GenarativeAI', 'Python'
];

class AppError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

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

function validateCourseValue(course) {
  if (!COURSE_OPTIONS.includes(course)) throw new AppError('VALIDATION_ERROR', 'Invalid course value.');
}
function validateQualificationValue(qualification) {
  if (!isBlank(qualification) && !QUALIFICATION_OPTIONS.includes(qualification)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid qualification value.');
  }
}
function validateJobStatusValue(status) {
  if (!JOB_STATUS_OPTIONS.includes(status)) throw new AppError('VALIDATION_ERROR', 'Invalid job status value.');
}
function validatePaymentMethod(method) {
  if (!PAYMENT_METHODS.includes(method)) throw new AppError('VALIDATION_ERROR', 'Invalid payment method.');
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

/** Same salted-SHA-256 scheme as apps-script/Auth.gs (hashPassword_), so existing hashes are portable. */
function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(String(password) + '::' + String(salt)).digest('hex');
}

module.exports = {
  AppError,
  JOB_STATUS_OPTIONS, PAYMENT_METHODS, QUALIFICATION_OPTIONS, COURSE_OPTIONS,
  todayISO, nowIso, round2, monthKey, isBlank, requireFields, isValidEmail, isValidMobile,
  validateCourseValue, validateQualificationValue, validateJobStatusValue, validatePaymentMethod,
  buildDateCourseFilter, paginateAndSort, last6Months, monthlySeries, latestPerStudent, hashPassword
};
