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
    'Payment ID', 'Student ID', 'Student Name', 'Course', 'Installment No', 'Job Offer Date',
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
 * Extra named accounts beyond the primary admin. `password` is only used
 * the first time a username is seeded — once a user row exists, its
 * password hash is left alone (safe to blank the password here afterward
 * instead of leaving it in source control), but its `role` is re-synced
 * on every setup() run, so changing the role below and re-running setup()
 * is enough to update an existing account's permissions.
 *
 * Roles: 'admin' (full access, reserved for the primary Config-based
 * admin), 'hr' (can add Students + Job Status, cannot edit/delete
 * anything, no Payments access), 'viewer' (read-only).
 */
var EXTRA_USERS = [
  { username: 'hrndr@admin', password: 'CHANGE_ME_ALREADY_SEEDED', role: 'hr' }
];

function seedUsers_(spreadsheet) {
  var usersSheet = spreadsheet.getSheetByName(SHEET_NAMES.USERS);
  var sheetData = readAllRowsWithHeaders_(usersSheet);
  EXTRA_USERS.forEach(function (user) {
    var existingRow = sheetData.rows.find(function (row) { return row['Username'] === user.username; });
    if (existingRow) {
      if (existingRow['Role'] !== user.role) {
        writeObjectToRow_(usersSheet, existingRow._row, { 'Role': user.role }, sheetData.headers);
      }
      return;
    }
    var salt = Utilities.getUuid();
    var hash = hashPassword_(user.password, salt);
    usersSheet.appendRow([user.username, salt, hash, user.role, nowIso_()]);
  });
}
