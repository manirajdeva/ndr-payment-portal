/**
 * Documents.gs
 * Module 4 — Documents: previous-employment documents collected from a
 * student, linked to Student Enquiries by Student ID.
 *
 * Two fields are not taken from the client: 'Processed Date' is stamped
 * with the server's current date when the record is created (and left alone
 * by later edits — it records when the documents were processed, not when
 * the row was last touched), and 'Form 16' / 'PF' are normalised to real
 * booleans so the sheet holds TRUE/FALSE rather than assorted truthy
 * strings.
 */

function action_getDocuments(params) {
  requireSession_(params);
  var sheet = getSheet_(SHEET_NAMES.DOCUMENTS);
  var rows = readAllRows_(sheet).map(normalizeDocumentRow_);
  return paginateAndSort_(rows, {
    search: params.search,
    searchFields: ['Student ID', 'Student Name', 'Organization Name', 'Employee Role', 'Given By'],
    filterFn: buildDateCourseFilter_(params, 'Processed Date'),
    sortBy: params.sortBy || 'CreatedAt',
    sortDir: params.sortDir || 'desc',
    page: params.page,
    pageSize: params.pageSize
  });
}

function action_saveDocument(params) {
  requireRole_(params, EMPLOYEE_ROLES);
  var data = params.data || {};
  requireFields_(data, ['Student ID', 'Organization Name']);
  var years = parseYears_(data['No of Years']);
  validateDocumentDates_(data['Doc Start Date'], data['Doc End Date']);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var student = getStudentById_(data['Student ID']);
    if (!student) {
      throw new AppError_('NOT_FOUND', 'No student found with ID ' + data['Student ID'] + '.');
    }

    var sheet = getSheet_(SHEET_NAMES.DOCUMENTS);
    var now = nowIso_();
    var row = {
      'Student ID': student['Student ID'],
      'Student Name': student['Student Name'],
      'Organization Name': data['Organization Name'],
      'No of Years': years,
      'Employee Role': data['Employee Role'] || '',
      'Doc Start Date': data['Doc Start Date'] || '',
      'Doc End Date': data['Doc End Date'] || '',
      'Form 16': toBool_(data['Form 16']),
      'PF': toBool_(data['PF']),
      'Processed Date': todayStr_(), // stamped server-side, never taken from the client
      'Given By': data['Given By'] || '',
      'CreatedAt': now,
      'UpdatedAt': now
    };
    var newRow = appendObjectRow_(sheet, row);
    row._row = newRow;
    return row;
  } finally {
    lock.releaseLock();
  }
}

function action_updateDocument(params) {
  requireRole_(params, EMPLOYEE_ROLES);
  var data = params.data || {};
  requireFields_(data, ['_row', 'Organization Name']);
  var years = parseYears_(data['No of Years']);
  validateDocumentDates_(data['Doc Start Date'], data['Doc End Date']);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_(SHEET_NAMES.DOCUMENTS);
    var rowIndex = Number(data['_row']);
    if (!(rowIndex >= 2) || rowIndex > sheet.getLastRow()) {
      throw new AppError_('NOT_FOUND', 'Document record not found.');
    }
    // 'Processed Date' is deliberately absent — see this file's header.
    var update = {
      'Organization Name': data['Organization Name'],
      'No of Years': years,
      'Employee Role': data['Employee Role'] || '',
      'Doc Start Date': data['Doc Start Date'] || '',
      'Doc End Date': data['Doc End Date'] || '',
      'Form 16': toBool_(data['Form 16']),
      'PF': toBool_(data['PF']),
      'Given By': data['Given By'] || '',
      'UpdatedAt': nowIso_()
    };
    writeObjectToRow_(sheet, rowIndex, update);
    return update;
  } finally {
    lock.releaseLock();
  }
}

function action_deleteDocument(params) {
  requireRole_(params, EMPLOYEE_ROLES);
  var rowIndex = Number(params.data && params.data['_row']);
  if (!rowIndex) throw new AppError_('VALIDATION_ERROR', 'Record identifier is required.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_(SHEET_NAMES.DOCUMENTS);
    if (rowIndex < 2 || rowIndex > sheet.getLastRow()) {
      throw new AppError_('NOT_FOUND', 'Document record not found.');
    }
    sheet.deleteRow(rowIndex);
    return { deleted: true };
  } finally {
    lock.releaseLock();
  }
}

/** Sheets hand checkbox/boolean cells back in several shapes; the frontend expects real booleans and a number. */
function normalizeDocumentRow_(row) {
  row['Form 16'] = toBool_(row['Form 16']);
  row['PF'] = toBool_(row['PF']);
  row['No of Years'] = Number(row['No of Years']) || 0;
  return row;
}

function toBool_(v) {
  if (typeof v === 'boolean') return v;
  if (v === undefined || v === null) return false;
  var s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

/** Years of experience: optional, but must be a number between 0 and 60 when given. */
function parseYears_(value) {
  if (isBlank_(value)) return 0;
  var n = Number(value);
  if (!isFinite(n) || n < 0) {
    throw new AppError_('VALIDATION_ERROR', 'No of years must be a positive number.');
  }
  if (n > 60) {
    throw new AppError_('VALIDATION_ERROR', 'No of years looks too large — please check the value.');
  }
  return Math.round(n * 10) / 10;
}

/** A document's end date may not fall before its start date (both are optional). */
function validateDocumentDates_(startDate, endDate) {
  if (!isBlank_(startDate) && !isBlank_(endDate) && String(endDate) < String(startDate)) {
    throw new AppError_('VALIDATION_ERROR', 'Doc end date cannot be before the doc start date.');
  }
}
