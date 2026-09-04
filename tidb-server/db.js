/**
 * db.js
 * mysql2/promise connection pool for TiDB (MySQL wire-protocol compatible).
 * `decimalNumbers: true` makes DECIMAL columns come back as JS numbers
 * instead of strings, matching the plain-number arithmetic the rest of
 * the app (copied from mock-server/apps-script) expects.
 */

const fs = require('fs');
const mysql = require('mysql2/promise');

require('dotenv').config();

function buildSsl() {
  if (String(process.env.TIDB_SSL || 'true').toLowerCase() === 'false') return undefined;
  const ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: true };
  if (process.env.TIDB_CA_PATH) {
    ssl.ca = fs.readFileSync(process.env.TIDB_CA_PATH, 'utf8');
  }
  return ssl;
}

const pool = mysql.createPool({
  host: process.env.TIDB_HOST || '127.0.0.1',
  port: Number(process.env.TIDB_PORT || 4000),
  user: process.env.TIDB_USER || 'root',
  password: process.env.TIDB_PASSWORD || '',
  database: process.env.TIDB_DATABASE || 'ndr_portal',
  ssl: buildSsl(),
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true
});

/** Runs `fn(conn)` inside a transaction, committing on success and rolling back on any throw. */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch { /* connection may already be gone */ }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, withTransaction };
