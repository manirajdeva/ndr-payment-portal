/**
 * Auth.gs
 * Admin login + token-based session validation.
 * Credentials live in the "Config" sheet (username, salted SHA-256 password
 * hash) — never in the frontend. Sessions are short-lived tokens kept in
 * CacheService so they naturally expire without any cleanup job.
 */

function action_login(params) {
  requireFields_(params, ['username', 'password']);

  var username = String(params.username).trim();
  var password = String(params.password);
  var role = authenticate_(username, password);
  if (!role) {
    throw new AppError_('INVALID_CREDENTIALS', 'Invalid username or password.');
  }

  var token = Utilities.getUuid();
  var expiresAt = Date.now() + SESSION_TTL_MS;
  var cache = CacheService.getScriptCache();
  cache.put('session_' + token, JSON.stringify({ username: username, role: role, expiresAt: expiresAt }), SESSION_TTL_MS / 1000);

  return {
    token: token,
    username: username,
    role: role,
    expiresAt: expiresAt
  };
}

/**
 * Checks `username`/`password` against the primary Config-based admin
 * first (unchanged legacy behavior), then falls back to the Users sheet
 * for additional named accounts. Returns the matched role, or null.
 */
function authenticate_(username, password) {
  var configSheet = getSheet_(SHEET_NAMES.CONFIG);
  var config = readConfig_(configSheet);
  if (username === config.ADMIN_USERNAME) {
    var hash = hashPassword_(password, config.ADMIN_SALT);
    if (hash === config.ADMIN_PASSWORD_HASH) return 'admin';
    return null;
  }

  var usersSheet = getSheet_(SHEET_NAMES.USERS);
  var user = readAllRows_(usersSheet).find(function (row) { return row['Username'] === username; });
  if (!user) return null;
  var userHash = hashPassword_(password, user['Salt']);
  return userHash === user['PasswordHash'] ? user['Role'] : null;
}

function action_logout(params) {
  if (params.token) {
    CacheService.getScriptCache().remove('session_' + params.token);
  }
  return { loggedOut: true };
}

/** Throws SESSION_EXPIRED if the token is missing/invalid/expired. */
function requireSession_(params) {
  var token = params.token;
  if (isBlank_(token)) {
    throw new AppError_('SESSION_EXPIRED', 'Your session has expired. Please log in again.');
  }
  var cache = CacheService.getScriptCache();
  var raw = cache.get('session_' + token);
  if (!raw) {
    throw new AppError_('SESSION_EXPIRED', 'Your session has expired. Please log in again.');
  }
  var session = JSON.parse(raw);
  if (session.expiresAt < Date.now()) {
    cache.remove('session_' + token);
    throw new AppError_('SESSION_EXPIRED', 'Your session has expired. Please log in again.');
  }
  return session;
}

/** Like requireSession_, but also rejects non-admin accounts (e.g. read-only viewers) from write actions. */
function requireAdmin_(params) {
  var session = requireSession_(params);
  if (session.role !== 'admin') {
    throw new AppError_('FORBIDDEN', 'Your account does not have permission to make changes.');
  }
  return session;
}

/**
 * Like requireAdmin_, but also allows the given extra role(s) through —
 * used for create-only actions (e.g. addStudent, saveJobStatus) that some
 * non-admin roles (like 'hr') are permitted to perform, while still being
 * blocked from editing/deleting anything.
 */
function requireRole_(params, allowedRoles) {
  var session = requireSession_(params);
  if (session.role === 'admin' || allowedRoles.indexOf(session.role) !== -1) {
    return session;
  }
  throw new AppError_('FORBIDDEN', 'Your account does not have permission to make changes.');
}

function readConfig_(configSheet) {
  var rows = configSheet.getDataRange().getValues();
  var config = {};
  for (var i = 1; i < rows.length; i++) {
    var key = rows[i][0];
    var value = rows[i][1];
    if (key) config[key] = value;
  }
  return config;
}

function hashPassword_(password, salt) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + '::' + salt);
  return digest.map(function (byte) {
    var v = (byte < 0 ? byte + 256 : byte).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

/**
 * Admin utility: run manually from the Apps Script editor to change the
 * admin password without editing the sheet by hand. Select this function
 * in the toolbar dropdown and click Run, then check the execution log.
 */
function changeAdminPassword() {
  var newPassword = 'ChangeMe@123'; // <-- edit this, run once, then edit it again
  var configSheet = getSheet_(SHEET_NAMES.CONFIG);
  var config = readConfig_(configSheet);
  var salt = config.ADMIN_SALT || Utilities.getUuid();
  var hash = hashPassword_(newPassword, salt);
  setConfigValue_(configSheet, 'ADMIN_SALT', salt);
  setConfigValue_(configSheet, 'ADMIN_PASSWORD_HASH', hash);
  Logger.log('Admin password updated.');
}

function setConfigValue_(configSheet, key, value) {
  var rowIndex = findRowByValue_(configSheet, 'Key', key);
  if (rowIndex === -1) {
    configSheet.appendRow([key, value]);
  } else {
    configSheet.getRange(rowIndex, 2).setValue(value);
  }
}
