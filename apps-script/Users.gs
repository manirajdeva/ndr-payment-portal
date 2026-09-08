/**
 * Users.gs
 * User Management (admin only) — add / edit / delete portal logins stored
 * in the "Users" sheet. Mirrors tidb-server's listUsers/addUser/updateUser/
 * deleteUser actions so the frontend's Settings > User Management screen
 * behaves the same on either backend.
 *
 * Roles:
 *   admin    — full access, including managing users
 *   employee — view every section + add records, but never edit/delete
 * ('hr' may appear on older rows and behaves exactly like 'employee'.)
 *
 * The primary login from the Config sheet (ADMIN_USERNAME) is not stored
 * in the Users sheet; it is listed here as a read-only "primary" row and
 * cannot be edited or deleted from the app — use changeAdminPassword() in
 * Auth.gs for that.
 */

function action_listUsers(params) {
  requireAdmin_(params);

  var configSheet = getSheet_(SHEET_NAMES.CONFIG);
  var config = readConfig_(configSheet);

  var rows = [{
    id: 'primary',
    username: config.ADMIN_USERNAME,
    role: 'admin',
    createdAt: ''
  }];

  var usersSheet = getSheet_(SHEET_NAMES.USERS);
  readAllRows_(usersSheet).forEach(function (row) {
    rows.push({
      id: row._row,
      username: row['Username'],
      role: row['Role'],
      createdAt: row['CreatedAt'] || ''
    });
  });

  return { rows: rows };
}

function action_addUser(params) {
  requireAdmin_(params);
  var data = params.data || {};
  requireFields_(data, ['username', 'password', 'role']);

  var username = String(data.username).trim();
  var role = String(data.role).trim();
  var password = String(data.password);
  if (username.length < 3) throw new AppError_('VALIDATION_ERROR', 'Username must be at least 3 characters.');
  if (USER_ROLES.indexOf(role) === -1) throw new AppError_('VALIDATION_ERROR', 'Role must be "admin" or "employee".');
  if (password.length < 6) throw new AppError_('VALIDATION_ERROR', 'Password must be at least 6 characters.');

  var configSheet = getSheet_(SHEET_NAMES.CONFIG);
  var config = readConfig_(configSheet);
  if (username === config.ADMIN_USERNAME) {
    throw new AppError_('DUPLICATE_USER', 'A user with this username already exists.');
  }

  var usersSheet = getSheet_(SHEET_NAMES.USERS);
  var sheetData = readAllRowsWithHeaders_(usersSheet);
  var clash = sheetData.rows.find(function (row) {
    return String(row['Username']).toLowerCase() === username.toLowerCase();
  });
  if (clash) throw new AppError_('DUPLICATE_USER', 'A user with this username already exists.');

  var salt = Utilities.getUuid();
  var hash = hashPassword_(password, salt);
  var createdAt = nowIso_();
  var rowIndex = appendObjectRow_(usersSheet, {
    'Username': username, 'Salt': salt, 'PasswordHash': hash, 'Role': role, 'CreatedAt': createdAt
  }, sheetData.headers);

  return { id: rowIndex, username: username, role: role, createdAt: createdAt };
}

function action_updateUser(params) {
  requireAdmin_(params);
  var data = params.data || {};
  requireFields_(data, ['id']);

  if (String(data.id) === 'primary') {
    throw new AppError_('FORBIDDEN', 'The primary admin login is managed from the Config sheet, not here.');
  }
  var rowIndex = Number(data.id);
  if (!rowIndex || rowIndex < 2) throw new AppError_('NOT_FOUND', 'User not found.');

  var usersSheet = getSheet_(SHEET_NAMES.USERS);
  var sheetData = readAllRowsWithHeaders_(usersSheet);
  var user = sheetData.rows.find(function (row) { return row._row === rowIndex; });
  if (!user) throw new AppError_('NOT_FOUND', 'User not found.');

  var update = {};
  if (!isBlank_(data.role)) {
    var role = String(data.role).trim();
    if (USER_ROLES.indexOf(role) === -1) throw new AppError_('VALIDATION_ERROR', 'Role must be "admin" or "employee".');
    update['Role'] = role;
  }
  if (!isBlank_(data.password)) {
    var password = String(data.password);
    if (password.length < 6) throw new AppError_('VALIDATION_ERROR', 'Password must be at least 6 characters.');
    var salt = Utilities.getUuid();
    update['Salt'] = salt;
    update['PasswordHash'] = hashPassword_(password, salt);
  }
  if (!Object.keys(update).length) {
    throw new AppError_('VALIDATION_ERROR', 'Nothing to update — change the role or set a new password.');
  }

  writeObjectToRow_(usersSheet, rowIndex, update, sheetData.headers);
  return { id: rowIndex, username: user['Username'], role: update['Role'] || user['Role'] };
}

function action_deleteUser(params) {
  var session = requireAdmin_(params);
  var data = params.data || {};
  requireFields_(data, ['id']);

  if (String(data.id) === 'primary') {
    throw new AppError_('FORBIDDEN', 'The primary admin login cannot be deleted.');
  }
  var rowIndex = Number(data.id);
  if (!rowIndex || rowIndex < 2) throw new AppError_('NOT_FOUND', 'User not found.');

  var usersSheet = getSheet_(SHEET_NAMES.USERS);
  var user = readAllRows_(usersSheet).find(function (row) { return row._row === rowIndex; });
  if (!user) throw new AppError_('NOT_FOUND', 'User not found.');
  if (user['Username'] === session.username) throw new AppError_('SELF_DELETE', 'You cannot delete your own account.');

  usersSheet.deleteRow(rowIndex);
  return { deleted: true, id: rowIndex };
}
