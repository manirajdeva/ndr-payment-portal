/**
 * Utils.gs
 * Shared helpers used across every module: sheet access, JSON responses,
 * row <-> object mapping, validation, and session token helpers.
 */

var SHEET_NAMES = {
  CONFIG: 'Config',
  SESSIONS: 'Sessions',
  COUNTERS: 'Counters',
  USERS: 'Users',
  ENQUIRIES: 'Student Enquiries',
  JOBS: 'Job Status',
  PAYMENTS: 'Student Payments'
};

var SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

var COURSE_OPTIONS = [
  'Snowflake', 'Snowflake +DBT', 'Azure', 'Aws', 'Sap-Modules',
  'Bussiness Analyst', 'GenarativeAI', 'Python'
];

function validateCourseValue_(course) {
  if (COURSE_OPTIONS.indexOf(course) === -1) {
    throw new AppError_('VALIDATION_ERROR', 'Invalid course value.');
  }
}

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(name) {
  var sheet = ss_().getSheetByName(name);
  if (!sheet) {
    throw new AppError_('SHEET_NOT_FOUND', 'Sheet "' + name + '" was not found. Run setup() first.');
  }
  return sheet;
}

/** Custom error type carrying a stable error code for the frontend. */
function AppError_(code, message) {
  var err = new Error(message);
  err.code = code;
  return err;
}

/** Builds the standard JSON envelope returned by every endpoint. */
function jsonOutput_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function successResponse_(data) {
  return { success: true, data: data === undefined ? null : data };
}

function errorResponse_(err) {
  var code = (err && err.code) || 'INTERNAL_ERROR';
  var message = (err && err.message) || 'Something went wrong. Please try again.';
  return { success: false, error: { code: code, message: message } };
}

/**
 * Reads the whole sheet in a single call and returns { headers, dataRows }.
 * Prefer this over separate header/data reads — every extra getRange() or
 * getValues() call is its own round trip and Apps Script's per-call
 * overhead adds up fast on a web app request.
 */
function getSheetData_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1) return { headers: [], dataRows: [] };
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  return { headers: values[0], dataRows: values.slice(1) };
}

/** Reads all rows of a sheet into an array of plain objects keyed by header. */
function readAllRows_(sheet) {
  return readAllRowsWithHeaders_(sheet).rows;
}

/**
 * Same as readAllRows_, but also returns the header row — pass it on to
 * appendObjectRow_/writeObjectToRow_ afterwards to avoid re-fetching
 * headers you already have in hand.
 */
function readAllRowsWithHeaders_(sheet) {
  var sheetData = getSheetData_(sheet);
  var rows = [];
  for (var i = 0; i < sheetData.dataRows.length; i++) {
    var obj = rowToObject_(sheetData.headers, sheetData.dataRows[i]);
    obj._row = i + 2; // 1-based sheet row number, for updates/deletes
    rows.push(obj);
  }
  return { rows: rows, headers: sheetData.headers };
}

function rowToObject_(headers, values) {
  var obj = {};
  for (var c = 0; c < headers.length; c++) {
    var key = headers[c];
    if (!key) continue;
    var val = values[c];
    if (val instanceof Date) {
      val = formatDate_(val);
    }
    obj[key] = val;
  }
  return obj;
}

function formatDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd');
}

function todayStr_() {
  return formatDate_(new Date());
}

function nowIso_() {
  return new Date().toISOString();
}

/**
 * Finds the row index (1-based) of the first row where column value === match.
 * Pass pre-fetched `headers` (e.g. from getSheetData_) to skip an extra
 * round trip when the caller already has them.
 */
function findRowByValue_(sheet, columnName, match, headers) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  headers = headers || sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colIdx = headers.indexOf(columnName);
  if (colIdx === -1) return -1;
  var values = sheet.getRange(2, colIdx + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(match).trim()) {
      return i + 2;
    }
  }
  return -1;
}

/** Pass pre-fetched `headers` to skip an extra round trip when the caller already has them. */
function headerIndexMap_(sheet, headers) {
  headers = headers || sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) map[headers[i]] = i + 1;
  return map;
}

/** Pass pre-fetched `headers` to skip an extra round trip when the caller already has them. */
function writeObjectToRow_(sheet, rowIndex, obj, headers) {
  var map = headerIndexMap_(sheet, headers);
  Object.keys(obj).forEach(function (key) {
    if (map[key]) {
      sheet.getRange(rowIndex, map[key]).setValue(obj[key]);
    }
  });
}

/** Pass pre-fetched `headers` to skip an extra round trip when the caller already has them. */
function appendObjectRow_(sheet, obj, headers) {
  headers = headers || sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

/* ---------------- Validation helpers ---------------- */

function isBlank_(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

function requireFields_(data, fields) {
  var missing = fields.filter(function (f) { return isBlank_(data[f]); });
  if (missing.length) {
    throw new AppError_('VALIDATION_ERROR', 'Missing required field(s): ' + missing.join(', '));
  }
}

function isValidEmail_(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

function isValidMobile_(mobile) {
  return /^[6-9]\d{9}$/.test(String(mobile).trim());
}

/* ---------------- Pagination / sorting / search ---------------- */

/**
 * Builds a row filter predicate from optional `dateFrom`/`dateTo`/`course`
 * params, matching `dateField` for the date range and the `Course` column
 * exactly. Returns null when none of those filters are set (no-op).
 */
function buildDateCourseFilter_(params, dateField) {
  var dateFrom = params.dateFrom, dateTo = params.dateTo, course = params.course;
  if (!dateFrom && !dateTo && !course) return null;
  return function (row) {
    if (dateFrom && String(row[dateField] || '') < dateFrom) return false;
    if (dateTo && String(row[dateField] || '') > dateTo) return false;
    if (course && row['Course'] !== course) return false;
    return true;
  };
}

function paginateAndSort_(rows, params) {
  if (typeof params.filterFn === 'function') {
    rows = rows.filter(params.filterFn);
  }

  var search = (params.search || '').toString().trim().toLowerCase();
  var searchFields = params.searchFields || [];
  if (search && searchFields.length) {
    rows = rows.filter(function (row) {
      return searchFields.some(function (f) {
        return String(row[f] || '').toLowerCase().indexOf(search) !== -1;
      });
    });
  }

  var sortBy = params.sortBy;
  var sortDir = (params.sortDir || 'asc').toLowerCase();
  if (sortBy) {
    rows.sort(function (a, b) {
      var av = a[sortBy], bv = b[sortBy];
      if (av === bv) return 0;
      var cmp = av > bv ? 1 : -1;
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }

  var total = rows.length;
  var page = Math.max(1, parseInt(params.page, 10) || 1);
  var pageSize = Math.max(1, parseInt(params.pageSize, 10) || 10);
  var start = (page - 1) * pageSize;
  var pageRows = rows.slice(start, start + pageSize);

  return {
    rows: pageRows,
    total: total,
    page: page,
    pageSize: pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  };
}

function monthKey_(dateStr) {
  if (!dateStr) return null;
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM');
}
