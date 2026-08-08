/**
 * Setup.gs
 * One-time initializer. Open this project in the Apps Script editor,
 * select "setup" in the function dropdown, and click Run once to create
 * all sheets, headers, the default admin login, and starting counters.
 * Safe to re-run — it will not overwrite sheets that already exist.
 */

var DEFAULT_ADMIN_USERNAME = 'admin';
var DEFAULT_ADMIN_PASSWORD = 'Admin@123'; // change this after first login, see changeAdminPassword()

function setup() {
  var spreadsheet = ss_();

  ensureSheet_(spreadsheet, SHEET_NAMES.CONFIG, ['Key', 'Value']);
  ensureSheet_(spreadsheet, SHEET_NAMES.COUNTERS, ['Year', 'LastSeq']);
  ensureSheet_(spreadsheet, SHEET_NAMES.ENQUIRIES, [
    'Student ID', 'Student Name', 'Enquiry Date', 'Course', 'Qualification',
    'Referred By', 'Gmail', 'Mobile Number', 'CreatedAt', 'UpdatedAt'
  ]);
  ensureSheet_(spreadsheet, SHEET_NAMES.JOBS, [
    'Student ID', 'Student Name', 'Office Joining Date', 'Job Status',
    'Course', 'Organization', 'Job Joining Date', 'CreatedAt', 'UpdatedAt'
  ]);
  ensureSheet_(spreadsheet, SHEET_NAMES.PAYMENTS, [
    'Payment ID', 'Student ID', 'Student Name', 'Course', 'Job Offer Date',
    'Total Course Fee', 'Payment Received', 'Payment Method',
    'Pending Amount', 'Payment Date', 'CreatedAt'
  ]);
  ensureSheet_(spreadsheet, SHEET_NAMES.USERS, ['Username', 'Salt', 'PasswordHash', 'Role', 'CreatedAt']);

  seedConfig_(spreadsheet);
  seedUsers_(spreadsheet);

  // Remove the default "Sheet1" if it's still present and empty.
  var sheet1 = spreadsheet.getSheetByName('Sheet1');
  if (sheet1 && sheet1.getLastRow() === 0) {
    spreadsheet.deleteSheet(sheet1);
  }

  Logger.log('Setup complete. Default admin login -> username: %s, password: %s', DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD);
}

function ensureSheet_(spreadsheet, name, headers) {
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1e3a8a').setFontColor('#ffffff');
    sheet.autoResizeColumns(1, headers.length);
  }
  return sheet;
}

function seedConfig_(spreadsheet) {
  var configSheet = spreadsheet.getSheetByName(SHEET_NAMES.CONFIG);
  var config = readConfig_(configSheet);

  if (!config.ADMIN_USERNAME) {
    setConfigValue_(configSheet, 'ADMIN_USERNAME', DEFAULT_ADMIN_USERNAME);
  }
  if (!config.ADMIN_SALT || !config.ADMIN_PASSWORD_HASH) {
    var salt = Utilities.getUuid();
    var hash = hashPassword_(DEFAULT_ADMIN_PASSWORD, salt);
    setConfigValue_(configSheet, 'ADMIN_SALT', salt);
    setConfigValue_(configSheet, 'ADMIN_PASSWORD_HASH', hash);
  }
}

/**
 * Extra named accounts beyond the primary admin, seeded once and never
 * overwritten on re-run (seedUsers_ skips any username already present in
 * the Users sheet) — so it's safe to blank out a password here right after
 * it's been seeded once, instead of leaving it in source control.
 */
var EXTRA_USERS = [
  { username: 'hrndr@admin', password: 'CHANGE_ME_ALREADY_SEEDED', role: 'viewer' }
];

function seedUsers_(spreadsheet) {
  var usersSheet = spreadsheet.getSheetByName(SHEET_NAMES.USERS);
  var existing = readAllRows_(usersSheet);
  EXTRA_USERS.forEach(function (user) {
    var already = existing.some(function (row) { return row['Username'] === user.username; });
    if (already) return;
    var salt = Utilities.getUuid();
    var hash = hashPassword_(user.password, salt);
    usersSheet.appendRow([user.username, salt, hash, user.role, nowIso_()]);
  });
}
