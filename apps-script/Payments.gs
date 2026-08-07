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
  var result = paginateAndSort_(rows, {
    search: params.search,
    searchFields: ['Payment ID', 'Student ID', 'Student Name', 'Payment Method'],
    sortBy: params.sortBy || 'CreatedAt',
    sortDir: params.sortDir || 'desc',
    page: params.page,
    pageSize: params.pageSize
  });
  return result;
}

function action_savePayment(params) {
  requireSession_(params);
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
    var existingSum = sumPaymentsForStudent_(sheet, data['Student ID'], null);
    var pending = round2_(totalFee - (existingSum + received));
    if (pending < 0) {
      throw new AppError_('OVERPAYMENT', 'This payment exceeds the pending amount. Maximum allowed right now: ' + round2_(totalFee - existingSum) + '.');
    }

    var paymentId = nextPaymentId_();
    var row = {
      'Payment ID': paymentId,
      'Student ID': student['Student ID'],
      'Student Name': student['Student Name'],
      'Job Offer Date': data['Job Offer Date'] || '',
      'Total Course Fee': totalFee,
      'Payment Received': received,
      'Payment Method': data['Payment Method'],
      'Pending Amount': pending,
      'Payment Date': data['Payment Date'] || todayStr_(),
      'CreatedAt': nowIso_()
    };
    appendObjectRow_(sheet, row);
    return row;
  } finally {
    lock.releaseLock();
  }
}

function action_updatePayment(params) {
  requireSession_(params);
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
    var map = headerIndexMap_(sheet);
    var studentId = sheet.getRange(rowIndex, map['Student ID']).getValue();

    var otherSum = sumPaymentsForStudent_(sheet, studentId, rowIndex);
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
    writeObjectToRow_(sheet, rowIndex, update);
    return update;
  } finally {
    lock.releaseLock();
  }
}

function action_deletePayment(params) {
  requireSession_(params);
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

function sumPaymentsForStudent_(sheet, studentId, excludeRowIndex) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var map = headerIndexMap_(sheet);
  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var sum = 0;
  for (var i = 0; i < values.length; i++) {
    var actualRow = i + 2;
    if (excludeRowIndex && actualRow === excludeRowIndex) continue;
    if (String(values[i][map['Student ID'] - 1]).trim() === String(studentId).trim()) {
      sum += Number(values[i][map['Payment Received'] - 1]) || 0;
    }
  }
  return round2_(sum);
}

function validatePaymentMethod_(method) {
  if (PAYMENT_METHODS.indexOf(method) === -1) {
    throw new AppError_('VALIDATION_ERROR', 'Invalid payment method.');
  }
}

/** Caller must already hold the script lock. */
function nextPaymentId_() {
  var counters = getSheet_(SHEET_NAMES.COUNTERS);
  var rowIndex = findRowByValue_(counters, 'Year', 'PAYMENT_SEQ');
  var nextSeq;
  if (rowIndex === -1) {
    nextSeq = 1;
    counters.appendRow(['PAYMENT_SEQ', nextSeq]);
  } else {
    nextSeq = Number(counters.getRange(rowIndex, 2).getValue()) + 1;
    counters.getRange(rowIndex, 2).setValue(nextSeq);
  }
  return 'PMT' + ('000000' + nextSeq).slice(-6);
}

function round2_(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
