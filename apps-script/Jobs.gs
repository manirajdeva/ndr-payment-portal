/**
 * Jobs.gs
 * Module 2 — Job Status: linked to Student Enquiries by Student ID.
 */

var JOB_STATUS_OPTIONS = [
  'Enrolled', 'Training', 'Scheduling Interview', 'Interview Cleared',
  'Offer Received', 'Job Joined', 'Rejected', 'In-active'
];
/**
 * Job statuses used before the list above replaced them. Sheet rows written
 * under an old name are mapped whenever they are read or re-saved, so the
 * existing spreadsheet keeps working without a manual find-and-replace.
 * 'Selected' has no 1:1 successor — it folds into 'Offer Received', which
 * keeps those students inside the "Students Placed" count.
 */
var LEGACY_JOB_STATUS_MAP = {
  'Pending': 'Enrolled',
  'Interview Scheduled': 'Scheduling Interview',
  'Selected': 'Offer Received',
  'Joined': 'Job Joined'
};
/** Statuses that count a student as placed, and the one that counts as joined. */
var PLACED_JOB_STATUSES = ['Offer Received', 'Job Joined'];
var JOINED_JOB_STATUS = 'Job Joined';
var INACTIVE_JOB_STATUS = 'In-active';

function normalizeJobStatus_(status) {
  var value = String(status === null || status === undefined ? '' : status).trim();
  return LEGACY_JOB_STATUS_MAP[value] || value;
}

function action_getJobStatus(params) {
  requireSession_(params);
  var sheet = getSheet_(SHEET_NAMES.JOBS);
  // Map superseded statuses before search/sort so filtering and searching
  // work against the names the UI now shows.
  var rows = readAllRows_(sheet).map(function (row) {
    row['Job Status'] = normalizeJobStatus_(row['Job Status']);
    return row;
  });
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
  requireRole_(params, EMPLOYEE_ROLES);
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
      'Job Status': normalizeJobStatus_(data['Job Status']),
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
  requireRole_(params, EMPLOYEE_ROLES);
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
      'Job Status': normalizeJobStatus_(data['Job Status']),
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
  requireRole_(params, EMPLOYEE_ROLES);
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
  if (JOB_STATUS_OPTIONS.indexOf(normalizeJobStatus_(status)) === -1) {
    throw new AppError_('VALIDATION_ERROR', 'Invalid job status value.');
  }
}

function getStudentById_(studentId) {
  var sheet = getSheet_(SHEET_NAMES.ENQUIRIES);
  var rows = readAllRows_(sheet);
  return rows.find(function (row) { return row['Student ID'] === studentId; }) || null;
}
