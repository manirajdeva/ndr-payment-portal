/**
 * Students.gs
 * Module 1 — Student Enquiries: CRUD, auto Student ID generation,
 * duplicate prevention, search, pagination, sorting.
 */

var QUALIFICATION_OPTIONS = ['10th', '12th', 'Diploma', 'Graduate', 'Post Graduate', 'Other'];

function validateQualificationValue_(qualification) {
  if (!isBlank_(qualification) && QUALIFICATION_OPTIONS.indexOf(qualification) === -1) {
    throw new AppError_('VALIDATION_ERROR', 'Invalid qualification value.');
  }
}

function action_generateStudentID() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return { studentId: generateStudentId_() };
  } finally {
    lock.releaseLock();
  }
}

/** Caller must already hold the script lock. */
function generateStudentId_() {
  var counters = getSheet_(SHEET_NAMES.COUNTERS);
  var year = new Date().getFullYear();
  var rowIndex = findRowByValue_(counters, 'Year', year);
  var nextSeq;
  if (rowIndex === -1) {
    nextSeq = 1;
    counters.appendRow([year, nextSeq]);
  } else {
    var lastSeq = counters.getRange(rowIndex, 2).getValue();
    nextSeq = Number(lastSeq) + 1;
    counters.getRange(rowIndex, 2).setValue(nextSeq);
  }
  var seqStr = ('0000' + nextSeq).slice(-4);
  return 'NDR' + year + seqStr;
}

function action_getStudents(params) {
  requireSession_(params);
  var sheet = getSheet_(SHEET_NAMES.ENQUIRIES);
  var rows = readAllRows_(sheet);
  var result = paginateAndSort_(rows, {
    search: params.search,
    searchFields: ['Student ID', 'Student Name', 'Mobile Number', 'Gmail'],
    sortBy: params.sortBy || 'CreatedAt',
    sortDir: params.sortDir || 'desc',
    page: params.page,
    pageSize: params.pageSize
  });
  return result;
}

function action_searchStudent(params) {
  requireSession_(params);
  var sheet = getSheet_(SHEET_NAMES.ENQUIRIES);
  var rows = readAllRows_(sheet);
  var query = String(params.query || '').trim().toLowerCase();
  if (!query) return { rows: rows.slice(0, 20) };
  var matches = rows.filter(function (row) {
    return ['Student ID', 'Student Name', 'Mobile Number', 'Gmail'].some(function (f) {
      return String(row[f] || '').toLowerCase().indexOf(query) !== -1;
    });
  });
  return { rows: matches.slice(0, 20) };
}

function action_addStudent(params) {
  requireSession_(params);
  var data = params.data || {};
  requireFields_(data, ['Student Name', 'Course', 'Gmail', 'Mobile Number']);

  if (!isValidEmail_(data['Gmail'])) {
    throw new AppError_('VALIDATION_ERROR', 'Please enter a valid email address.');
  }
  if (!isValidMobile_(data['Mobile Number'])) {
    throw new AppError_('VALIDATION_ERROR', 'Please enter a valid 10-digit mobile number.');
  }
  validateQualificationValue_(data['Qualification']);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_(SHEET_NAMES.ENQUIRIES);
    assertNoDuplicateStudent_(sheet, data, null);

    var studentId = generateStudentId_();
    var now = nowIso_();
    var row = {
      'Student ID': studentId,
      'Student Name': String(data['Student Name']).trim(),
      'Enquiry Date': data['Enquiry Date'] || todayStr_(),
      'Course': data['Course'],
      'Qualification': data['Qualification'] || '',
      'Referred By': data['Referred By'] || '',
      'Gmail': String(data['Gmail']).trim().toLowerCase(),
      'Mobile Number': String(data['Mobile Number']).trim(),
      'CreatedAt': now,
      'UpdatedAt': now
    };
    appendObjectRow_(sheet, row);
    return row;
  } finally {
    lock.releaseLock();
  }
}

