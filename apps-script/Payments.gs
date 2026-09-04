/**
 * Payments.gs
 * Module 3 — Student Payments: multiple entries per student allowed.
 * Pending Amount = Total Course Fee - SUM(Payment Received across all
 * entries for that student). Overpayment and negative pending are blocked.
 */

var PAYMENT_METHODS = [
  'Cash', 'UPI', 'Google Pay', 'PhonePe', 'Bank Transfer', 'Credit Card', 'Debit Card'
];

function action_getPayments(params) {
  requireSession_(params);
  var sheet = getSheet_(SHEET_NAMES.PAYMENTS);
  var rows = readAllRows_(sheet);
  if (params.latestOnly) {
    var latestMap = latestPerStudent_(rows);
    rows = Object.keys(latestMap).map(function (id) { return latestMap[id]; });
  }
  var result = paginateAndSort_(rows, {
    search: params.search,
    searchFields: ['Payment ID', 'Student ID', 'Student Name', 'Payment Method'],
    filterFn: buildDateCourseFilter_(params, 'Payment Date'),
    sortBy: params.sortBy || 'CreatedAt',
    sortDir: params.sortDir || 'desc',
    page: params.page,
    pageSize: params.pageSize
  });
  return result;
}

function action_savePayment(params) {
  requireAdmin_(params);
  var data = params.data || {};
  requireFields_(data, ['Student ID', 'Total Course Fee', 'Payment Received', 'Payment Method']);
  validatePaymentMethod_(data['Payment Method']);

  var totalFee = Number(data['Total Course Fee']);
  var received = Number(data['Payment Received']);
  if (isNaN(totalFee) || totalFee < 0) throw new AppError_('VALIDATION_ERROR', 'Total Course Fee must be a positive number.');
  if (isNaN(received) || received <= 0) throw new AppError_('VALIDATION_ERROR', 'Payment Received must be greater than zero.');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var student = getStudentById_(data['Student ID']);
    if (!student) {
      throw new AppError_('NOT_FOUND', 'No student found with ID ' + data['Student ID'] + '.');
    }

    var sheet = getSheet_(SHEET_NAMES.PAYMENTS);
    var sheetData = getSheetData_(sheet);
    var summary = sumPaymentsForStudent_(sheetData, data['Student ID'], null);
    var existingSum = summary.sum;
    var pending = round2_(totalFee - (existingSum + received));
    if (pending < 0) {
      throw new AppError_('OVERPAYMENT', 'This payment exceeds the pending amount. Maximum allowed right now: ' + round2_(totalFee - existingSum) + '.');
    }

    var paymentId = nextPaymentId_();
    var row = {
      'Payment ID': paymentId,
      'Student ID': student['Student ID'],
      'Student Name': student['Student Name'],
      'Course': student['Course'],
      'Installment No': summary.count + 1,
      'Job Offer Date': data['Job Offer Date'] || '',
      'Total Course Fee': totalFee,
      'Payment Received': received,
      'Payment Method': data['Payment Method'],
      'Pending Amount': pending,
      'Payment Date': data['Payment Date'] || todayStr_(),
      'CreatedAt': nowIso_()
    };
    appendObjectRow_(sheet, row, sheetData.headers);
    return row;
  } finally {
    lock.releaseLock();
  }
}

function action_updatePayment(params) {
  requireAdmin_(params);
  var data = params.data || {};
  requireFields_(data, ['_row', 'Total Course Fee', 'Payment Received', 'Payment Method']);
  validatePaymentMethod_(data['Payment Method']);

  var totalFee = Number(data['Total Course Fee']);
  var received = Number(data['Payment Received']);
  if (isNaN(totalFee) || totalFee < 0) throw new AppError_('VALIDATION_ERROR', 'Total Course Fee must be a positive number.');
  if (isNaN(received) || received <= 0) throw new AppError_('VALIDATION_ERROR', 'Payment Received must be greater than zero.');

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_(SHEET_NAMES.PAYMENTS);
    var rowIndex = Number(data['_row']);
    if (!(rowIndex >= 2) || rowIndex > sheet.getLastRow()) {
      throw new AppError_('NOT_FOUND', 'Payment record not found.');
    }
    var sheetData = getSheetData_(sheet);
    var studentIdCol = sheetData.headers.indexOf('Student ID');
    var studentId = sheetData.dataRows[rowIndex - 2][studentIdCol];

    var otherSum = sumPaymentsForStudent_(sheetData, studentId, rowIndex).sum;
    var pending = round2_(totalFee - (otherSum + received));
    if (pending < 0) {
      throw new AppError_('OVERPAYMENT', 'This payment exceeds the pending amount. Maximum allowed right now: ' + round2_(totalFee - otherSum) + '.');
    }

    var update = {
      'Job Offer Date': data['Job Offer Date'] || '',
      'Total Course Fee': totalFee,
      'Payment Received': received,
      'Payment Method': data['Payment Method'],
      'Pending Amount': pending,
      'Payment Date': data['Payment Date'] || todayStr_()
    };
    writeObjectToRow_(sheet, rowIndex, update, sheetData.headers);
    return update;
  } finally {
    lock.releaseLock();
  }
}

function action_deletePayment(params) {
  requireAdmin_(params);
  var rowIndex = Number(params.data && params.data['_row']);
  if (!rowIndex) throw new AppError_('VALIDATION_ERROR', 'Record identifier is required.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_(SHEET_NAMES.PAYMENTS);
    if (rowIndex < 2 || rowIndex > sheet.getLastRow()) {
      throw new AppError_('NOT_FOUND', 'Payment record not found.');
    }
    sheet.deleteRow(rowIndex);
    return { deleted: true };
  } finally {
    lock.releaseLock();
  }
}

/** `sheetData` is { headers, dataRows } from getSheetData_ — no sheet access here, pure in-memory. Returns both the paid-so-far sum (excluding excludeRowIndex, for edits) and the total row count (for the next installment number). */
function sumPaymentsForStudent_(sheetData, studentId, excludeRowIndex) {
  var idCol = sheetData.headers.indexOf('Student ID');
  var receivedCol = sheetData.headers.indexOf('Payment Received');
  var sum = 0;
  var count = 0;
  for (var i = 0; i < sheetData.dataRows.length; i++) {
    var actualRow = i + 2;
    if (String(sheetData.dataRows[i][idCol]).trim() === String(studentId).trim()) {
      count++;
      if (excludeRowIndex && actualRow === excludeRowIndex) continue;
      sum += Number(sheetData.dataRows[i][receivedCol]) || 0;
    }
  }
  return { sum: round2_(sum), count: count };
}

function validatePaymentMethod_(method) {
  if (PAYMENT_METHODS.indexOf(method) === -1) {
    throw new AppError_('VALIDATION_ERROR', 'Invalid payment method.');
  }
}

/** Caller must already hold the script lock. Reads/writes Counters in one round trip each. */
function nextPaymentId_() {
  var counters = getSheet_(SHEET_NAMES.COUNTERS);
  var data = counters.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === 'PAYMENT_SEQ') { rowIndex = i + 1; break; }
  }

  var nextSeq;
  if (rowIndex === -1) {
    nextSeq = 1;
    counters.appendRow(['PAYMENT_SEQ', nextSeq]);
  } else {
    nextSeq = Number(data[rowIndex - 1][1]) + 1;
    counters.getRange(rowIndex, 2).setValue(nextSeq);
  }
  return 'PMT' + ('000000' + nextSeq).slice(-6);
}

function round2_(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
