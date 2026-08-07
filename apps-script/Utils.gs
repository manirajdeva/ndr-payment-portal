/**
 * Utils.gs
 * Shared helpers used across every module: sheet access, JSON responses,
 * row <-> object mapping, validation, and session token helpers.
 */

var SHEET_NAMES = {
  CONFIG: 'Config',
  SESSIONS: 'Sessions',
  COUNTERS: 'Counters',
  ENQUIRIES: 'Student Enquiries',
  JOBS: 'Job Status',
  PAYMENTS: 'Student Payments'
};

var SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

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

/** Reads all rows of a sheet into an array of plain objects keyed by header. */
function readAllRows_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var rows = [];
  for (var i = 0; i < values.length; i++) {
    var obj = rowToObject_(headers, values[i]);
    obj._row = i + 2; // 1-based sheet row number, for updates/deletes
    rows.push(obj);
  }
  return rows;
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

/** Finds the row index (1-based) of the first row where column value === match. */
function findRowByValue_(sheet, columnName, match) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
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

function headerIndexMap_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) map[headers[i]] = i + 1;
  return map;
}

function writeObjectToRow_(sheet, rowIndex, obj) {
  var map = headerIndexMap_(sheet);
  Object.keys(obj).forEach(function (key) {
    if (map[key]) {
      sheet.getRange(rowIndex, map[key]).setValue(obj[key]);
    }
  });
}

function appendObjectRow_(sheet, obj) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
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

function paginateAndSort_(rows, params) {
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