function action_updateStudent(params) {
  requireSession_(params);
  var data = params.data || {};
  requireFields_(data, ['Student ID', 'Student Name', 'Course', 'Gmail', 'Mobile Number']);

  if (!isValidEmail_(data['Gmail'])) {
    throw new AppError_('VALIDATION_ERROR', 'Please enter a valid email address.');
  }
  if (!isValidMobile_(data['Mobile Number'])) {
    throw new AppError_('VALIDATION_ERROR', 'Please enter a valid 10-digit mobile number.');
  }
  validateQualificationValue_(data['Qualification']);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_(SHEET_NAMES.ENQUIRIES);
    var rowIndex = findRowByValue_(sheet, 'Student ID', data['Student ID']);
    if (rowIndex === -1) {
      throw new AppError_('NOT_FOUND', 'Student not found.');
    }
    assertNoDuplicateStudent_(sheet, data, data['Student ID']);

    var update = {
      'Student Name': String(data['Student Name']).trim(),
      'Enquiry Date': data['Enquiry Date'],
      'Course': data['Course'],
      'Qualification': data['Qualification'] || '',
      'Referred By': data['Referred By'] || '',
      'Gmail': String(data['Gmail']).trim().toLowerCase(),
      'Mobile Number': String(data['Mobile Number']).trim(),
      'UpdatedAt': nowIso_()
    };
    writeObjectToRow_(sheet, rowIndex, update);

    var studentName = update['Student Name'];
    syncStudentNameEverywhere_(data['Student ID'], studentName, update['Course']);

    return Object.assign({ 'Student ID': data['Student ID'] }, update);
  } finally {
    lock.releaseLock();
  }
}

function action_deleteStudent(params) {
  requireSession_(params);
  var studentId = params.data && params.data['Student ID'];
  if (isBlank_(studentId)) {
    throw new AppError_('VALIDATION_ERROR', 'Student ID is required.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_(SHEET_NAMES.ENQUIRIES);
    var rowIndex = findRowByValue_(sheet, 'Student ID', studentId);
    if (rowIndex === -1) {
      throw new AppError_('NOT_FOUND', 'Student not found.');
    }
    sheet.deleteRow(rowIndex);
    return { deleted: true, studentId: studentId };
  } finally {
    lock.releaseLock();
  }
}

/** Ensures Student ID / Mobile / Email are unique, excluding the given student id (for updates). */
function assertNoDuplicateStudent_(sheet, data, excludeStudentId) {
  var rows = readAllRows_(sheet);
  var mobile = String(data['Mobile Number']).trim();
  var email = String(data['Gmail']).trim().toLowerCase();

  var dupe = rows.find(function (row) {
    if (excludeStudentId && row['Student ID'] === excludeStudentId) return false;
    return String(row['Mobile Number']).trim() === mobile;
  });
  if (dupe) {
    throw new AppError_('DUPLICATE_MOBILE', 'A student with this mobile number already exists (' + dupe['Student ID'] + ').');
  }

  dupe = rows.find(function (row) {
    if (excludeStudentId && row['Student ID'] === excludeStudentId) return false;
    return String(row['Gmail']).trim().toLowerCase() === email;
  });
  if (dupe) {
    throw new AppError_('DUPLICATE_EMAIL', 'A student with this email already exists (' + dupe['Student ID'] + ').');
  }
}

/** Keeps Student Name/Course consistent in Job Status + Payments if edited later. */
function syncStudentNameEverywhere_(studentId, name, course) {
  [SHEET_NAMES.JOBS, SHEET_NAMES.PAYMENTS].forEach(function (sheetName) {
    var sheet = getSheet_(sheetName);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var map = headerIndexMap_(sheet);
    if (!map['Student ID'] || !map['Student Name']) return;
    var idCol = sheet.getRange(2, map['Student ID'], lastRow - 1, 1).getValues();
    for (var i = 0; i < idCol.length; i++) {
      if (String(idCol[i][0]).trim() === String(studentId).trim()) {
        sheet.getRange(i + 2, map['Student Name']).setValue(name);
        if (map['Course'] && course) {
          sheet.getRange(i + 2, map['Course']).setValue(course);
        }
      }
    }
  });
}
