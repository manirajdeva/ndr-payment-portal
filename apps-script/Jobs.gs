/**
 * Jobs.gs
 * Module 2 — Job Status: linked to Student Enquiries by Student ID.
 */

var JOB_STATUS_OPTIONS = [
  'Pending', 'Training', 'Interview Scheduled', 'Interview Cleared',
  'Selected', 'Offer Received', 'Joined', 'Rejected'
];

function action_getJobStatus(params) {
  requireSession_(params);
  var sheet = getSheet_(SHEET_NAMES.JOBS);
  var rows = readAllRows_(sheet);
  var result = paginateAndSort_(rows, {
    search: params.search,
    searchFields: ['Student ID', 'Student Name', 'Organization', 'Job Status'],
    filterFn: buildDateCourseFilter_(params, 'Office Joining Date'),
    sortBy: params.sortBy || 'CreatedAt',
    sortDir: params.sortDir || 'desc',
    page: params.page,
    pageSize: params.pageSize
  });
  return result;
}

function action_saveJobStatus(params) {
  requireSession_(params);
  var data = params.data || {};
  requireFields_(data, ['Student ID', 'Job Status']);
  validateJobStatusValue_(data['Job Status']);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var student = getStudentById_(data['Student ID']);
    if (!student) {
      throw new AppError_('NOT_FOUND', 'No student found with ID ' + data['Student ID'] + '.');
    }

    var sheet = getSheet_(SHEET_NAMES.JOBS);
    var now = nowIso_();
    var row = {
      'Student ID': student['Student ID'],
      'Student Name': student['Student Name'],
      'Office Joining Date': data['Office Joining Date'] || '',
      'Job Status': data['Job Status'],
      'Course': student['Course'],
      'Organization': data['Organization'] || '',
      'Job Joining Date': data['Job Joining Date'] || '',
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

function action_updateJobStatus(params) {
  requireSession_(params);
  var data = params.data || {};
  requireFields_(data, ['_row', 'Job Status']);
  validateJobStatusValue_(data['Job Status']);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_(SHEET_NAMES.JOBS);
    var rowIndex = Number(data['_row']);
    if (!(rowIndex >= 2) || rowIndex > sheet.getLastRow()) {
      throw new AppError_('NOT_FOUND', 'Job status record not found.');
    }
    var update = {
      'Office Joining Date': data['Office Joining Date'] || '',
      'Job Status': data['Job Status'],
      'Organization': data['Organization'] || '',
      'Job Joining Date': data['Job Joining Date'] || '',
      'UpdatedAt': nowIso_()
    };
    writeObjectToRow_(sheet, rowIndex, update);
    return update;
  } finally {
    lock.releaseLock();
  }
}

function action_deleteJobStatus(params) {
  requireSession_(params);
  var rowIndex = Number(params.data && params.data['_row']);
  if (!rowIndex) throw new AppError_('VALIDATION_ERROR', 'Record identifier is required.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheet_(SHEET_NAMES.JOBS);
    if (rowIndex < 2 || rowIndex > sheet.getLastRow()) {
      throw new AppError_('NOT_FOUND', 'Job status record not found.');
    }
    sheet.deleteRow(rowIndex);
    return { deleted: true };
  } finally {
    lock.releaseLock();
  }
}

function validateJobStatusValue_(status) {
  if (JOB_STATUS_OPTIONS.indexOf(status) === -1) {
    throw new AppError_('VALIDATION_ERROR', 'Invalid job status value.');
  }
}

function getStudentById_(studentId) {
  var sheet = getSheet_(SHEET_NAMES.ENQUIRIES);
  var rows = readAllRows_(sheet);
  return rows.find(function (row) { return row['Student ID'] === studentId; }) || null;
}
